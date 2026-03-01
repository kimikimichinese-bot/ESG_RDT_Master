import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiCheck, HealthResponse, HealthState, RequestStatus, WorkerJobsResponseContract } from "@esg-rdt/shared";
import { WorkerJobStore, WorkerJob as SharedWorkerJob } from "@esg-rdt/db";

const PORT = Number(process.env.PORT ?? "3001");
const VERSION = process.env.API_VERSION ?? "0.1.0";
const TENANT_HEADER = "x-tenant-id";
const WORKER_ID = process.env.WORKER_ID ?? "api";
const DEFAULT_SERVICE = "esg-rdt-master-api";
const DEFAULT_API_HOST = "127.0.0.1";
const JOB_API_TOKEN = (process.env.JOB_API_TOKEN ?? "").trim();
const JOB_AUTH_POLICY = JOB_API_TOKEN.length > 0 ? "required" : "disabled";
const JOB_RATE_LIMIT_WINDOW_MS = 60_000;
const JOB_RATE_LIMIT_MAX_REQUESTS = 60;

const contentHeaders = { "content-type": "application/json; charset=utf-8" };
const requestId = () => randomUUID();
const safeDate = () => new Date().toISOString();
const apiHost = process.env.API_HOST?.trim() || DEFAULT_API_HOST;

type JobStatusFilter = "queued" | "running" | "succeeded" | "failed";
type WorkerJob = SharedWorkerJob;

const workerJobStore = new WorkerJobStore();

const normalizeTenantId = (raw: string | string[] | undefined): string | null => {
  if (!raw) return null;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
};

const isGet = (method: string | undefined) => method?.toUpperCase() === "GET";
const isPost = (method: string | undefined) => method?.toUpperCase() === "POST";

const isKnownRoute = (path: string): boolean => {
  if (path === "/v1/jobs" || path === "/v1/jobs/trigger" || path === "/v1/jobs/") {
    return true;
  }

  if (path.startsWith("/v1/jobs/") && path !== "/v1/jobs/") {
    return true;
  }

  return (
    path === "/health" ||
    path === "/healthz" ||
    path === "/v1/health" ||
    path === "/ready" ||
    path === "/v1/status" ||
    path === "/v1/tenant" ||
    path.startsWith("/v1/tenant/")
  );
};

const isTenantProtectedRoute = (path: string) => {
  return path === "/v1/tenant" || path.startsWith("/v1/tenant/");
};

const parseJobStatusFilter = (raw: string | null): JobStatusFilter[] | null => {
  if (!raw) {
    return null;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value): value is JobStatusFilter =>
      value === "queued" || value === "running" || value === "succeeded" || value === "failed"
    );

  if (values.length === 0) {
    return null;
  }

  return values;
};

const parsePositiveInt = (raw: string | null, defaultValue: number): number => {
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultValue;
  }

  return parsed;
};

const parsePositiveIntEnv = (raw: string | undefined, defaultValue: number): number => {
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
};

const parseBoolean = (raw: string | null, defaultValue: boolean): boolean => {
  if (raw === null) {
    return defaultValue;
  }

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

const parseRequestBody = async (req: import("node:http").IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const bodyText = Buffer.concat(chunks).toString("utf8").trim();
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch (_error) {
    return null;
  }
};

const withJson = (
  res: import("node:http").ServerResponse,
  code: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) => {
  res.writeHead(code, {
    ...contentHeaders,
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
};

type RateLimitState = {
  requestCount: number;
  windowEnd: number;
};

const jobRateLimits = new Map<string, RateLimitState>();

const getHeaderValue = (headers: Record<string, string | string[] | undefined>, key: string): string | null => {
  const raw = headers[key];
  if (!raw) {
    return null;
  }

  if (Array.isArray(raw)) {
    return raw[0]?.trim() || null;
  }

  return raw.trim();
};

const parseBearerToken = (raw: string | null): string | null => {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.slice(7).trim();
  }

  return trimmed;
};

const getJobRequestToken = (req: import("node:http").IncomingMessage): string | null => {
  const headerValue = getHeaderValue(req.headers as Record<string, string | string[] | undefined>, "x-api-key");
  if (headerValue) {
    return headerValue;
  }

  const authorization = getHeaderValue(req.headers as Record<string, string | string[] | undefined>, "authorization");
  return parseBearerToken(authorization);
};

const isJobRoute = (path: string): boolean =>
  path === "/v1/jobs" ||
  path === "/v1/jobs/" ||
  path === "/v1/jobs/trigger" ||
  path.startsWith("/v1/jobs/");

const isJobRouteAuthenticated = (req: import("node:http").IncomingMessage): boolean => {
  if (!JOB_API_TOKEN) {
    return true;
  }

  const providedToken = getJobRequestToken(req);
  return Boolean(providedToken && providedToken === JOB_API_TOKEN);
};

const getJobClientIdentity = (
  req: import("node:http").IncomingMessage,
  tenantId: string | null,
): string => {
  if (tenantId) {
    return `tenant:${tenantId}`;
  }

  const forwardedFor = getHeaderValue(req.headers as Record<string, string | string[] | undefined>, "x-forwarded-for");
  if (forwardedFor) {
    return `ip:${forwardedFor.split(",")[0]?.trim() || "unknown"}`;
  }

  return `ip:${req.socket?.remoteAddress || "unknown"}`;
};

const takeJobRateLimit = (identity: string): { allowed: boolean; remaining: number; resetAt: number; limit: number } => {
  const limit = parsePositiveIntEnv(process.env.JOB_RATE_LIMIT_MAX_REQUESTS, JOB_RATE_LIMIT_MAX_REQUESTS);
  const windowMs = parsePositiveIntEnv(process.env.JOB_RATE_LIMIT_WINDOW_MS, JOB_RATE_LIMIT_WINDOW_MS);
  const now = Date.now();

  if (limit <= 0 || windowMs <= 0) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: now + windowMs,
      limit,
    };
  }

  const current = jobRateLimits.get(identity);
  if (!current || current.windowEnd <= now) {
    const next: RateLimitState = {
      requestCount: 1,
      windowEnd: now + windowMs,
    };
    jobRateLimits.set(identity, next);

    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: next.windowEnd,
      limit,
    };
  }

  if (current.requestCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.windowEnd,
      limit,
    };
  }

  current.requestCount += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.requestCount),
    resetAt: current.windowEnd,
    limit,
  };
};

const baseResponse = (tenantId: string | null): Omit<HealthResponse, "checks" | "ready" | "status"> => ({
  service: DEFAULT_SERVICE,
  version: VERSION,
  tenantHeader: tenantId,
  timestamp: safeDate(),
});

const deriveRequestStatus = (checks: ApiCheck): RequestStatus => {
  const values = Object.values(checks);
  if (values.includes("down") || values.includes("warn")) {
    return "degraded";
  }

  return "ready";
};

const baseChecks = async (): Promise<ApiCheck> => {
  const workerReady = await workerJobStore.isWorkerAlive();
  return {
    web: "ok",
    eventStore: workerReady ? "ok" : "down",
    calculationEngine: "warn",
  };
};

const tenantChecks = async (tenantId: string | null): Promise<ApiCheck> => {
  const checks = await baseChecks();
  return {
    ...checks,
    tenantScope: tenantId ? ("ok" as const) : ("warn" as const),
  };
};

const buildHealthResponse = (
  tenantId: string | null,
  checks: ApiCheck,
  options: { requestIdOverride?: string } = {},
): HealthResponse => {
  const status = deriveRequestStatus(checks);
  return {
    ...baseResponse(tenantId),
    status,
    checks,
    ready: status === "ready",
    requestId: options.requestIdOverride ?? requestId(),
    workerReady: checks.eventStore === "ok",
  };
};

const buildJobsEnvelope = async (
  tenantId: string | null,
  jobs: WorkerJob[],
): Promise<WorkerJobsResponseContract> => {
  const workerReady = await workerJobStore.isWorkerAlive();
  const workerState = await workerJobStore.getWorkerState();

  return {
    service: DEFAULT_SERVICE,
    requestId: requestId(),
    timestamp: safeDate(),
    status: workerReady ? "ok" : "degraded",
    workerReady,
    jobs,
    workerState,
  };
};

const handleHealthStyle = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  const path = req.url ? new URL(req.url, `http://${apiHost}:${PORT}`).pathname : "/";
  const tenantId = normalizeTenantId(req.headers[TENANT_HEADER] as string | undefined);
  const rid = requestId();

  if (path === "/health" || path === "/healthz" || path === "/v1/health") {
    const response = buildHealthResponse(tenantId, await baseChecks(), { requestIdOverride: rid });
    withJson(res, 200, response);
    return;
  }

  if (path === "/ready" || path === "/v1/status") {
    const response = buildHealthResponse(tenantId, path === "/v1/status" ? await tenantChecks(tenantId) : await baseChecks(), {
      requestIdOverride: rid,
    });
    withJson(res, 200, response);
    return;
  }

  if (path.startsWith("/v1/tenant")) {
    const checks = await tenantChecks(tenantId);
    const response: HealthResponse & { tenantScope: HealthState; message: string } = {
      ...buildHealthResponse(tenantId, checks, { requestIdOverride: rid }),
      tenantScope: checks.tenantScope ?? "warn",
      message: tenantId ? `Tenant scope header resolved (${tenantId})` : "x-tenant-id header missing",
    };

    withJson(res, 200, response);
    return;
  }
};

const handleJobsList = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  const tenantId = normalizeTenantId(req.headers[TENANT_HEADER] as string | undefined);
  const url = req.url ? new URL(req.url, `http://${apiHost}:${PORT}`) : new URL("http://x");
  const statusFilter = parseJobStatusFilter(url.searchParams.get("status"));
  const includeCompleted = parseBoolean(url.searchParams.get("includeCompleted"), true);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50);

  const jobs = await workerJobStore.listJobs({
    status: statusFilter ?? undefined,
    includeCompleted,
    limit,
  });

  const envelope = await buildJobsEnvelope(tenantId, jobs);
  withJson(res, 200, envelope);
};

const handleJobTrigger = async (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) => {
  const tenantId = normalizeTenantId(req.headers[TENANT_HEADER] as string | undefined);
  const body = await parseRequestBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    withJson(res, 400, {
      error: "Invalid JSON body",
      requestId: requestId(),
      timestamp: safeDate(),
      service: DEFAULT_SERVICE,
    });
    return;
  }

  const payload = body as Record<string, unknown>;
  const bodyJobType = typeof payload.jobType === "string" ? payload.jobType.trim() : "";
  const bodyTenantId =
    typeof payload.tenantId === "string"
      ? payload.tenantId.trim()
      : typeof payload.tenantId === "number"
        ? String(payload.tenantId)
        : null;
  const message = typeof payload.message === "string" ? payload.message : undefined;
  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {};

  if (!bodyJobType) {
    withJson(res, 400, {
      error: "Invalid jobType",
      requestId: requestId(),
      timestamp: safeDate(),
      service: DEFAULT_SERVICE,
    });
    return;
  }

  const job = await workerJobStore.createJob({
    jobType: bodyJobType,
    tenantId: tenantId ?? bodyTenantId,
    message,
    metadata,
  });

  const workerState = await workerJobStore.getWorkerState();
  const workerReady = await workerJobStore.isWorkerAlive();

  withJson(res, 201, {
    ...job,
    workerState,
    workerReady,
    service: DEFAULT_SERVICE,
    requestId: requestId(),
    timestamp: safeDate(),
    triggerer: WORKER_ID,
  });
};

const handleJobDetail = async (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  jobId: string,
) => {
  const tenantId = normalizeTenantId(req.headers[TENANT_HEADER] as string | undefined);
  const job = await workerJobStore.getJob(jobId);
  if (!job) {
    withJson(res, 404, {
      error: "Job not found",
      requestId: requestId(),
      timestamp: safeDate(),
      service: DEFAULT_SERVICE,
      tenantHeader: tenantId,
    });
    return;
  }

  const envelope = await buildJobsEnvelope(tenantId, [job]);
  withJson(res, 200, envelope);
};

const handleRoute = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  const path = req.url ? new URL(req.url, `http://${apiHost}:${PORT}`).pathname : "/";
  const rid = requestId();

  const respondNotFound = () =>
    withJson(res, 404, {
      error: "Not found",
      requestId: rid,
      timestamp: safeDate(),
    });

  const respondUnauthorized = () =>
    withJson(res, 401, {
      error: "Missing tenant context",
      message: "x-tenant-id header is required for this endpoint",
      service: DEFAULT_SERVICE,
      status: "degraded",
      requestId: rid,
      timestamp: safeDate(),
      checks: {
        web: "ok",
        tenantScope: "warn",
        eventStore: "warn",
        calculationEngine: "warn",
      },
      ready: false,
      version: VERSION,
      tenantHeader: null,
    });

  if (!isKnownRoute(path)) {
    respondNotFound();
    return;
  }

  const tenantId = normalizeTenantId(req.headers[TENANT_HEADER] as string | undefined);
  if (isJobRoute(path)) {
    if (!isJobRouteAuthenticated(req)) {
      withJson(
        res,
        401,
        {
          error: "Unauthorized",
          message: "Missing or invalid job API token",
          service: DEFAULT_SERVICE,
          status: "degraded",
          requestId: rid,
          timestamp: safeDate(),
          ready: false,
          checks: {
            web: "ok",
            tenantScope: "warn",
            eventStore: "warn",
            calculationEngine: "warn",
          },
          version: VERSION,
          tenantHeader: tenantId,
        },
        {
          "www-authenticate": 'Bearer realm="jobs", charset="UTF-8"',
        },
      );
      return;
    }

    const rateLimit = takeJobRateLimit(getJobClientIdentity(req, tenantId));
    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));

      withJson(
        res,
        429,
        {
          error: "Rate limit exceeded",
          message: "Job APIs are temporarily rate limited",
          service: DEFAULT_SERVICE,
          status: "degraded",
          requestId: rid,
          timestamp: safeDate(),
          ready: false,
          checks: {
            web: "ok",
            tenantScope: "warn",
            eventStore: "warn",
            calculationEngine: "warn",
          },
          version: VERSION,
          tenantHeader: tenantId,
          retryAfterSeconds,
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          resetAt: new Date(rateLimit.resetAt).toISOString(),
        },
        {
          "retry-after": String(retryAfterSeconds),
          "x-ratelimit-limit": String(rateLimit.limit),
          "x-ratelimit-remaining": String(rateLimit.remaining),
          "x-ratelimit-reset": String(Math.floor(rateLimit.resetAt / 1000)),
        },
      );
      return;
    }
  }

  if (isTenantProtectedRoute(path) && !tenantId) {
    respondUnauthorized();
    return;
  }

  if (path === "/v1/jobs") {
    if (!isGet(req.method)) {
      withJson(res, 405, {
        error: "Method not allowed",
        requestId: rid,
        timestamp: safeDate(),
      });
      return;
    }

    await handleJobsList(req, res);
    return;
  }

  if (path === "/v1/jobs/trigger") {
    if (!isPost(req.method)) {
      withJson(res, 405, {
        error: "Method not allowed",
        requestId: rid,
        timestamp: safeDate(),
      });
      return;
    }

    await handleJobTrigger(req, res);
    return;
  }

  if (path.startsWith("/v1/jobs/")) {
    if (!isGet(req.method)) {
      withJson(res, 405, {
        error: "Method not allowed",
        requestId: rid,
        timestamp: safeDate(),
      });
      return;
    }

    const jobId = path.slice("/v1/jobs/".length);
    if (!jobId) {
      respondNotFound();
      return;
    }

    await handleJobDetail(req, res, jobId);
    return;
  }

  await handleHealthStyle(req, res);
};

const server = createServer((req, res) => {
  handleRoute(req, res).catch((error) => {
    withJson(res, 500, {
      error: error instanceof Error ? error.message : "internal error",
      service: DEFAULT_SERVICE,
      timestamp: safeDate(),
      requestId: requestId(),
      status: "degraded",
      ready: false,
      checks: {
        web: "warn",
        eventStore: "warn",
      },
      version: VERSION,
    });
  });
});

server.listen(PORT, apiHost, () => {
  console.log(`[api] Job endpoint auth policy: ${JOB_AUTH_POLICY}`);
  console.log(`[api] ESG RDT API scaffold running on ${apiHost}:${PORT}`);
  console.log(`[api] health endpoint: /health`);
  console.log(`[api] health endpoint: /v1/health`);
  console.log(`[api] readiness endpoint: /ready`);
  console.log(`[api] tenant endpoint: /v1/tenant`);
  console.log(`[api] job list endpoint: /v1/jobs`);
  console.log(`[api] job trigger endpoint: /v1/jobs/trigger`);
  console.log(`[api] job detail endpoint: /v1/jobs/:id`);
  console.log(`[api] host override: ${process.env.API_HOST ? "provided via API_HOST" : `default ${DEFAULT_API_HOST}`}`);
});
