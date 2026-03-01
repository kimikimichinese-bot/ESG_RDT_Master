import { randomUUID } from "node:crypto";
import { ensureSchema, getSql } from "./db.js";

const SERVICE_NAME = "esg-rdt-master-api";
const WORKER_ID = process.env.WORKER_ID ?? "cron-worker";
const JOB_API_TOKEN = (process.env.JOB_API_TOKEN ?? "").trim();
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.MAX_JOBS_PER_TICK ?? "3", 10) > 0
  ? Number.parseInt(process.env.MAX_JOBS_PER_TICK ?? "3", 10)
  : 3;
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.ANALYZE_URL_TIMEOUT_MS ?? "8000", 10) > 0
  ? Number.parseInt(process.env.ANALYZE_URL_TIMEOUT_MS ?? "8000", 10)
  : 8000;
const INLINE_DEADLINE_MS = 12_000;

const safeDate = () => new Date().toISOString();
const requestId = () => randomUUID();
const parseTenantId = (request) => {
  const value = request.headers.get("x-tenant-id");
  if (!value || !value.trim()) {
    return null;
  }
  return value.trim();
};

const getBuildVersion = () =>
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
  process.env.BUILD_ID ??
  process.env.npm_package_version ??
  "1.0.0";

const isWarn = (value) => value === "warn" || value === "down";
const deriveStatus = (checks) => {
  if (Object.values(checks).some((value) => isWarn(value))) {
    return "degraded";
  }
  return "ready";
};

const json = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

const parseBearerToken = (value) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
};

const getJobToken = (request) => {
  const key = request.headers.get("x-api-key");
  if (key && key.trim()) {
    return key.trim();
  }
  return parseBearerToken(request.headers.get("authorization"));
};

const requireJobAuth = (request, tenantId) => {
  if (!JOB_API_TOKEN) {
    return null;
  }

  const token = getJobToken(request);
  if (token === JOB_API_TOKEN) {
    return null;
  }

  return json(
    {
      error: "Unauthorized",
      message: "Missing or invalid job API token",
      service: SERVICE_NAME,
      status: "degraded",
      requestId: requestId(),
      timestamp: safeDate(),
      ready: false,
      checks: {
        web: "ok",
        tenantScope: "warn",
        eventStore: "warn",
        calculationEngine: "warn",
      },
      version: getBuildVersion(),
      tenantHeader: tenantId,
    },
    401,
    {
      "www-authenticate": 'Bearer realm="jobs", charset="UTF-8"',
    },
  );
};

const toIso = (value) => {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
};

const parseJsonColumn = (value) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  return null;
};

const jobProgress = (status) => {
  if (status === "queued") {
    return 0;
  }
  if (status === "running") {
    return 50;
  }
  return 100;
};

const jobMessage = (row) => {
  if (row.status === "queued") {
    return "Queued";
  }
  if (row.status === "running") {
    return "Running";
  }
  if (row.status === "succeeded") {
    return "Completed";
  }
  if (row.status === "failed") {
    return row.error || "Failed";
  }
  return "Unknown";
};

const normalizeJob = (row) => ({
  id: row.id,
  jobType: row.job_type,
  tenantId: null,
  status: row.status,
  requestedAt: toIso(row.created_at) ?? safeDate(),
  startedAt: toIso(row.started_at),
  finishedAt: toIso(row.finished_at),
  updatedAt: toIso(row.updated_at) ?? safeDate(),
  progress: jobProgress(row.status),
  message: jobMessage(row),
  attempts: row.status === "queued" ? 0 : 1,
  lastError: row.error ?? null,
  result: parseJsonColumn(row.output),
  metadata: {},
});

const workerState = () => ({
  workerId: WORKER_ID,
  status: "idle",
  lastHeartbeatAt: safeDate(),
  processedJobs: 0,
  activeJobId: null,
  version: getBuildVersion(),
});

const buildJobsEnvelope = (jobs) => ({
  service: SERVICE_NAME,
  requestId: requestId(),
  timestamp: safeDate(),
  status: "ok",
  workerReady: true,
  jobs,
  workerState: workerState(),
});

const queueDepth = async () => {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'queued'`;
  return rows?.[0]?.count ?? 0;
};

const latestJobRow = async () => {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1`;
  return rows?.[0] ?? null;
};

const queryJobRowById = async (sql, jobId) => {
  const rows = await sql`SELECT * FROM jobs WHERE id = ${jobId} LIMIT 1`;
  return rows?.[0] ?? null;
};

const markSucceeded = async (sql, id, output) => {
  await sql`
    UPDATE jobs
    SET
      status = 'succeeded',
      output = ${JSON.stringify(output)}::jsonb,
      error = NULL,
      finished_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
  `;
};

const markFailed = async (sql, id, errorMessage) => {
  await sql`
    UPDATE jobs
    SET
      status = 'failed',
      error = ${String(errorMessage).slice(0, 4000)},
      finished_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
  `;
};

const decodeHtml = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const extractHtmlMetadata = (html) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatchA = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const descMatchB = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const title = titleMatch ? decodeHtml(titleMatch[1].replace(/\s+/g, " ").trim()) : null;
  const description = descMatchA?.[1] ?? descMatchB?.[1] ?? null;
  return {
    title: title || null,
    description: description ? decodeHtml(description.trim()) : null,
  };
};

const parseAnalyzeUrl = (input) => {
  const payload = parseJsonColumn(input);
  const urlValue = payload && typeof payload.url === "string" ? payload.url.trim() : "";
  if (!urlValue) {
    throw new Error("analyze_url job requires payload.url");
  }
  const parsed = new URL(urlValue);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are supported");
  }
  return parsed.toString();
};

const fetchWithTimeout = async (fetchImpl, targetUrl, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetchImpl(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "ESG-RDT-Master/1.0 (+Vercel Worker)",
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const processJob = async ({ job, sql, fetchImpl = fetch, inlineDeadlineMs = FETCH_TIMEOUT_MS }) => {
  if (job.job_type === "status") {
    return {
      ok: true,
      timestamp: safeDate(),
      version: getBuildVersion(),
    };
  }

  if (job.job_type === "analyze_url") {
    const targetUrl = parseAnalyzeUrl(job.input);
    const timeoutMs = Math.max(1000, Math.min(FETCH_TIMEOUT_MS, inlineDeadlineMs));
    const response = await fetchWithTimeout(fetchImpl, targetUrl, timeoutMs);
    const html = await response.text();
    const metadata = extractHtmlMetadata(html);
    return {
      url: targetUrl,
      finalUrl: response.url,
      httpStatus: response.status,
      title: metadata.title,
      description: metadata.description,
      fetchedAt: safeDate(),
    };
  }

  throw new Error(`Unsupported jobType: ${job.job_type}`);
};

const claimNextQueuedJob = async (sql) => {
  const rows = await sql`
    WITH next_job AS (
      SELECT id
      FROM jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE jobs j
      SET
        status = 'running',
        started_at = COALESCE(j.started_at, NOW()),
        updated_at = NOW()
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING j.*
    )
    SELECT * FROM claimed
  `;
  return rows?.[0] ?? null;
};

const runClaimedJob = async (sql, claimedJob, options = {}) => {
  try {
    const output = await processJob({ job: claimedJob, sql, fetchImpl: options.fetchImpl, inlineDeadlineMs: options.inlineDeadlineMs });
    await markSucceeded(sql, claimedJob.id, output);
    return { id: claimedJob.id, status: "succeeded", output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "job execution failed";
    await markFailed(sql, claimedJob.id, message);
    return { id: claimedJob.id, status: "failed", error: message };
  }
};

export const processOneJobById = async (jobId, { inlineDeadlineMs = INLINE_DEADLINE_MS, fetchImpl = fetch } = {}) => {
  await ensureSchema();
  const sql = getSql();

  const claimedRows = await sql`
    UPDATE jobs
    SET
      status = 'running',
      started_at = COALESCE(started_at, NOW()),
      updated_at = NOW()
    WHERE id = ${jobId} AND status = 'queued'
    RETURNING *
  `;
  const claimed = claimedRows?.[0] ?? null;

  if (!claimed) {
    const existing = await queryJobRowById(sql, jobId);
    return existing ? normalizeJob(existing) : null;
  }

  await runClaimedJob(sql, claimed, { inlineDeadlineMs, fetchImpl });
  const finalJob = await queryJobRowById(sql, jobId);
  return finalJob ? normalizeJob(finalJob) : null;
};

export const handleV1Health = async (request) => {
  const tenantId = parseTenantId(request);
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`SELECT 1 AS ok`;
    const checks = { web: "ok", db: "ok" };
    return json(
      {
        status: deriveStatus(checks),
        service: SERVICE_NAME,
        timestamp: safeDate(),
        version: getBuildVersion(),
        requestId: requestId(),
        ready: true,
        checks,
        ok: true,
        tenantHeader: tenantId,
      },
      200,
    );
  } catch (error) {
    const checks = { web: "ok", db: "down" };
    return json(
      {
        status: deriveStatus(checks),
        service: SERVICE_NAME,
        timestamp: safeDate(),
        version: getBuildVersion(),
        requestId: requestId(),
        ready: false,
        checks,
        ok: false,
        tenantHeader: tenantId,
        error: error instanceof Error ? error.message : "database unreachable",
      },
      200,
    );
  }
};

export const handleV1Status = async (request) => {
  const tenantId = parseTenantId(request);
  try {
    await ensureSchema();
    const queued = await queueDepth();
    const latest = await latestJobRow();
    const checks = {
      web: "ok",
      db: "ok",
      queue: queued > 0 ? "warn" : "ok",
      tenantScope: tenantId ? "ok" : "warn",
    };

    return json(
      {
        status: deriveStatus(checks),
        service: SERVICE_NAME,
        timestamp: safeDate(),
        version: getBuildVersion(),
        requestId: requestId(),
        ready: checks.db === "ok",
        checks,
        queueDepth: queued,
        latestJob: latest ? normalizeJob(latest) : null,
        tenantHeader: tenantId,
      },
      200,
    );
  } catch (error) {
    const checks = { web: "ok", db: "down", queue: "warn", tenantScope: "warn" };
    return json(
      {
        status: deriveStatus(checks),
        service: SERVICE_NAME,
        timestamp: safeDate(),
        version: getBuildVersion(),
        requestId: requestId(),
        ready: false,
        checks,
        queueDepth: null,
        latestJob: null,
        tenantHeader: tenantId,
        error: error instanceof Error ? error.message : "status unavailable",
      },
      200,
    );
  }
};

export const listJobs = async (request) => {
  const tenantId = parseTenantId(request);
  const auth = requireJobAuth(request, tenantId);
  if (auth) {
    return auth;
  }

  await ensureSchema();
  const sql = getSql();
  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const rows = await sql`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ${limit}`;
  return json(buildJobsEnvelope(rows.map((row) => normalizeJob(row))), 200);
};

const parseTriggerRequest = async (request) => {
  const rawBody = await request.text();
  const trimmed = rawBody.trim();
  const url = new URL(request.url);
  const queryUrl = url.searchParams.get("url");

  if (!trimmed) {
    if (queryUrl && queryUrl.trim()) {
      return {
        ok: true,
        jobType: "analyze_url",
        payload: { url: queryUrl.trim() },
      };
    }
    return {
      ok: true,
      jobType: "status",
      payload: {},
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_error) {
    return {
      ok: false,
      status: 400,
      error: "Invalid JSON body",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      status: 400,
      error: "Request body must be a JSON object",
    };
  }

  if (typeof parsed.jobType !== "string" || !parsed.jobType.trim()) {
    return {
      ok: false,
      status: 400,
      error: "jobType is required when body is provided",
    };
  }

  const payload = parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
    ? parsed.payload
    : {};

  if (parsed.jobType.trim() === "analyze_url" && queryUrl && !payload.url) {
    payload.url = queryUrl;
  }

  return {
    ok: true,
    jobType: parsed.jobType.trim(),
    payload,
  };
};

export const triggerJob = async (request) => {
  const tenantId = parseTenantId(request);
  const auth = requireJobAuth(request, tenantId);
  if (auth) {
    return auth;
  }

  await ensureSchema();
  const parsed = await parseTriggerRequest(request);
  if (!parsed.ok) {
    return json(
      {
        error: parsed.error,
        requestId: requestId(),
        timestamp: safeDate(),
        service: SERVICE_NAME,
      },
      parsed.status ?? 400,
    );
  }

  const id = randomUUID();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO jobs (id, job_type, status, input)
    VALUES (${id}, ${parsed.jobType}, 'queued', ${JSON.stringify(parsed.payload)}::jsonb)
    RETURNING *
  `;
  const created = rows[0];
  const createdJob = normalizeJob(created);

  const inlineAttempt = processOneJobById(id, { inlineDeadlineMs: INLINE_DEADLINE_MS }).catch(() => null);
  const inlineResult = await Promise.race([
    inlineAttempt,
    new Promise((resolve) => setTimeout(() => resolve(null), INLINE_DEADLINE_MS)),
  ]);

  const finalJob = inlineResult || createdJob;
  return json(
    {
      ...finalJob,
      workerState: workerState(),
      workerReady: true,
      service: SERVICE_NAME,
      requestId: requestId(),
      timestamp: safeDate(),
      triggerer: WORKER_ID,
    },
    201,
  );
};

export const getJobById = async (request, jobId) => {
  const tenantId = parseTenantId(request);
  const auth = requireJobAuth(request, tenantId);
  if (auth) {
    return auth;
  }

  if (!jobId) {
    return json(
      {
        error: "Missing jobId",
        requestId: requestId(),
        timestamp: safeDate(),
        service: SERVICE_NAME,
      },
      400,
    );
  }

  await ensureSchema();
  const sql = getSql();
  const row = await queryJobRowById(sql, jobId);
  if (!row) {
    return json(
      {
        error: "Job not found",
        requestId: requestId(),
        timestamp: safeDate(),
        service: SERVICE_NAME,
      },
      404,
    );
  }

  return json(buildJobsEnvelope([normalizeJob(row)]), 200);
};

export const processQueuedJobsTick = async () => {
  await ensureSchema();
  const sql = getSql();
  const processed = [];
  for (let i = 0; i < MAX_JOBS_PER_TICK; i += 1) {
    const claimed = await claimNextQueuedJob(sql);
    if (!claimed) {
      break;
    }
    const result = await runClaimedJob(sql, claimed, { inlineDeadlineMs: FETCH_TIMEOUT_MS });
    processed.push(result);
  }

  return {
    service: SERVICE_NAME,
    requestId: requestId(),
    timestamp: safeDate(),
    workerId: WORKER_ID,
    maxJobsPerTick: MAX_JOBS_PER_TICK,
    processedCount: processed.length,
    processed,
  };
};
