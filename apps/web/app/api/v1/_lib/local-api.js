import { randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getSessionContext } from "./auth.js";
import { checkMonthlyQuota, ensureSchema, getSql, incrementTenantUsage } from "./db.js";

const SERVICE_NAME = "esg-rdt-master-api";
const WORKER_ID = process.env.WORKER_ID ?? "cron-worker";
const JOB_API_TOKEN = (process.env.JOB_API_TOKEN ?? "").trim();
const MAX_JOBS_PER_TICK = Number.parseInt(process.env.MAX_JOBS_PER_TICK ?? "3", 10) > 0
  ? Number.parseInt(process.env.MAX_JOBS_PER_TICK ?? "3", 10)
  : 3;
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.ANALYZE_URL_TIMEOUT_MS ?? "10000", 10) > 0
  ? Number.parseInt(process.env.ANALYZE_URL_TIMEOUT_MS ?? "10000", 10)
  : 10000;
const ANALYZE_RETRY_DELAYS_MS = [0, 250, 900];
const ANALYZE_MAX_BYTES = Number.parseInt(process.env.ANALYZE_URL_MAX_BYTES ?? `${512 * 1024}`, 10) > 0
  ? Number.parseInt(process.env.ANALYZE_URL_MAX_BYTES ?? `${512 * 1024}`, 10)
  : 512 * 1024;
const ANALYZE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ESG-RDT-Analyzer/1.0";
const RETRYABLE_HTTP_STATUS = new Set([502, 503, 504]);
const INLINE_DEADLINE_MS = 12_000;
let dnsResultOrderConfigured = false;

const configureDnsResultOrder = () => {
  if (dnsResultOrderConfigured) {
    return;
  }
  dnsResultOrderConfigured = true;
  try {
    setDefaultResultOrder("ipv4first");
  } catch (_error) {
    // Non-fatal in environments where this call is unsupported.
  }
};

configureDnsResultOrder();

const safeDate = () => new Date().toISOString();
const requestId = () => randomUUID();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
const deriveStatusIgnoringWarnKeys = (checks, ignoredWarnKeys = []) => {
  const ignored = new Set(ignoredWarnKeys);
  for (const [key, value] of Object.entries(checks || {})) {
    if (value === "down") {
      return "degraded";
    }
    if (value === "warn" && !ignored.has(key)) {
      return "degraded";
    }
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

const makeJobError = (errorKind, message, extras = {}) => {
  const error = new Error(message);
  error.errorKind = errorKind;
  if (typeof extras.attemptCount === "number") {
    error.attemptCount = extras.attemptCount;
  }
  if (typeof extras.code === "string") {
    error.code = extras.code;
  }
  if (typeof extras.url === "string") {
    error.url = extras.url;
  }
  return error;
};

const isObjectLike = (value) => value && typeof value === "object";

const readErrorCode = (error) => {
  if (!isObjectLike(error)) {
    return null;
  }
  if (typeof error.code === "string" && error.code.trim()) {
    return error.code;
  }
  if (isObjectLike(error.cause) && typeof error.cause.code === "string" && error.cause.code.trim()) {
    return error.cause.code;
  }
  return null;
};

const mapFetchError = (error, attemptCount) => {
  if (isObjectLike(error) && typeof error.errorKind === "string") {
    return makeJobError(error.errorKind, error.message || "job failed", {
      attemptCount: typeof error.attemptCount === "number" ? error.attemptCount : attemptCount,
      code: typeof error.code === "string" ? error.code : readErrorCode(error),
      url: typeof error.url === "string" ? error.url : undefined,
    });
  }

  const message = error instanceof Error ? error.message : "Network request failed";
  const code = readErrorCode(error);
  const lowered = String(message).toLowerCase();
  const isAbort = (isObjectLike(error) && error.name === "AbortError") || lowered.includes("timeout") || lowered.includes("aborted");

  if (isAbort) {
    return makeJobError("timeout", "Request timed out while fetching URL", { attemptCount, code });
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL" || code === "ENODATA") {
    return makeJobError("dns", "DNS resolution failed for target host", { attemptCount, code });
  }

  return makeJobError("network", message || "Network request failed", { attemptCount, code });
};

const isLocalHostname = (hostname) => {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "localhost." ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  );
};

const isPrivateIPv4 = (address) => {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return false;
};

const isPrivateIPv6 = (address) => {
  const normalized = address.trim().toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (isIP(mapped) === 4) {
      return isPrivateIPv4(mapped);
    }
  }
  return false;
};

const isBlockedIpAddress = (address) => {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return isPrivateIPv4(address);
  }
  if (ipVersion === 6) {
    return isPrivateIPv6(address);
  }
  return false;
};

const validateTargetUrl = async (rawUrl) => {
  let parsed = null;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw makeJobError("invalid_url", "Invalid URL format");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw makeJobError("invalid_url", "Only http/https URLs are supported");
  }

  if (parsed.username || parsed.password) {
    throw makeJobError("blocked", "URL credentials are not allowed");
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) {
    throw makeJobError("invalid_url", "Missing URL hostname");
  }

  if (isLocalHostname(hostname)) {
    throw makeJobError("blocked", "url_blocked_private_network");
  }

  if (isIP(hostname) > 0 && isBlockedIpAddress(hostname)) {
    throw makeJobError("blocked", "url_blocked_private_network");
  }

  let resolved = [];
  try {
    resolved = await dnsLookup(hostname, { all: true, verbatim: false });
  } catch (error) {
    const mapped = mapFetchError(error, 0);
    throw makeJobError(mapped.errorKind, mapped.message, {
      attemptCount: 0,
      code: mapped.code,
      url: parsed.toString(),
    });
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw makeJobError("dns", "DNS lookup returned no records", { attemptCount: 0, url: parsed.toString() });
  }

  for (const item of resolved) {
    if (item?.address && isBlockedIpAddress(item.address)) {
      throw makeJobError("blocked", "url_blocked_private_network", { attemptCount: 0, url: parsed.toString() });
    }
  }

  return parsed.toString();
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

const markFailed = async (sql, id, errorMessage, output = null) => {
  await sql`
    UPDATE jobs
    SET
      status = 'failed',
      output = ${output ? JSON.stringify(output) : null}::jsonb,
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
    throw makeJobError("invalid_url", "analyze_url job requires payload.url");
  }
  return urlValue;
};

const fetchWithTimeout = async (fetchImpl, targetUrl, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": ANALYZE_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "cache-control": "no-cache",
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
};

const readTextLimited = async (response, maxBytes) => {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    const encodedLength = Buffer.byteLength(text, "utf8");
    if (encodedLength <= maxBytes) {
      return { text, truncated: false, bytesRead: encodedLength };
    }
    const slice = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
    return { text: slice, truncated: true, bytesRead: maxBytes };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytesRead = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    const nextSize = bytesRead + value.byteLength;
    if (nextSize > maxBytes) {
      const keep = Math.max(0, maxBytes - bytesRead);
      if (keep > 0) {
        chunks.push(decoder.decode(value.subarray(0, keep), { stream: true }));
        bytesRead += keep;
      }
      truncated = true;
      try {
        await reader.cancel();
      } catch (_error) {
        // Ignore cancellation errors.
      }
      break;
    }

    chunks.push(decoder.decode(value, { stream: true }));
    bytesRead += value.byteLength;
  }

  chunks.push(decoder.decode());
  return {
    text: chunks.join(""),
    truncated,
    bytesRead,
  };
};

const shouldRetryErrorKind = (errorKind) =>
  errorKind === "timeout" || errorKind === "dns" || errorKind === "network";

const fetchUrlAnalysis = async (targetUrl, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS }) => {
  const normalizedUrl = await validateTargetUrl(targetUrl);
  let lastError = null;

  for (let i = 0; i < ANALYZE_RETRY_DELAYS_MS.length; i += 1) {
    const delayMs = ANALYZE_RETRY_DELAYS_MS[i];
    const attemptCount = i + 1;

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    let response = null;
    try {
      response = await fetchWithTimeout(fetchImpl, normalizedUrl, timeoutMs);
    } catch (error) {
      const mapped = mapFetchError(error, attemptCount);
      lastError = mapped;
      if (i < ANALYZE_RETRY_DELAYS_MS.length - 1 && shouldRetryErrorKind(mapped.errorKind)) {
        continue;
      }
      throw mapped;
    }

    if (RETRYABLE_HTTP_STATUS.has(response.status) && i < ANALYZE_RETRY_DELAYS_MS.length - 1) {
      continue;
    }

    const contentType = response.headers.get("content-type") || null;
    const isHtml = Boolean(contentType && contentType.toLowerCase().includes("text/html"));
    let title = null;
    let description = null;
    let truncated = false;

    if (isHtml) {
      const bodyData = await readTextLimited(response, ANALYZE_MAX_BYTES);
      const metadata = extractHtmlMetadata(bodyData.text);
      title = metadata.title;
      description = metadata.description;
      truncated = bodyData.truncated;
    }

    return {
      ok: response.ok,
      url: normalizedUrl,
      finalUrl: response.url || normalizedUrl,
      httpStatus: response.status,
      contentType,
      title,
      description,
      fetchedAt: safeDate(),
      truncated,
      attemptCount,
    };
  }

  if (lastError) {
    throw lastError;
  }
  throw makeJobError("network", "Network request failed", { attemptCount: ANALYZE_RETRY_DELAYS_MS.length });
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
    return fetchUrlAnalysis(targetUrl, { fetchImpl, timeoutMs });
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

const toFailureOutput = (error) => {
  const mapped = mapFetchError(error, typeof error?.attemptCount === "number" ? error.attemptCount : 1);
  return {
    ok: false,
    errorKind: mapped.errorKind || "network",
    message: mapped.message || "Job failed",
    attemptCount: typeof mapped.attemptCount === "number" ? mapped.attemptCount : 1,
  };
};

const runClaimedJob = async (sql, claimedJob, options = {}) => {
  try {
    const output = await processJob({ job: claimedJob, sql, fetchImpl: options.fetchImpl, inlineDeadlineMs: options.inlineDeadlineMs });
    await markSucceeded(sql, claimedJob.id, output);
    return { id: claimedJob.id, status: "succeeded", output };
  } catch (error) {
    const failureOutput = toFailureOutput(error);
    await markFailed(sql, claimedJob.id, failureOutput.message, failureOutput);
    return { id: claimedJob.id, status: "failed", error: failureOutput.message, output: failureOutput };
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
    const tenantContext = tenantId
      ? {
          provided: true,
          status: "ok",
          tenantHeader: tenantId,
          message: "Tenant-scoped readiness checks are enabled for this request.",
        }
      : {
          provided: false,
          status: "not_provided",
          tenantHeader: null,
          message: "Platform readiness is healthy. Tenant-scoped checks were skipped because no x-tenant-id header was provided.",
        };

    return json(
      {
        status: deriveStatusIgnoringWarnKeys(checks, ["tenantScope"]),
        service: SERVICE_NAME,
        timestamp: safeDate(),
        version: getBuildVersion(),
        requestId: requestId(),
        ready: checks.db === "ok",
        checks,
        tenantContext,
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

  const sessionContext = await getSessionContext(request).catch(() => ({ error: "Unauthorized" }));
  if (!sessionContext?.error && sessionContext.impersonationReadOnly) {
    return json(
      {
        error: "Write blocked during read-only impersonation",
        code: "impersonation_read_only",
        requestId: requestId(),
        timestamp: safeDate(),
        service: SERVICE_NAME,
      },
      403,
    );
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
  let quotaOverride = false;
  if (tenantId) {
    quotaOverride = !sessionContext?.error && sessionContext.isSuperadmin;
    const quotaCheck = await checkMonthlyQuota(sql, tenantId, "jobs", {
      increment: 1,
      isSuperadmin: quotaOverride,
    });
    if (!quotaCheck.allowed) {
      return json(
        {
          error: "Jobs quota exceeded",
          code: quotaCheck.code,
          usage: quotaCheck.usage,
          limit: quotaCheck.limit,
          projected: quotaCheck.projected,
          requestId: requestId(),
          timestamp: safeDate(),
          service: SERVICE_NAME,
        },
        403,
      );
    }
  }
  const rows = await sql`
    INSERT INTO jobs (id, job_type, status, input)
    VALUES (${id}, ${parsed.jobType}, 'queued', ${JSON.stringify(parsed.payload)}::jsonb)
    RETURNING *
  `;
  if (tenantId) {
    await incrementTenantUsage(sql, tenantId, {
      jobsCount: 1,
    });
  }
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
