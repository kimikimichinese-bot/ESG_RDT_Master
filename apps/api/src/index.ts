import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiCheck, HealthResponse, HealthState, RequestStatus } from "@esg-rdt/shared";

const PORT = Number(process.env.PORT ?? "3001");
const VERSION = process.env.API_VERSION ?? "0.1.0";
const TENANT_HEADER = "x-tenant-id";
const DEFAULT_SERVICE = "esg-rdt-master-api";
const DEFAULT_API_HOST = "127.0.0.1";

const contentHeaders = { "content-type": "application/json; charset=utf-8" };

const requestId = () => randomUUID();

const safeDate = () => new Date().toISOString();
const apiHost = process.env.API_HOST?.trim() || DEFAULT_API_HOST;

const normalizeTenantId = (raw: string | string[] | undefined): string | null => {
  if (!raw) return null;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
};

const isGet = (method: string | undefined) => method?.toUpperCase() === "GET";

const isKnownRoute = (path: string) => {
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

const deriveRequestStatus = (checks: ApiCheck): RequestStatus => {
  const values = Object.values(checks);
  if (values.includes("down") || values.includes("warn")) {
    return "degraded";
  }
  return "ready";
};

const withJson = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, contentHeaders);
  res.end(JSON.stringify(body));
};

const baseResponse = (tenantId: string | null): Omit<HealthResponse, "checks" | "ready" | "status"> => ({
  service: DEFAULT_SERVICE,
  version: VERSION,
  tenantHeader: tenantId,
  timestamp: safeDate(),
});

const baseChecks = (): ApiCheck => ({
  web: "ok" as const,
  eventStore: "warn" as const,
  calculationEngine: "warn" as const,
});

const tenantChecks = (tenantId: string | null): ApiCheck => ({
  ...baseChecks(),
  tenantScope: tenantId ? ("ok" as const) : ("warn" as const),
});

const buildHealthResponse = (tenantId: string | null, checks: ApiCheck): HealthResponse => {
  const status = deriveRequestStatus(checks);
  return {
    ...baseResponse(tenantId),
    status,
    checks,
    ready: status === "ready",
    requestId: requestId(),
  };
};

const handleRoute = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  const path = req.url ? req.url.split("?")[0] : "/";
  const tenantId = normalizeTenantId(req.headers[TENANT_HEADER] ?? undefined);
  const rid = requestId();
  const safePath = path;

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

  if (!isGet(req.method)) {
    if (!isKnownRoute(path)) {
      respondNotFound();
      return;
    }

    withJson(res, 405, {
      error: "Method not allowed",
      requestId: rid,
      timestamp: safeDate(),
    });
    return;
  }

  if (isTenantProtectedRoute(safePath) && !tenantId) {
    respondUnauthorized();
    return;
  }

  if (path === "/health" || path === "/healthz" || path === "/v1/health") {
    const response = buildHealthResponse(tenantId, baseChecks());
    withJson(res, 200, response);
    return;
  }

  if (path === "/ready" || path === "/v1/status") {
    const response = buildHealthResponse(
      tenantId,
      path === "/v1/status" ? tenantChecks(tenantId) : baseChecks(),
    );
    withJson(res, 200, response);
    return;
  }

  if (path.startsWith("/v1/tenant")) {
    const checks = tenantChecks(tenantId);
    const responseBase = buildHealthResponse(tenantId, checks);
    const response: HealthResponse & { tenantScope: HealthState; message: string } = {
      ...responseBase,
      tenantScope: checks.tenantScope ?? "warn",
      message: tenantId ? `Tenant scope header resolved (${tenantId})` : "x-tenant-id header missing",
    };

    withJson(res, 200, response);
    return;
  }

  respondNotFound();
};

const server = createServer(handleRoute);

server.listen(PORT, apiHost, () => {
  console.log(`[api] ESG RDT API scaffold running on ${apiHost}:${PORT}`);
  console.log(`[api] health endpoint: /health`);
  console.log(`[api] health endpoint: /v1/health`);
  console.log(`[api] readiness endpoint: /ready`);
  console.log(`[api] tenant endpoint: /v1/tenant`);
  console.log(`[api] host override: ${process.env.API_HOST ? "provided via API_HOST" : `default ${DEFAULT_API_HOST}`}`);
});
