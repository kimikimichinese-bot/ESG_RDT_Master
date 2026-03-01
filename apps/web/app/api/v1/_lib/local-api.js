import { randomUUID } from "node:crypto";

const SERVICE_NAME = "esg-rdt-master-api";
const WORKER_ID = process.env.WORKER_ID ?? "web-api";
const JOB_API_TOKEN = (process.env.JOB_API_TOKEN ?? "").trim();
const STORE_KEY = "__esg_rdt_worker_jobs_store__";
const getStore = () => {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = new Map();
  }
  return globalThis[STORE_KEY];
};

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

const baseHealthPayload = (tenantId, checks) => {
  const status = deriveStatus(checks);
  return {
    status,
    service: SERVICE_NAME,
    timestamp: safeDate(),
    version: getBuildVersion(),
    requestId: requestId(),
    ready: status === "ready",
    checks,
    tenantHeader: tenantId,
  };
};

export const handleV1Health = async (request) => {
  const tenantId = parseTenantId(request);
  return json(
    baseHealthPayload(tenantId, {
      web: "ok",
      db: "ok",
    }),
    200,
  );
};

export const handleV1Status = async (request) => {
  const tenantId = parseTenantId(request);
  return json(
    baseHealthPayload(tenantId, {
      web: "ok",
      tenantScope: tenantId ? "ok" : "warn",
      eventStore: "ok",
      calculationEngine: "ok",
    }),
    200,
  );
};

const buildJobsEnvelope = async (jobs) => {
  return {
    service: SERVICE_NAME,
    requestId: requestId(),
    timestamp: safeDate(),
    status: "ok",
    workerReady: true,
    jobs,
    workerState: {
      workerId: WORKER_ID,
      status: "idle",
      lastHeartbeatAt: safeDate(),
      processedJobs: 0,
      activeJobId: null,
      version: getBuildVersion(),
    },
  };
};

const parseStatusFilter = (raw) => {
  if (!raw) {
    return null;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value === "queued" || value === "running" || value === "succeeded" || value === "failed");

  return values.length > 0 ? values : null;
};

const parsePositiveInt = (raw, fallback) => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const parseBool = (raw, fallback) => {
  if (raw == null) {
    return fallback;
  }
  const value = raw.toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return fallback;
};

export const handleJobsList = async (request) => {
  const tenantId = parseTenantId(request);
  const auth = requireJobAuth(request, tenantId);
  if (auth) {
    return auth;
  }

  const url = new URL(request.url);
  const statusFilter = parseStatusFilter(url.searchParams.get("status"));
  const includeCompleted = parseBool(url.searchParams.get("includeCompleted"), true);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

  const jobs = Array.from(getStore().values())
    .filter((job) => {
      if (!statusFilter || statusFilter.length === 0) {
        if (includeCompleted) {
          return true;
        }
        return job.status !== "succeeded" && job.status !== "failed";
      }
      return statusFilter.includes(job.status);
    })
    .slice(0, limit);

  return json(await buildJobsEnvelope(jobs), 200);
};

export const handleJobTrigger = async (request) => {
  const tenantId = parseTenantId(request);
  const auth = requireJobAuth(request, tenantId);
  if (auth) {
    return auth;
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_error) {
    body = null;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        error: "Invalid JSON body",
        requestId: requestId(),
        timestamp: safeDate(),
        service: SERVICE_NAME,
      },
      400,
    );
  }

  const payload = body;
  const jobType = typeof payload.jobType === "string" ? payload.jobType.trim() : "";
  if (!jobType) {
    return json(
      {
        error: "Invalid jobType",
        requestId: requestId(),
        timestamp: safeDate(),
        service: SERVICE_NAME,
      },
      400,
    );
  }

  const bodyTenantId =
    typeof payload.tenantId === "string"
      ? payload.tenantId.trim()
      : typeof payload.tenantId === "number"
        ? String(payload.tenantId)
        : null;

  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};

  const now = safeDate();
  const job = {
    id: randomUUID(),
    jobType,
    tenantId: tenantId ?? bodyTenantId,
    status: "queued",
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
    progress: 0,
    message: typeof payload.message === "string" && payload.message.trim() ? payload.message : "Queued",
    attempts: 0,
    lastError: null,
    result: null,
    metadata,
  };
  getStore().set(job.id, job);

  return json(
    {
      ...job,
      workerState: {
        workerId: WORKER_ID,
        status: "idle",
        lastHeartbeatAt: now,
        processedJobs: 0,
        activeJobId: null,
        version: getBuildVersion(),
      },
      workerReady: true,
      service: SERVICE_NAME,
      requestId: requestId(),
      timestamp: safeDate(),
      triggerer: WORKER_ID,
    },
    201,
  );
};

export const handleJobDetail = async (request, jobId) => {
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

  const store = getStore();
  const job = store.get(jobId) ?? {
    id: jobId,
    jobType: "status",
    tenantId,
    status: "queued",
    requestedAt: safeDate(),
    startedAt: null,
    finishedAt: null,
    updatedAt: safeDate(),
    progress: 0,
    message: "Queued",
    attempts: 0,
    lastError: null,
    result: null,
    metadata: {},
  };
  store.set(job.id, job);
  return json(await buildJobsEnvelope([job]), 200);
};
