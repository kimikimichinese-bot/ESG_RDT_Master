import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const API_HEALTH_PROGRESS_AREA = "API + health checks";
const API_CONTRACT_SIGNAL = "API contract";
const HEALTH_BASE_PATHS = [
  "NEXT_PUBLIC_API_URL",
  "API_BASE_URL",
  "API_URL",
  "DIAGNOSTICS_PROXY_API_BASE",
];
const HEALTH_TENANT_KEYS = [
  "DIAGNOSTICS_PROXY_TENANT_ID",
  "DIAGNOSTICS_TENANT_ID",
  "DEFAULT_TENANT_ID",
  "TENANT_ID",
];
const PROGRESS_HEALTH_TIMEOUT_MS = 2500;
const API_HEALTH_PROBE_ENDPOINTS = ["/v1/health", "/v1/status", "/health", "/ready"];
const API_HEALTH_DEFAULT_BUILD_PRIORITY = 1;
const API_HEALTH_DEFAULT_BUILD_LABEL = "Critical API stabilization";

const RELEASE_PROGRESS_FALLBACK = {
  service: "esg-rdt-master-web",
  releaseStatus: "degraded",
  productSignals: [
    {
      label: "Web shell",
      status: "implemented",
      detail: "Diagnostic UI shell and endpoint cards are in place.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
    {
      label: "API contract",
      status: "basic",
      detail: "Core endpoints and shared check schema are wired; several checks remain placeholder.",
      addedAt: "2026-02-24T09:00:00.000Z",
      updatedAt: "2026-02-24T09:00:00.000Z",
    },
    {
      label: "Worker loop",
      status: "scaffolded",
      detail: "Scheduled cycle execution exists, with overlap protection and structured logs.",
      addedAt: "2026-02-24T09:05:00.000Z",
      updatedAt: "2026-02-24T09:05:00.000Z",
    },
  ],
  progress: [
    {
      area: "UI + UX",
      done: 25,
      buildPriority: 3,
      buildLabel: "Refine dashboard UX polish",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-20T08:00:00.000Z",
    },
    {
      area: "API + health checks",
      done: 45,
      buildPriority: 1,
      buildLabel: "Stabilize API + health checks",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
    },
    {
      area: "Data model",
      done: 55,
      buildPriority: 2,
      buildLabel: "Finish data model hardening",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-21T10:00:00.000Z",
    },
    {
      area: "Auth + RBAC",
      done: 12,
      buildPriority: 1,
      buildLabel: "Complete auth + RBAC delivery",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-22T07:00:00.000Z",
    },
  ],
  quickActions: [
    {
      text: "Open /api/ready and /api/v1/health in parallel.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
    {
      text: "Wire tenant auth middleware before moving to business routes.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-22T09:42:00.000Z",
    },
    {
      text: "Keep this file updated for release snapshots without code changes.",
      addedAt: "2026-01-15T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
    },
  ],
};

const getBuildVersion = () =>
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
  process.env.BUILD_ID ??
  process.env.npm_package_version ??
  "1.0.0";

const parseProgressPayload = (rawPayload, source) => {
  if (!rawPayload || typeof rawPayload !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return { parsed, source };
  } catch (_error) {
    return null;
  }
};

const parseProgressApiBase = () =>
  HEALTH_BASE_PATHS.map((key) => process.env[key])
    .find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;

const parseProgressTenantId = () =>
  HEALTH_TENANT_KEYS.map((key) => process.env[key])
    .find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;

const buildProgressApiUrl = (base, endpointPath) => {
  if (!base) {
    return null;
  }

  const requestPath = endpointPath.startsWith("/") ? endpointPath.slice(1) : endpointPath;
  const normalized = base.replace(/\/+$/, "");

  if (/^https?:\/\//i.test(normalized)) {
    const parsed = new URL(normalized.endsWith("/") ? normalized : `${normalized}/`);
    return new URL(requestPath, parsed).toString();
  }

  if (normalized.startsWith("/")) {
    const requestUrl = new URL(normalized.endsWith("/") ? normalized.slice(0, -1) : normalized, "http://127.0.0.1");
    return `${requestUrl.origin}${requestUrl.pathname}/${requestPath}`;
  }

  const fallbackBase = normalized.includes("://") ? normalized : `http://${normalized}`;
  const sanitized = fallbackBase.endsWith("/") ? fallbackBase.slice(0, -1) : fallbackBase;
  return `${sanitized}/${requestPath}`;
};

const parseJsonPayload = (rawPayload) => {
  if (!rawPayload || typeof rawPayload !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
};

const normalizeReleaseProgressItem = (item) => {
  if (!item || typeof item !== "object") {
    return null;
  }

  const area = typeof item.area === "string" ? item.area.trim() : "Unknown area";
  const done = Number.isFinite(Number(item.done))
    ? Math.max(0, Math.min(100, Number(item.done)))
    : 0;
  const buildPriority =
    Number.isFinite(Number(item.buildPriority))
      ? Math.max(1, Math.min(99, Math.round(Number(item.buildPriority))))
      : null;
  const buildLabel = typeof item.buildLabel === "string" && item.buildLabel.trim() ? item.buildLabel.trim() : null;
  const addedAt = typeof item.addedAt === "string" ? item.addedAt : null;
  const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : null;

  return {
    ...item,
    area,
    done,
    ...(buildPriority !== null ? { buildPriority } : {}),
    ...(buildLabel !== null ? { buildLabel } : {}),
    ...(addedAt !== null ? { addedAt } : {}),
    ...(updatedAt !== null ? { updatedAt } : {}),
  };
};

const applyApiHealthBuildDefaults = (item) => {
  const normalized = normalizeReleaseProgressItem(item);
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    buildPriority: normalized.buildPriority ?? API_HEALTH_DEFAULT_BUILD_PRIORITY,
    buildLabel: normalized.buildLabel ?? API_HEALTH_DEFAULT_BUILD_LABEL,
  };
};

const deriveCompletionFromChecks = (checks) => {
  if (!checks || typeof checks !== "object") {
    return null;
  }

  const values = Object.values(checks)
    .map((value) => {
      if (value === "ok") {
        return 1;
      }
      if (value === "warn") {
        return 0.6;
      }
      if (value === "down") {
        return 0;
      }
      return null;
    })
    .filter((value) => value !== null);

  if (values.length === 0) {
    return null;
  }

  const completion = (values.reduce((acc, value) => acc + value, 0) / values.length) * 100;
  return Math.max(0, Math.min(100, Math.round(completion)));
};

const readApiHealthCompletions = async () => {
  const rawApiBase = parseProgressApiBase();
  const checkedAt = new Date().toISOString();
  const tenantId = parseProgressTenantId();
  const requestHeaders = tenantId ? { "x-tenant-id": tenantId } : {};

  if (!rawApiBase) {
    return {
      completion: null,
      apiSignal: "warn",
      source: "api-health",
      sourceStatus: "unavailable",
      checkedAt,
      sampleCount: 0,
      requestedCount: API_HEALTH_PROBE_ENDPOINTS.length,
      errors: [
        {
          probe: "/v1/health",
          error: "Missing NEXT_PUBLIC_API_URL/API_BASE_URL/API_URL/DIAGNOSTICS_PROXY_API_BASE",
        },
      ],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Progress API health probe timed out after ${PROGRESS_HEALTH_TIMEOUT_MS}ms`));
  }, PROGRESS_HEALTH_TIMEOUT_MS);

  try {
    const completionSamples = [];
    const endpointErrors = [];
    const probeSummaries = [];
    for (const probe of API_HEALTH_PROBE_ENDPOINTS) {
      const targetUrl = buildProgressApiUrl(rawApiBase, probe);
      if (!targetUrl) {
        endpointErrors.push({
          probe,
          error: "Invalid upstream URL mapping",
        });
        continue;
      }

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          cache: "no-store",
          headers: requestHeaders,
          signal: controller.signal,
        });
        const rawBody = await response.text();
        const payload = parseJsonPayload(rawBody);
        const summary = {
          probe,
          status: response.status,
          requestedWithTenantHeader: Boolean(tenantId),
        };
        if (!payload) {
          endpointErrors.push({
            ...summary,
            error: `Invalid JSON from ${probe}`,
          });
          continue;
        }

        if (!response.ok) {
          endpointErrors.push({
            ...summary,
            error: `HTTP ${response.status} ${response.statusText}`,
          });
          continue;
        }

        const completion = deriveCompletionFromChecks(payload?.checks);
        if (typeof completion === "number") {
          completionSamples.push(completion);
          probeSummaries.push(summary);
          continue;
        }
        endpointErrors.push({
          ...summary,
          error: "No readable checks in response payload",
        });
      } catch (error) {
        probeSummaries.push({
          probe,
          requestedWithTenantHeader: Boolean(tenantId),
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    if (completionSamples.length === 0) {
      return {
        completion: null,
        apiSignal: "warn",
        source: "api-health",
        sourceStatus: "unavailable",
        checkedAt,
        sampleCount: 0,
        requestedCount: API_HEALTH_PROBE_ENDPOINTS.length,
        errors: endpointErrors,
        probeSummaries,
      };
    }

    const completion = Math.round(
      completionSamples.reduce((acc, value) => acc + value, 0) / completionSamples.length,
    );

    const sourceStatus = completionSamples.length >= API_HEALTH_PROBE_ENDPOINTS.length ? "live" : "partial";
    const apiSignal = completion >= 90 ? "implemented" : completion >= 60 ? "basic" : completion >= 35 ? "warn" : "blocked";
    return {
      completion,
      apiSignal,
      source: "api-health",
      sourceStatus,
      checkedAt,
      sampleCount: completionSamples.length,
      requestedCount: API_HEALTH_PROBE_ENDPOINTS.length,
      errors: endpointErrors,
      probeSummaries,
      missingTenantHeader: !tenantId,
    };
  } catch (error) {
    return {
      completion: null,
      apiSignal: "warn",
      source: "api-health",
      sourceStatus: "unavailable",
      checkedAt,
      sampleCount: 0,
      requestedCount: API_HEALTH_PROBE_ENDPOINTS.length,
      errors: [
        {
          probe: "all",
          error: error instanceof Error ? error.message : "unknown error",
        },
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
};

const overlayProgressFromApiHealth = (payload, healthOverlay) => {
  if (!payload) {
    return null;
  }
  if (!healthOverlay || typeof healthOverlay !== "object") {
    return {
      ...payload,
      progressSource: {
        source: "api-health",
        status: "unavailable",
        apiSignal: "warn",
        checkedAt: null,
        sampleCount: 0,
        requestedCount: API_HEALTH_PROBE_ENDPOINTS.length,
        errors: [],
      },
    };
  }

  const progressSource = {
    source: healthOverlay.source ?? "api-health",
    status: healthOverlay.sourceStatus ?? "unavailable",
    apiSignal: healthOverlay.apiSignal ?? "warn",
    checkedAt: healthOverlay.checkedAt ?? null,
    sampleCount: healthOverlay.sampleCount ?? 0,
    requestedCount: healthOverlay.requestedCount ?? API_HEALTH_PROBE_ENDPOINTS.length,
    errors: Array.isArray(healthOverlay.errors) ? healthOverlay.errors : [],
    probeSummaries: Array.isArray(healthOverlay.probeSummaries) ? healthOverlay.probeSummaries : [],
    missingTenantHeader: Boolean(healthOverlay.missingTenantHeader),
  };

  if (typeof healthOverlay.completion !== "number") {
    return {
      ...payload,
      progressSource: {
        ...progressSource,
      },
    };
  }

  const overlayProgress = Array.isArray(payload.progress) ? [...payload.progress] : [];
  const progressIndex = overlayProgress.findIndex((item) => item?.area === API_HEALTH_PROGRESS_AREA);
  const updatedAt = healthOverlay.checkedAt;

  if (progressIndex >= 0) {
    const current = overlayProgress[progressIndex] ?? {};
    const normalizedCurrent = applyApiHealthBuildDefaults(current);
    overlayProgress[progressIndex] = {
      ...normalizedCurrent,
      done: healthOverlay.completion,
      updatedAt,
    };
  } else {
    overlayProgress.push(applyApiHealthBuildDefaults({
      area: API_HEALTH_PROGRESS_AREA,
      done: healthOverlay.completion,
      addedAt: updatedAt,
      updatedAt,
    }));
  }

  const overlaySignals = Array.isArray(payload.productSignals) ? [...payload.productSignals] : [];
  const signalIndex = overlaySignals.findIndex((item) => item?.label === API_CONTRACT_SIGNAL);
  if (signalIndex >= 0) {
    const current = overlaySignals[signalIndex] ?? {};
    overlaySignals[signalIndex] = {
      ...current,
      status: healthOverlay.apiSignal,
      updatedAt,
    };
  }

  return {
    ...payload,
    progressSource: {
      ...progressSource,
      status: "applied",
    },
    releaseStatus: healthOverlay.completion < 35 ? "degraded" : payload.releaseStatus,
    progress: overlayProgress,
    productSignals: overlaySignals,
  };
};

const loadProgressFromFile = async (filePath, source) => {
  try {
    const rawPayload = await fs.readFile(filePath, "utf-8");
    const parsed = parseProgressPayload(rawPayload, source);
    return parsed;
  } catch (_error) {
    return null;
  }
};

const getDefaultProgressPath = () => {
  const cwd = process.cwd();
  const candidates = [
    process.env.RELEASE_PROGRESS_JSON_FILE,
    process.env.RELEASE_PROGRESS_FILE,
    path.resolve(cwd, "apps/web/public/release-progress.json"),
    path.resolve(cwd, "public/release-progress.json"),
    path.resolve(cwd, "release-progress.json"),
  ].filter(Boolean);

  return candidates;
};

const resolveProgressPayload = async () => {
  const inlinePayload = parseProgressPayload(process.env.RELEASE_PROGRESS_JSON, "RELEASE_PROGRESS_JSON");
  if (inlinePayload) {
    return inlinePayload;
  }

  const explicitFile = process.env.RELEASE_PROGRESS_JSON_FILE?.trim();
  if (explicitFile && !explicitFile.startsWith("{") && !explicitFile.startsWith("[")) {
    const absoluteFilePath = path.isAbsolute(explicitFile)
      ? explicitFile
      : path.resolve(process.cwd(), explicitFile);
    const filePayload = await loadProgressFromFile(absoluteFilePath, "RELEASE_PROGRESS_JSON_FILE");
    if (filePayload) {
      return { ...filePayload, source: "RELEASE_PROGRESS_JSON_FILE" };
    }
  }

  const fileCandidates = getDefaultProgressPath();
  for (const filePath of fileCandidates) {
    const payload = await loadProgressFromFile(filePath, `file:${filePath}`);
    if (payload) {
      return payload;
    }
  }

  return { parsed: RELEASE_PROGRESS_FALLBACK, source: "fallback" };
};

const sanitizeSource = (source) => {
  if (!source || source === "fallback") {
    return "fallback";
  }
  if (source === "RELEASE_PROGRESS_JSON") {
    return "RELEASE_PROGRESS_JSON";
  }
  if (source === "RELEASE_PROGRESS_JSON_FILE") {
    return "RELEASE_PROGRESS_JSON_FILE";
  }
  if (source.startsWith("file:")) {
    return "RELEASE_PROGRESS_JSON_FILE";
  }
  return source;
};

export async function GET() {
  const { parsed, source } = await resolveProgressPayload();
  const basePayload = {
    ...RELEASE_PROGRESS_FALLBACK,
    ...parsed,
  };
  const healthOverlay = await readApiHealthCompletions();
  const payload = overlayProgressFromApiHealth(basePayload, healthOverlay);
  const normalizedProgress = Array.isArray(payload.progress)
    ? payload.progress
        .map(normalizeReleaseProgressItem)
        .filter((item) => item !== null)
    : [];
  return Response.json({
    ...payload,
    progress: normalizedProgress,
    generatedAt: new Date().toISOString(),
    version: getBuildVersion(),
    status: "ready",
    service: payload.service ?? RELEASE_PROGRESS_FALLBACK.service,
    source: sanitizeSource(source),
  });
}
