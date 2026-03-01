import { randomUUID } from "node:crypto";

const SERVICE_NAME = "esg-rdt-master-api";
const DEFAULT_API_BASE = null;
const DEFAULT_PROXY_TIMEOUT_MS = 4_000;
const DEFAULT_MISCONFIG_STATUS = 503;
const MISCONFIG_STATUS = Number.parseInt(process.env.DIAGNOSTICS_PROXY_MISCONFIG_STATUS ?? "", 10);

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
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!configured) {
    return DEFAULT_API_BASE;
  }

  return configured.trim();
};

const parseMisconfigStatus = () => {
  if (Number.isInteger(MISCONFIG_STATUS) && MISCONFIG_STATUS > 0) {
    return MISCONFIG_STATUS;
  }

  return DEFAULT_MISCONFIG_STATUS;
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

const parseJobApiToken = () => {
  const configured = [
    process.env.JOB_API_TOKEN,
    process.env.API_JOB_TOKEN,
    process.env.DIAGNOSTICS_PROXY_JOB_API_TOKEN,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (!configured) {
    return null;
  }

  return configured.trim();
};

export const getJobProxyHeaders = () => {
  const token = parseJobApiToken();
  if (!token) {
    return {};
  }

  return {
    authorization: `Bearer ${token}`,
    "x-api-key": token,
  };
};

const getJobProxyHeadersForTarget = (targetPath) => {
  return targetPath.startsWith("/v1/jobs") ? getJobProxyHeaders() : {};
};

const isHealthishPath = (path) => path === "/health" || path === "/ready" || path === "/v1/health" || path === "/v1/status";

const requiredHealthChecksFromRoute = (path) => {
  if (path === "/health" || path === "/healthz" || path === "/v1/health") {
    return { web: "warn", db: "warn" };
  }

  if (path === "/ready" || path === "/v1/status") {
    return { web: "warn", tenantScope: "warn", eventStore: "warn", calculationEngine: "warn" };
  }

  return { web: "warn", eventStore: "warn" };
};

const normalizeApiBase = (rawBase) => {
  if (!rawBase) {
    return { valid: false, value: null, reason: "Missing NEXT_PUBLIC_API_URL or API_BASE_URL" };
  }

  const trimmed = rawBase.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { valid: false, value: null, reason: "UPSTREAM_API_BASE is blank after trimming" };
  }

  if (trimmed.startsWith("/")) {
    return { valid: true, value: trimmed };
  }

  const urlCandidate = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(urlCandidate);
    if (!parsed.hostname) {
      return { valid: false, value: null, reason: `UPSTREAM_API_BASE has no hostname (${trimmed})` };
    }
    return { valid: true, value: trimmed };
  } catch (_error) {
    return { valid: false, value: null, reason: `UPSTREAM_API_BASE is not a valid URL (${trimmed})` };
  }
};

const STARTUP_PROXY_CONFIG = (() => {
  const configured = parseApiBase();
  if (!configured) {
    return {
      valid: false,
      reason: "Missing NEXT_PUBLIC_API_URL and API_BASE_URL",
      apiBase: null,
      misconfigStatus: parseMisconfigStatus(),
    };
  }

  const parsed = normalizeApiBase(configured);
  return {
    valid: parsed.valid,
    reason: parsed.valid ? null : parsed.reason,
    apiBase: parsed.value,
    misconfigStatus: parseMisconfigStatus(),
  };
})();

if (!STARTUP_PROXY_CONFIG.valid) {
  console.error(`[diagnostics-proxy] Invalid upstream base: ${STARTUP_PROXY_CONFIG.reason}`);
}

const validateHealthPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const checks = payload.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return false;
  }

  const checkValues = Object.values(checks);
  if (!checkValues.every((value) => value === "ok" || value === "warn" || value === "down")) {
    return false;
  }

  if (typeof payload.service !== "string" || payload.service.trim().length === 0) {
    return false;
  }
  if (typeof payload.status !== "string" || payload.status.trim().length === 0) {
    return false;
  }
  if (typeof payload.ready !== "boolean") {
    return false;
  }
  if (typeof payload.timestamp !== "string" || payload.timestamp.trim().length === 0) {
    return false;
  }
  if (typeof payload.version !== "string" || payload.version.trim().length === 0) {
    return false;
  }
  if (typeof payload.requestId !== "string" || payload.requestId.trim().length === 0) {
    return false;
  }

  return true;
};

const buildMalformedPayloadFallback = (requestId, requestPath, sourceError) => {
  return buildFallbackResponse(
    requestId,
    requiredHealthChecksFromRoute(requestPath),
    sourceError ?? new Error(`Upstream payload did not match expected contract for ${requestPath}`),
    requestPath,
  );
};

const buildPayloadValidationFailure = (requestId, requestPath, rawPayload) => {
  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return {
      ...buildMalformedPayloadFallback(requestId, requestPath, new Error("Upstream payload validation failed")),
      upstreamPayload: rawPayload,
    };
  }

  return buildMalformedPayloadFallback(requestId, requestPath, new Error("Upstream payload validation failed"));
};

const buildApiUrl = (request, endpointPath) => {
  const apiBase = STARTUP_PROXY_CONFIG.apiBase;

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

export const proxyDiagnosticGet = async (request, targetPath, fallbackChecks, requestPathLabel, options = {}) => {
  return proxyDiagnosticRequest({
    request,
    targetPath,
    requestPathLabel,
    fallbackChecks,
    options: {
      ...options,
      method: "GET",
    },
  });
};

export const proxyDiagnosticRequest = async ({ request, targetPath, fallbackChecks, requestPathLabel, options = {} }) => {
  const payloadValidator = options.payloadValidator;
  const upstreamUrl = buildApiUrl(request, targetPath);
  const requestId = randomUUID();
  const requestTenant = request.headers.get("x-tenant-id") ?? parseDiagnosticTenantId();
  const proxyHeaders = {
    ...getJobProxyHeadersForTarget(targetPath),
    ...(requestTenant
      ? {
          "x-tenant-id": requestTenant,
        }
      : {}),
  };

  if (!STARTUP_PROXY_CONFIG.valid) {
    return Response.json(
      buildFallbackResponse(
        requestId,
        fallbackChecks,
        new Error(STARTUP_PROXY_CONFIG.reason ?? "Diagnostics proxy startup validation failed"),
        requestPathLabel,
      ),
      { status: STARTUP_PROXY_CONFIG.misconfigStatus },
    );
  }

  if (!upstreamUrl) {
    return Response.json(
      buildFallbackResponse(
        requestId,
        fallbackChecks,
        new Error("Missing upstream API base URL for diagnostics proxy"),
        requestPathLabel,
      ),
      { status: parseMisconfigStatus() },
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

  const method = (options.method ?? "GET").toUpperCase();
  const timeoutMs = parseTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Diagnostics proxy timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const body = options.body ?? (method === "GET" || method === "HEAD" ? undefined : await request.text());
    const upstream = await fetch(upstreamUrl, {
      method,
      cache: "no-store",
      headers: {
        ...proxyHeaders,
        ...(options.headers ?? {}),
      },
      body: body && body.length > 0 ? body : undefined,
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

    if (isHealthishPath(targetPath) && !validateHealthPayload(hydrateTenantScope(upstreamJson))) {
      return Response.json(
        buildPayloadValidationFailure(requestId, requestPathLabel, hydrateTenantScope(upstreamJson)),
        { status: 502 },
      );
    }

    if (upstream.ok && typeof payloadValidator === "function" && !payloadValidator(upstreamJson)) {
      return Response.json(
        buildPayloadValidationFailure(requestId, requestPathLabel, upstreamJson),
        { status: 502 },
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
  buildFallbackResponse(randomUUID(), requiredHealthChecksFromRoute("/health"), error, "/health");

export const getDiagnosticsProxyStartupConfig = () => STARTUP_PROXY_CONFIG;
