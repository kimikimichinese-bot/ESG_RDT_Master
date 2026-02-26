import { randomUUID } from "node:crypto";

const SERVICE_NAME = "esg-rdt-master-api";
const DEFAULT_API_BASE = null;
const DEFAULT_PROXY_TIMEOUT_MS = 4_000;

const parseTimeoutMs = () => {
  const configuredTimeout = process.env.DIAGNOSTICS_PROXY_TIMEOUT_MS ?? "";
  const parsed = Number.parseInt(configuredTimeout, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PROXY_TIMEOUT_MS;
};

const parseApiBase = () => {
  const configured = [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.API_BASE_URL,
    process.env.API_URL,
    process.env.DIAGNOSTICS_PROXY_API_BASE,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!configured) {
    return DEFAULT_API_BASE;
  }

  return configured.trim();
};

const parseDiagnosticTenantId = () => {
  const configured = [
    process.env.DIAGNOSTICS_PROXY_TENANT_ID,
    process.env.DIAGNOSTICS_TENANT_ID,
    process.env.DEFAULT_TENANT_ID,
    process.env.TENANT_ID,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!configured) {
    return null;
  }

  return configured.trim();
};

const buildApiUrl = (request, endpointPath) => {
  const apiBase = parseApiBase();

  if (!apiBase) {
    return null;
  }

  const requestUrl = new URL(request.url);
  const base = apiBase.replace(/\/+$/, "");
  const path = endpointPath.startsWith("/") ? endpointPath.slice(1) : endpointPath;

  if (/^https?:\/\//i.test(base)) {
    const parsedBase = new URL(base.endsWith("/") ? base : `${base}/`);
    return new URL(path, parsedBase).toString();
  }

  if (base.startsWith("/")) {
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    return `${requestUrl.origin}${normalizedBase}/${path}`;
  }

  const fallbackBase = base.includes("://") ? base : `http://${base}`;
  const normalizedBase = fallbackBase.endsWith("/") ? fallbackBase.slice(0, -1) : fallbackBase;
  return `${normalizedBase}/${path}`;
};

const getBuildVersion = () =>
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
  process.env.BUILD_ID ??
  process.env.npm_package_version ??
  "1.0.0";

const statusFromChecks = (checks) =>
  Object.values(checks).some((value) => value === "warn" || value === "down") ? "degraded" : "ready";

const buildFallbackResponse = (requestId, checks, error, requestPath) => ({
  status: statusFromChecks(checks),
  service: SERVICE_NAME,
  timestamp: new Date().toISOString(),
  version: getBuildVersion(),
  requestId,
  ready: false,
  checks,
  error: error instanceof Error ? error.message : `Unable to query upstream ${requestPath}`,
});

const parseJsonSafely = async (response, requestPath) => {
  const bodyText = await response.text();
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch (_error) {
    return {
      error: `Invalid JSON from upstream ${requestPath}`,
      raw: bodyText,
    };
  }
};

const hydrateTenantScope = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const checks = payload.checks;
  const checksTenantScope = checks && typeof checks === "object" ? checks.tenantScope : null;
  if (payload.tenantScope || !checksTenantScope) {
    return payload;
  }

  return {
    ...payload,
    tenantScope: checksTenantScope,
  };
};

const buildStatusFallbackForMissingTenant = (requestId, fallbackChecks, upstreamJson, requestPath) => {
  const enrichedChecks = {
    ...fallbackChecks,
    tenantScope: "warn",
  };
  const rawError = upstreamJson?.error ?? upstreamJson?.message;
  const error = rawError || "Tenant context is required for status checks";
  return {
    ...buildFallbackResponse(requestId, enrichedChecks, error, requestPath),
    tenantScope: "warn",
    tenantHeader: null,
  };
};

export const proxyDiagnosticGet = async (request, targetPath, fallbackChecks, requestPathLabel) => {
  const upstreamUrl = buildApiUrl(request, targetPath);
  const requestId = randomUUID();
  const requestTenant = request.headers.get("x-tenant-id") ?? parseDiagnosticTenantId();
  const proxyHeaders = requestTenant
    ? {
        "x-tenant-id": requestTenant,
      }
    : {};

  if (!upstreamUrl) {
    return Response.json(
      buildFallbackResponse(
        requestId,
        fallbackChecks,
        new Error("Missing upstream API base URL for diagnostics proxy"),
        requestPathLabel,
      ),
      { status: 503 },
    );
  }

  if (upstreamUrl === request.url) {
    return Response.json(
      buildFallbackResponse(
        requestId,
        fallbackChecks,
        new Error("Diagnostics proxy target resolved to same request URL; check NEXT_PUBLIC_API_URL/API_BASE_URL points to the backend, not the web route"),
        requestPathLabel,
      ),
      { status: 502 },
    );
  }

  const timeoutMs = parseTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Diagnostics proxy timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        ...proxyHeaders,
      },
      signal: controller.signal,
    });
    const upstreamJson = await parseJsonSafely(upstream, requestPathLabel);
    clearTimeout(timeout);

    if (upstream.status === 401 && targetPath === "/v1/status" && !requestTenant) {
      return Response.json(
        buildStatusFallbackForMissingTenant(requestId, fallbackChecks, upstreamJson, requestPathLabel),
        { status: 200 },
      );
    }

    return Response.json(hydrateTenantScope(upstreamJson), { status: upstream.status });
  } catch (error) {
    clearTimeout(timeout);
    return Response.json(
      buildFallbackResponse(requestId, fallbackChecks, error, requestPathLabel),
      { status: 502 },
    );
  }
};

export const getDefaultFallbackForHealth = (error) =>
  buildFallbackResponse(randomUUID(), { web: "warn", db: "down" }, error, "/health");
