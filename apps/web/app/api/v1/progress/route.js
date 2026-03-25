import fs from "node:fs/promises";
import path from "node:path";
import { readArtifact } from "../_lib/ops-artifacts.js";

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
const API_HEALTH_PROBE_ENDPOINTS = ["/api/v1/health", "/api/v1/status", "/api/health", "/api/ready"];
const API_HEALTH_DEFAULT_BUILD_PRIORITY = 1;
const API_HEALTH_DEFAULT_BUILD_LABEL = "Critical API stabilization";

const RELEASE_PROGRESS_FALLBACK = {
  service: "esg-rdt-master-web",
  releaseStatus: "pilot_ready",
  productSignals: [
    {
      label: "Web shell",
      status: "implemented",
      detail: "Enterprise shell, tenant navigation, and Biosphere theme are active in the current app surface.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      label: "API contract",
      status: "implemented",
      detail: "Core ESG APIs, tenant guards, requestId propagation, and health/status contracts are live; unresolved items should surface as warnings, not placeholders.",
      addedAt: "2026-02-24T09:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      label: "Worker loop",
      status: "warn",
      detail: "Worker cycle execution exists with overlap protection and structured logs; operational confidence still depends on final prod-like verification.",
      addedAt: "2026-02-24T09:05:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
  ],
  progress: [
    {
      area: "UI + UX",
      done: 82,
      buildPriority: 2,
      buildLabel: "Clarify pilot caveats without UX regressions",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      area: "API + health checks",
      done: 78,
      buildPriority: 1,
      buildLabel: "Close final prod-like readiness gaps",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      area: "Data model",
      done: 86,
      buildPriority: 2,
      buildLabel: "Expand demo data and export coverage",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      area: "Auth + RBAC",
      done: 84,
      buildPriority: 1,
      buildLabel: "Run final role matrix verification",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
  ],
  quickActions: [
    {
      text: "Run prod-like build/start, then compare /api/ready, /api/v1/health, and /api/v1/status.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      text: "Treat missing factors and partial Scope 3 categories as explicit caveats, not silent success.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    {
      text: "Keep this file aligned with the actual pilot-readiness state after each verification pass.",
      addedAt: "2026-01-15T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
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

const readSmokeArtifact = async () => readArtifact("last-smoke-prod-like.json");
const readSmokeHistory = async () => readArtifact("smoke-history.json");
const readBenchmarkArtifact = async () => readArtifact("benchmark-core.json");
const readBenchmarkHistory = async () => readArtifact("benchmark-history.json");

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
    const apiSignal = completion >= 90 ? "implemented" : completion >= 60 ? "warn" : completion >= 35 ? "warn" : "blocked";
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
    releaseStatus: healthOverlay.completion < 35 ? "degraded" : healthOverlay.completion < 80 ? "stabilizing" : payload.releaseStatus,
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

const toSection = ({ id, title, status, message, remediation, details = null }) => ({
  id,
  title,
  status,
  message,
  remediation,
  ...(details ? { details } : {}),
});

const buildSystemChecks = ({ payload, healthOverlay, smokeArtifact }) => {
  const progressAreas = Array.isArray(payload?.progress) ? payload.progress : [];
  const findArea = (label) => progressAreas.find((item) => item?.area === label) || null;
  const authArea = findArea("Auth + RBAC");
  const dataArea = findArea("Data model");
  const apiArea = findArea(API_HEALTH_PROGRESS_AREA);

  const unsupportedScope3Count = Array.isArray(smokeArtifact?.scope3Support)
    ? smokeArtifact.scope3Support.filter((item) => item?.status && item.status !== "supported").length
    : null;

  return [
    toSection({
      id: "auth",
      title: "Auth",
      status: (authArea?.done || 0) >= 80 ? "ok" : "warn",
      message: (authArea?.done || 0) >= 80 ? "Session and RBAC hardening are in pilot-ready state." : "Auth/RBAC still needs manual verification.",
      remediation: "Run authenticated smoke and validate role matrix on the pilot tenant.",
      details: authArea ? { completion: authArea.done } : null,
    }),
    toSection({
      id: "tenant_scope",
      title: "Tenant scope",
      status: healthOverlay?.missingTenantHeader ? "warn" : "ok",
      message: healthOverlay?.missingTenantHeader
        ? "Platform health is ready; tenant-scoped checks were evaluated without x-tenant-id."
        : "Tenant-scoped diagnostics are running with an explicit tenant header.",
      remediation: "Set DIAGNOSTICS_PROXY_TENANT_ID or pass x-tenant-id for full tenant-scoped diagnostics.",
    }),
    toSection({
      id: "standards",
      title: "Standards",
      status: (dataArea?.done || 0) >= 80 ? "ok" : "warn",
      message: "GRI/SASB mappings and company-enabled definitions are available.",
      remediation: "Verify company enablements and recommended mappings before the pilot workshop.",
    }),
    toSection({
      id: "factors",
      title: "Factors",
      status: smokeArtifact?.missingFactorsCount > 0 ? "warn" : "ok",
      message:
        smokeArtifact?.missingFactorsCount > 0
          ? `${smokeArtifact.missingFactorsCount} factor gap(s) were detected in the latest smoke/export context.`
          : "No factor gaps were flagged in the latest smoke/export context.",
      remediation: "Open /app/factors and apply tenant defaults or country overrides before presenting totals.",
    }),
    toSection({
      id: "ghg",
      title: "GHG",
      status: unsupportedScope3Count > 0 ? "warn" : "ok",
      message:
        unsupportedScope3Count > 0
          ? `${unsupportedScope3Count} Scope 3 category state(s) are not fully supported for pilot calculations.`
          : "GHG compute completed without unsupported Scope 3 categories in the latest artifact.",
      remediation: "Keep categories marked Partial or Not enabled out of committed totals.",
    }),
    toSection({
      id: "evidence",
      title: "Evidence",
      status: smokeArtifact?.evidenceCoverage?.missingCount > 0 ? "warn" : "ok",
      message:
        smokeArtifact?.evidenceCoverage?.missingCount > 0
          ? `${smokeArtifact.evidenceCoverage.missingCount} required evidence link(s) are still missing.`
          : "Required evidence coverage is complete in the latest audit pack artifact.",
      remediation: "Review snapshot.json -> evidenceCoverage.missingEvidence and add links before assurance sharing.",
    }),
    toSection({
      id: "exports",
      title: "Exports",
      status: smokeArtifact?.status === "passed" ? "ok" : apiArea?.done >= 80 ? "warn" : "warn",
      message:
        smokeArtifact?.status === "passed"
          ? "Latest prod-like smoke includes a successful audit pack export."
          : "No recent successful smoke artifact was found for exports.",
      remediation: "Run scripts/dev/smoke-prod-like.mjs before sign-off and keep the artifact with the build.",
    }),
  ];
};

export async function GET() {
  const { parsed, source } = await resolveProgressPayload();
  const basePayload = {
    ...RELEASE_PROGRESS_FALLBACK,
    ...parsed,
  };
  const healthOverlay = await readApiHealthCompletions();
  const smokeArtifact = await readSmokeArtifact();
  const smokeHistory = await readSmokeHistory();
  const benchmarkArtifact = await readBenchmarkArtifact();
  const benchmarkHistory = await readBenchmarkHistory();
  const payload = overlayProgressFromApiHealth(basePayload, healthOverlay);
  const normalizedProgress = Array.isArray(payload.progress)
    ? payload.progress
        .map(normalizeReleaseProgressItem)
        .filter((item) => item !== null)
    : [];
  return Response.json({
    ...payload,
    progress: normalizedProgress,
    systemChecks: buildSystemChecks({ payload, healthOverlay, smokeArtifact }),
    lastSmoke: smokeArtifact,
    smokeHistory: Array.isArray(smokeHistory?.items) ? smokeHistory.items : [],
    lastBenchmark: benchmarkArtifact,
    benchmarkHistory: Array.isArray(benchmarkHistory?.items) ? benchmarkHistory.items : [],
    generatedAt: new Date().toISOString(),
    version: getBuildVersion(),
    status: "ready",
    service: payload.service ?? RELEASE_PROGRESS_FALLBACK.service,
    source: sanitizeSource(source),
  });
}
