"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const endpointCatalog = [
  {
    href: "/api/ready",
    title: "Ready",
    description: "Lightweight web readiness signal.",
  },
  {
    href: "/api/v1/health",
    title: "Health",
    description: "Runtime + DB availability check.",
  },
  {
    href: "/api/v1/status",
    title: "Status",
    description: "Tenant and subsystem readiness payload.",
  },
];

const statusFromPayload = (payload, statusCode) => {
  const rawStatus = typeof payload?.status === "string" ? payload.status : "unknown";
  if (rawStatus === "ok" || rawStatus === "ready") {
    return { label: rawStatus, tone: "ok" };
  }
  if (rawStatus === "degraded" || rawStatus === "warn" || rawStatus === "down") {
    return { label: rawStatus, tone: "warn" };
  }
  if (statusCode >= 500) {
    return { label: "error", tone: "error" };
  }
  if (statusCode >= 400) {
    return { label: "failed", tone: "warn" };
  }
  return { label: "unknown", tone: "unknown" };
};

const lastPollStatusFromSignal = (signal) => {
  if (signal?.isStale) {
    return "degraded";
  }
  if (signal?.tone === "ok") {
    return "ok";
  }
  if (signal?.tone === "warn" || signal?.tone === "stale" || signal?.tone === "unknown") {
    return "degraded";
  }
  return "failed";
};

const slugify = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const signalActionHintFromLabel = (label) => {
  const normalized = label.toLowerCase();
  if (normalized.includes("api") || normalized.includes("ready")) {
    return {
      href: "/api/ready",
      cta: "Open readiness endpoint",
    };
  }
  if (normalized.includes("worker") || normalized.includes("health")) {
    return {
      href: "/api/v1/health",
      cta: "Open health endpoint",
    };
  }
  if (normalized.includes("status")) {
    return {
      href: "/api/v1/status",
      cta: "Open status endpoint",
    };
  }
  return null;
};

const buildDetails = (payload, statusCode) => {
  const checks = payload?.checks && typeof payload.checks === "object" ? payload.checks : null;
  const requestId = payload?.requestId ? `requestId ${payload.requestId.slice(0, 8)}` : null;
  const tenantScope = payload?.tenantScope ?? checks?.tenantScope;
  const failingChecks = checks
    ? Object.entries(checks).filter(([, value]) => value === "warn" || value === "down").map(([key, value]) => `${key}:${value}`)
    : [];
  const labels = [];

  labels.push(`HTTP ${statusCode}`);
  if (requestId) labels.push(requestId);
  if (failingChecks.length > 0) labels.push(failingChecks.join(", "));
  if (tenantScope) labels.push(`tenantScope ${tenantScope}`);

  return labels.join(" · ") || "No diagnostics available.";
};

const formatAge = (isoTimestamp, nowMs = Date.now()) => {
  const startedAtMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }
  const ageMs = Math.max(0, nowMs - startedAtMs);
  if (ageMs < 1000) {
    return "just now";
  }
  if (ageMs < 60_000) {
    return `${Math.round(ageMs / 1000)}s`;
  }
  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m`;
  }
  const hours = Math.round(ageMs / 3_600_000);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
};

const failureDetailsFromPrevious = (message, previousState, nowMs) => {
  if (!previousState?.lastSuccessAt) {
    return `Unavailable: ${message}`;
  }

  const staleAge = formatAge(previousState.lastSuccessAt, nowMs);
  const ageText = staleAge ? ` (${staleAge} old)` : "";
  return `Using stale data${ageText}. ${message}`;
};

const formatRelativeAge = (isoTimestamp, nowMs = Date.now()) => {
  const startedAtMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }
  const ageMs = Math.max(0, nowMs - startedAtMs);
  if (ageMs < 30_000) {
    return "just now";
  }
  if (ageMs < 60_000) {
    return `${Math.floor(ageMs / 1000)}s ago`;
  }
  if (ageMs < 60 * 60_000) {
    return `${Math.floor(ageMs / 60_000)}m ago`;
  }
  if (ageMs < 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  }
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
};

const COMPACT_MODULE_STORAGE_KEY = "esg-rdt-module-compact-rows-v1";
const MODULE_COMPLETION_PREFERENCES_STORAGE_KEY = "esg-rdt-module-completion-preferences-v1";
const COMPACT_MODULE_THRESHOLD = 6;

const getStoredModuleCompletionPreferences = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(MODULE_COMPLETION_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
};

const setStoredModuleCompletionPreferences = (preferences) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const value = {
      moduleSortMode: preferences.moduleSortMode,
      showAtRiskModulesOnly: preferences.showAtRiskModulesOnly,
      moduleDeltaBucketFilter: preferences.moduleDeltaBucketFilter,
    };
    window.localStorage.setItem(MODULE_COMPLETION_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
  } catch (_error) {
    // Ignore storage errors in restricted environments.
  }
};

const getStoredCompactModuleMode = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(COMPACT_MODULE_STORAGE_KEY);
    if (stored === "on") {
      return true;
    }
    if (stored === "off") {
      return false;
    }
    return null;
  } catch (_error) {
    return null;
  }
};

const setStoredCompactModuleMode = (value) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(COMPACT_MODULE_STORAGE_KEY, value ? "on" : "off");
  } catch (_error) {
    // Ignore storage errors in restricted environments.
  }
};

const formatActionAge = (action) => {
  if (!action || typeof action !== "object") {
    return "";
  }
  const updatedText = formatRelativeAge(action.updatedAt);
  const addedText = formatRelativeAge(action.addedAt);
  if (updatedText) {
    return `Updated ${updatedText}`;
  }
  if (addedText) {
    return `Added ${addedText}`;
  }
  return "";
};

const formatModuleMetaAge = (addedAt, updatedAt) => {
  const updatedText = formatRelativeAge(updatedAt);
  const addedText = formatRelativeAge(addedAt);
  if (updatedText) {
    return `Updated ${updatedText}`;
  }
  if (addedText) {
    return `Added ${addedText}`;
  }
  return "Update time unavailable";
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const renderHighlightedText = (value, query) => {
  const text = typeof value === "string" ? value : "";
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) {
    return text;
  }

  const pattern = new RegExp(escapeRegExp(normalizedQuery), "gi");
  const segments = [];
  let lastIndex = 0;
  let match;
  let loopSafety = 0;

  while ((match = pattern.exec(text)) !== null && loopSafety < 200) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (matchStart > lastIndex) {
      segments.push(text.slice(lastIndex, matchStart));
    }
    segments.push(
      <mark className="module-search-highlight" key={`match-${matchStart}-${loopSafety}`}>
        {text.slice(matchStart, matchEnd)}
      </mark>,
    );
    lastIndex = matchEnd;
    loopSafety += 1;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }
  if (segments.length === 0) {
    return text;
  }
  return <>{segments}</>;
};

const navigateToAction = (href) => {
  if (typeof href === "string" && href.trim()) {
    window.location.assign(href);
  }
};

const getEndpointSourceTone = (source) => {
  if (source === "live") {
    return "ok";
  }
  if (source === "stale") {
    return "warn";
  }
  return "error";
};

const getEndpointSourceLabel = (source) => {
  if (source === "live") {
    return "live";
  }
  if (source === "stale") {
    return "stale data";
  }
  return "unavailable";
};

const buildProxyConfigHint = (signals) => {
  if (!Array.isArray(signals) || signals.length === 0) {
    return null;
  }

  const allUnavailable = signals.every((signal) => signal.source === "unavailable");
  const anyLive = signals.some((signal) => signal.source === "live");
  const missingUpstream = signals.some(
    (signal) => signal.lastFailureReason && /Missing upstream API base URL/i.test(signal.lastFailureReason),
  );

  if (!anyLive && missingUpstream) {
    return {
      tone: "error",
      text: "No diagnostics backend base configured. Set NEXT_PUBLIC_API_URL or API_BASE_URL (or API_URL) so probes target your API.",
    };
  }

  if (allUnavailable && !missingUpstream) {
    return {
      tone: "warn",
      text: "Endpoint probes are currently unavailable. Check network and API availability, then refresh manually.",
    };
  }

  if (allUnavailable) {
    return {
      tone: "warn",
      text: "All endpoint probes are currently unavailable; keep an eye on Probe source badges for data freshness.",
    };
  }

  if (signals.some((signal) => signal.source === "unavailable")) {
    return {
      tone: "warn",
      text: "Some endpoint probes are unavailable right now and are shown as stale/unavailable.",
    };
  }

  return null;
};

const getActionTimestampsForSort = (action) => {
  const updatedAt = action?.updatedAt ? Date.parse(action.updatedAt) : null;
  const addedAt = action?.addedAt ? Date.parse(action.addedAt) : null;

  return {
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    addedAt: Number.isFinite(addedAt) ? addedAt : null,
  };
};

const sortActionItemsByUpdatedAt = (items) => [...items].sort((left, right) => {
  const leftTs = getActionTimestampsForSort(left);
  const rightTs = getActionTimestampsForSort(right);

  if (leftTs.updatedAt !== null && rightTs.updatedAt !== null && leftTs.updatedAt !== rightTs.updatedAt) {
    return rightTs.updatedAt - leftTs.updatedAt;
  }
  if (leftTs.updatedAt !== null && rightTs.updatedAt === null) {
    return -1;
  }
  if (leftTs.updatedAt === null && rightTs.updatedAt !== null) {
    return 1;
  }

  if (leftTs.addedAt !== null && rightTs.addedAt !== null && leftTs.addedAt !== rightTs.addedAt) {
    return rightTs.addedAt - leftTs.addedAt;
  }
  if (leftTs.addedAt !== null && rightTs.addedAt === null) {
    return -1;
  }
  if (leftTs.addedAt === null && rightTs.addedAt !== null) {
    return 1;
  }

  const leftPriority = Number.isFinite(Number(left?.priority)) ? Number(left.priority) : 99;
  const rightPriority = Number.isFinite(Number(right?.priority)) ? Number(right.priority) : 99;
  return leftPriority - rightPriority;
});

const getUpdateSourcePresentation = (source) => {
  if (source === "RELEASE_PROGRESS_JSON") {
    return {
      text: "Updated via RELEASE_PROGRESS_JSON",
      className: "update-source-json",
    };
  }
  if (source === "RELEASE_PROGRESS_JSON_FILE" || source?.startsWith("file:")) {
    return {
      text: "Updated via RELEASE_PROGRESS_JSON_FILE",
      className: "update-source-json-file",
    };
  }
  return {
    text: "Updated via fallback",
    className: "update-source-fallback",
  };
};

const normalizeProgressSource = (payloadSource) => {
  if (!payloadSource || typeof payloadSource !== "object") {
    return null;
  }

  return {
    source: typeof payloadSource.source === "string" ? payloadSource.source : "api-health",
    status: typeof payloadSource.status === "string" ? payloadSource.status : "unavailable",
    apiSignal: typeof payloadSource.apiSignal === "string" ? payloadSource.apiSignal : "warn",
    checkedAt: typeof payloadSource.checkedAt === "string" ? payloadSource.checkedAt : null,
    sampleCount: Number.isFinite(Number(payloadSource.sampleCount)) ? Number(payloadSource.sampleCount) : 0,
    requestedCount: Number.isFinite(Number(payloadSource.requestedCount)) ? Number(payloadSource.requestedCount) : 0,
    missingTenantHeader: Boolean(payloadSource.missingTenantHeader),
    errors: Array.isArray(payloadSource.errors) ? payloadSource.errors : [],
  };
};

const getProgressSourcePresentation = (progressSource) => {
  if (!progressSource || typeof progressSource !== "object") {
    return {
      tone: "warn",
      text: "Progress completion source: unavailable",
    };
  }

  const status = progressSource.status;
  if (status === "applied") {
    return {
      tone: "ok",
      text: `Progress completion from live health probes (${progressSource.sampleCount}/${progressSource.requestedCount})`,
    };
  }

  if (status === "partial") {
    return {
      tone: "warn",
      text: `Progress completion partially derived from health probes (${progressSource.sampleCount}/${progressSource.requestedCount})`,
    };
  }

  return {
    tone: "warn",
    text: "Progress completion uses release snapshot fallback",
  };
};

const fallbackProgressState = {
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
      detail: "Core endpoints and shared check schema are wired; several checks are still placeholder values.",
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
    },
    {
      text: "Wire tenant auth middleware before moving to business routes.",
      addedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-22T09:42:00.000Z",
    },
    {
      text: "Keep this file updated for release snapshots without code changes.",
      addedAt: "2026-01-15T00:00:00.000Z",
    },
  ],
};

const normalizeProgressResponse = (payload) => {
  if (!payload || typeof payload !== "object") {
    return fallbackProgressState;
  }

  const productSignals = Array.isArray(payload.productSignals)
    ? payload.productSignals
    : fallbackProgressState.productSignals;
  const progress = Array.isArray(payload.progress) ? payload.progress : fallbackProgressState.progress;
  const quickActions = Array.isArray(payload.quickActions)
    ? payload.quickActions
    : fallbackProgressState.quickActions;

  return {
    service: payload.service ?? fallbackProgressState.service,
    releaseStatus: payload.releaseStatus ?? fallbackProgressState.releaseStatus,
    progressSource: normalizeProgressSource(payload.progressSource),
    productSignals: productSignals.map((item) => ({
      label: typeof item.label === "string" ? item.label : "Unknown",
      status: typeof item.status === "string" ? item.status : "unknown",
      detail: typeof item.detail === "string" ? item.detail : "No details available.",
      addedAt: typeof item.addedAt === "string" ? item.addedAt : null,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    })),
    progress: progress.map((item) => ({
      area: typeof item.area === "string" ? item.area : "Unknown area",
      done: Number.isFinite(Number(item.done)) ? Math.max(0, Math.min(100, Number(item.done))) : 0,
      buildPriority:
        Number.isFinite(Number(item.buildPriority))
          ? Math.max(1, Math.min(99, Math.round(Number(item.buildPriority))))
          : null,
      buildLabel: typeof item.buildLabel === "string" && item.buildLabel.trim() ? item.buildLabel.trim() : null,
      addedAt: typeof item.addedAt === "string" ? item.addedAt : null,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    })),
    quickActions: quickActions.map((item) => {
      if (typeof item === "string") {
        return { text: item, addedAt: null, updatedAt: null };
      }
      if (item && typeof item === "object") {
        return {
          text: typeof item.text === "string" ? item.text : "Review this item.",
          addedAt: typeof item.addedAt === "string" ? item.addedAt : null,
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
        };
      }
      return { text: "Review this item.", addedAt: null, updatedAt: null };
    }),
  };
};

const getProgressMap = (progressItems) => {
  const items = Array.isArray(progressItems) ? progressItems : [];
  const map = new Map();
  items.forEach((item) => {
    if (!item || typeof item.area !== "string") {
      return;
    }
    const done = Number.isFinite(Number(item.done)) ? Number(item.done) : 0;
    map.set(item.area, Math.max(0, Math.min(100, done)));
  });
  return map;
};

const progressToneFromDone = (done) => {
  if (done >= 80) {
    return "ok";
  }
  if (done >= 50) {
    return "warn";
  }
  return "error";
};

const progressLabelFromDone = (done) => {
  if (done >= 95) {
    return "near-complete";
  }
  if (done >= 80) {
    return "in progress";
  }
  if (done >= 50) {
    return "mid progress";
  }
  return "early stage";
};

const formatModuleDelta = (delta) => {
  if (delta === null || Number.isNaN(delta)) {
    return "new";
  }
  if (delta === 0) {
    return "0";
  }
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta}`;
};

const getModuleDeltaDisplay = (delta) => {
  const formattedDelta = formatModuleDelta(delta);
  if (formattedDelta === "new") {
    return "new";
  }
  return `${formattedDelta}%`;
};

const getModuleDevelopmentBuildPlan = (module) => {
  const buildPriority = Number.isFinite(module?.buildPriority) ? module.buildPriority : null;
  const buildLabel = typeof module?.buildLabel === "string" ? module.buildLabel.trim() : "";

  if (buildPriority !== null) {
    const safePriority = Math.max(1, Math.min(99, Math.round(buildPriority)));
    if (safePriority <= 1) {
      return {
        tone: "critical",
        shortLabel: buildLabel || "Critical build",
        isActionable: true,
        priority: safePriority,
        cta: "Start critical build",
      };
    }
    if (safePriority <= 2) {
      return {
        tone: "required",
        shortLabel: buildLabel || "Build needed",
        isActionable: true,
        priority: safePriority,
        cta: "Prioritize build",
      };
    }
    if (safePriority === 3) {
      return {
        tone: "watch",
        shortLabel: buildLabel || "Watch trend",
        isActionable: true,
        priority: safePriority,
        cta: "Review trend",
      };
    }
    return {
      tone: "neutral",
      shortLabel: buildLabel || "Queued",
      isActionable: false,
      priority: safePriority,
      cta: "Monitor",
    };
  }

  return {
    tone: "neutral",
    shortLabel: buildLabel || null,
    isActionable: false,
    priority: 99,
    cta: "Monitor",
  };
};

const compareModuleDevelopmentBuildPlan = (left, right) => {
  const leftPriority = Number.isFinite(left?.developmentBuild?.priority)
    ? left.developmentBuild.priority
    : 99;
  const rightPriority = Number.isFinite(right?.developmentBuild?.priority)
    ? right.developmentBuild.priority
    : 99;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (left.done !== right.done) {
    return right.done - left.done;
  }

  const leftDelta = Number.isFinite(left?.delta) ? Math.abs(left.delta) : -1;
  const rightDelta = Number.isFinite(right?.delta) ? Math.abs(right.delta) : -1;
  if (leftDelta !== rightDelta) {
    return rightDelta - leftDelta;
  }

  return left.area.localeCompare(right.area);
};

const getModuleDeltaBucket = (delta) => {
  if (delta === null || Number.isNaN(delta)) {
    return "flat";
  }
  if (delta > 0) {
    return "up";
  }
  if (delta < 0) {
    return "down";
  }
  return "flat";
};

const signalToneFromStatus = (status) => {
  const normalized = String(status ?? "").toLowerCase();
  if (
    normalized.includes("implemented")
    || normalized.includes("ready")
    || normalized.includes("complete")
    || normalized === "ok"
  ) {
    return "ok";
  }
  if (
    normalized.includes("scaffolded")
    || normalized.includes("basic")
    || normalized.includes("warn")
    || normalized.includes("mid")
    || normalized.includes("progress")
  ) {
    return "warn";
  }
  if (
    normalized.includes("blocked")
    || normalized.includes("error")
    || normalized.includes("failed")
  ) {
    return "error";
  }
  return "unknown";
};

const riskPriorityFromTone = (tone) => {
  if (tone === "error") {
    return 0;
  }
  if (tone === "warn") {
    return 1;
  }
  if (tone === "ok") {
    return 2;
  }
  return 3;
};

const clampPercent = (value, total) => {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
};

const getOverallRiskTrendTone = (riskDelta) => {
  if (riskDelta === null || Number.isNaN(riskDelta)) {
    return "unknown";
  }
  if (riskDelta > 0) {
    return "ok";
  }
  if (riskDelta < 0) {
    return "error";
  }
  return "warn";
};

const getAtRiskTrendTone = (riskDelta) => {
  if (riskDelta === null || Number.isNaN(riskDelta)) {
    return "unknown";
  }
  if (riskDelta > 0) {
    return "error";
  }
  if (riskDelta < 0) {
    return "ok";
  }
  return "warn";
};

const getModuleRiskSeverityLabel = (tone) => {
  if (tone === "error") {
    return "critical";
  }
  if (tone === "warn") {
    return "warning";
  }
  return "stable";
};

const isValidModuleSortMode = (value) => value === "risk" || value === "completion" || value === "recent-delta" || value === "biggest-delta" || value === "name";
const isValidModuleDeltaFilter = (value) => value === "all" || value === "up" || value === "flat" || value === "down";

const getValidModuleSortMode = (value) => (isValidModuleSortMode(value) ? value : "risk");
const getValidModuleDeltaFilter = (value) => (isValidModuleDeltaFilter(value) ? value : "all");

const resolveRefreshIntervalMs = () => {
  const parsedInterval = Number(process.env.NEXT_PUBLIC_DASHBOARD_REFRESH_MS ?? 30000);
  if (!Number.isFinite(parsedInterval)) {
    return 30000;
  }
  return Math.max(3000, Math.floor(parsedInterval));
};

const initSignals = endpointCatalog.map((endpoint) => ({
  ...endpoint,
  status: "loading",
  tone: "unknown",
  source: "initial",
  details: "Initializing endpoint probes.",
  lastSuccessAt: null,
  isStale: false,
  lastFailureAt: null,
  lastFailureReason: null,
}));

export default function Home() {
  const [signals, setSignals] = useState(initSignals);
  const [releaseState, setReleaseState] = useState(fallbackProgressState);
  const [releaseSource, setReleaseSource] = useState("fallback");
  const [lastUpdated, setLastUpdated] = useState("Loading");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastPollLatencyMs, setLastPollLatencyMs] = useState(null);
  const [releaseGeneratedAt, setReleaseGeneratedAt] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [copiedState, setCopiedState] = useState("idle");
  const [showAllActions, setShowAllActions] = useState(false);
  const [showAllModules, setShowAllModules] = useState(false);
  const [showAtRiskModulesOnly, setShowAtRiskModulesOnly] = useState(false);
  const [moduleSortMode, setModuleSortMode] = useState("risk");
  const [expandedModuleAreas, setExpandedModuleAreas] = useState(new Set());
  const [compactModuleRows, setCompactModuleRows] = useState(false);
  const [moduleSearchQuery, setModuleSearchQuery] = useState("");
  const [moduleDeltaBucketFilter, setModuleDeltaBucketFilter] = useState("all");
  const [proxySourceHint, setProxySourceHint] = useState(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const previousProgressRef = useRef(new Map());
  const previousOverallRiskRef = useRef({ score: null, atRiskPercent: 0, atRiskCount: 0 });
  const moduleDeltaRef = useRef(new Map());
  const refreshIntervalMs = resolveRefreshIntervalMs();

  const loadSignals = useCallback(async () => {
    if (!isMountedRef.current || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const loadStartedAtIso = new Date().toISOString();
    setIsRefreshing(true);
    const timerStart = performance.now();

    try {
      const endpointResults = await Promise.allSettled(
        endpointCatalog.map((endpoint) =>
          fetch(endpoint.href, { cache: "no-store" }).then(async (response) => {
            const payload = await response.json().catch(() => null);
            return { endpoint, statusCode: response.status, payload };
          }),
        ),
      );

      const releaseResponse = await fetch("/api/v1/progress", { cache: "no-store" }).catch(() => null);
      const releasePayload = await (releaseResponse ? releaseResponse.json().catch(() => null) : Promise.resolve(null));
      const nextReleaseState = normalizeProgressResponse(releasePayload);
      const nextReleaseSource = releasePayload?.source ?? "fallback";
      const nextReleaseGeneratedAt = releasePayload?.generatedAt ?? null;
      const nextProgressMap = getProgressMap(nextReleaseState.progress);
      const nextDeltaMap = new Map();
      nextProgressMap.forEach((done, area) => {
        const previousDone = previousProgressRef.current.get(area);
        nextDeltaMap.set(area, previousDone === undefined ? null : done - previousDone);
      });
      moduleDeltaRef.current = nextDeltaMap;
      previousProgressRef.current = nextProgressMap;

      if (!isMountedRef.current) {
        return;
      }

      let nextSignals = [];
      setSignals((currentSignals) => {
        nextSignals = endpointCatalog.map((endpoint, index) => {
          const result = endpointResults[index];
          const previous = currentSignals[index];
          if (!result) {
            return {
              ...endpoint,
              status: "failed",
              tone: "error",
              source: "unavailable",
              details: "Request skipped or returned no data.",
              lastSuccessAt: previous?.lastSuccessAt ?? null,
              isStale: !!previous?.lastSuccessAt,
              lastFailureAt: loadStartedAtIso,
              lastFailureReason: "No response data",
            };
          }

          if (result.status === "rejected") {
            const failureMessage = String(result.reason?.message || result.reason || "Request failed");
            return {
              ...endpoint,
              status: previous?.lastSuccessAt ? "stale" : "failed",
              tone: previous?.lastSuccessAt ? "stale" : "error",
              source: previous?.lastSuccessAt ? "stale" : "unavailable",
              details: previous?.lastSuccessAt
                ? failureDetailsFromPrevious(failureMessage, previous, Date.now())
                : `Request failed: ${failureMessage}`,
              lastSuccessAt: previous?.lastSuccessAt ?? null,
              isStale: !!previous?.lastSuccessAt,
              lastFailureAt: loadStartedAtIso,
              lastFailureReason: failureMessage,
            };
          }

          const { statusCode, payload } = result.value;
          if (statusCode >= 400) {
            const status = statusFromPayload(payload, statusCode);
            const failureMessage = `HTTP ${statusCode}. ${buildDetails(payload, statusCode)}`;
            if (previous?.lastSuccessAt) {
              return {
                ...endpoint,
                status: "stale",
                tone: "stale",
                source: "stale",
                details: failureDetailsFromPrevious(failureMessage, previous, Date.now()),
                lastSuccessAt: previous.lastSuccessAt,
                isStale: true,
                lastFailureAt: loadStartedAtIso,
                lastFailureReason: `HTTP ${statusCode}`,
              };
            }

            return {
              ...endpoint,
              status: status.label,
              tone: status.tone,
              source: "unavailable",
              details: failureMessage,
              lastSuccessAt: null,
              isStale: false,
              lastFailureAt: loadStartedAtIso,
              lastFailureReason: `HTTP ${statusCode}`,
            };
          }

          const status = statusFromPayload(payload, statusCode);
          return {
            ...endpoint,
            status: status.label,
            tone: status.tone,
            source: "live",
            details: buildDetails(payload, statusCode),
            lastSuccessAt: loadStartedAtIso,
            isStale: false,
            lastFailureAt: null,
            lastFailureReason: null,
          };
        });
        return nextSignals;
      });
      if (isMountedRef.current) {
        setProxySourceHint(buildProxyConfigHint(nextSignals));
      }

      setReleaseState(nextReleaseState);
      setReleaseSource(nextReleaseSource);
      setReleaseGeneratedAt(nextReleaseGeneratedAt);
      setLastUpdated(loadStartedAtIso);
      setLastPollLatencyMs(Math.max(1, Math.round(performance.now() - timerStart)));
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      moduleDeltaRef.current = new Map();
      previousProgressRef.current = getProgressMap(fallbackProgressState.progress);

      setSignals((currentSignals) =>
        currentSignals.map((signal) => ({
          ...signal,
          status: signal.lastSuccessAt ? "stale" : "failed",
          tone: signal.lastSuccessAt ? "stale" : "error",
          source: signal.lastSuccessAt ? "stale" : "unavailable",
          details: signal.lastSuccessAt
            ? failureDetailsFromPrevious(
                `Refresh cycle failed (${error?.message ?? "unknown error"})`,
                signal,
                Date.now(),
              )
            : `Unavailable: refresh cycle failed (${error?.message ?? "unknown error"})`,
          isStale: !!signal.lastSuccessAt,
          lastFailureAt: loadStartedAtIso,
          lastFailureReason: error?.message ?? "Refresh error",
        })),
      );
      if (isMountedRef.current) {
        setProxySourceHint({
          tone: "warn",
          text: `Refresh cycle failed: ${error?.message ?? "unknown error"}. Retrying every ${Math.round(refreshIntervalMs / 1000)}s.`,
        });
      }
      setReleaseSource("fallback");
      setReleaseState(fallbackProgressState);
      setReleaseGeneratedAt(null);
      setLastPollLatencyMs(Math.max(1, Math.round(performance.now() - timerStart)));
    } finally {
        if (isMountedRef.current) {
          setIsRefreshing(false);
          inFlightRef.current = false;
        }
    }
  }, [refreshIntervalMs]);

  const copyProgressSnapshot = async () => {
    setCopiedState("idle");
    const snapshot = {
      ...releaseState,
      source: releaseSource,
      generatedAt: releaseGeneratedAt ?? new Date().toISOString(),
    };
    const snapshotText = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(snapshotText);
      setCopiedState("copied");
      window.setTimeout(() => {
        setCopiedState("idle");
      }, 1600);
      return;
    } catch (_error) {
      setCopiedState("error");
      window.setTimeout(() => {
        setCopiedState("idle");
      }, 1600);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    setIsHydrated(true);
    loadSignals();
    refreshTimerRef.current = window.setInterval(loadSignals, refreshIntervalMs);

    return () => {
      isMountedRef.current = false;
      inFlightRef.current = false;
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [loadSignals, refreshIntervalMs]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const storedCompactMode = getStoredCompactModuleMode();
    if (storedCompactMode === null) {
      setCompactModuleRows(releaseState.progress.length > COMPACT_MODULE_THRESHOLD);
      return;
    }
    setCompactModuleRows(storedCompactMode);
  }, [isHydrated, releaseState.progress.length]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const storedPreferences = getStoredModuleCompletionPreferences();
    if (!storedPreferences) {
      return;
    }
    const nextSortMode = getValidModuleSortMode(storedPreferences.moduleSortMode);
    const nextDeltaFilter = getValidModuleDeltaFilter(storedPreferences.moduleDeltaBucketFilter);
    if (moduleSortMode !== nextSortMode) {
      setModuleSortMode(nextSortMode);
    }
    if (showAtRiskModulesOnly !== Boolean(storedPreferences.showAtRiskModulesOnly)) {
      setShowAtRiskModulesOnly(Boolean(storedPreferences.showAtRiskModulesOnly));
    }
    if (moduleDeltaBucketFilter !== nextDeltaFilter) {
      setModuleDeltaBucketFilter(nextDeltaFilter);
    }
  }, [isHydrated, moduleSortMode, moduleDeltaBucketFilter, showAtRiskModulesOnly]);

  const moduleItems = releaseState.progress.map((item) => {
    const done = Math.max(0, Math.min(100, Number(item.done) || 0));
    const area = item.area ?? "Unknown area";
    const delta = moduleDeltaRef.current.get(area) ?? null;
    const normalizedAddedAt = item.addedAt ?? null;
    const normalizedUpdatedAt = item.updatedAt ?? null;
    const tone = progressToneFromDone(done);
    return {
      area,
      done,
      buildPriority: item.buildPriority ?? null,
      buildLabel: item.buildLabel ?? null,
      delta,
      tone,
      developmentBuild: getModuleDevelopmentBuildPlan({
        area,
        done,
        delta,
        tone,
        buildPriority: item.buildPriority ?? null,
        buildLabel: item.buildLabel ?? null,
      }),
      addedAt: normalizedAddedAt,
      updatedAt: normalizedUpdatedAt,
      addedTs: Number.isFinite(Date.parse(normalizedAddedAt ?? "")) ? Date.parse(normalizedAddedAt) : null,
      updatedTs: Number.isFinite(Date.parse(normalizedUpdatedAt ?? "")) ? Date.parse(normalizedUpdatedAt) : null,
      statusText: progressLabelFromDone(done),
    };
  });
  const sortedModuleItems = [...moduleItems].sort((left, right) => {
    if (moduleSortMode === "completion") {
      return right.done - left.done;
    }
    if (moduleSortMode === "recent-delta") {
      const leftTs = left.updatedTs ?? left.addedTs ?? Number.NEGATIVE_INFINITY;
      const rightTs = right.updatedTs ?? right.addedTs ?? Number.NEGATIVE_INFINITY;
      if (rightTs !== leftTs) {
        return rightTs - leftTs;
      }
      return right.done - left.done;
    }
    if (moduleSortMode === "biggest-delta") {
      const leftDelta = Number.isFinite(left.delta) ? Math.abs(left.delta) : -1;
      const rightDelta = Number.isFinite(right.delta) ? Math.abs(right.delta) : -1;
      if (rightDelta !== leftDelta) {
        return rightDelta - leftDelta;
      }
      return right.done - left.done;
    }
    if (moduleSortMode === "name") {
      return left.area.localeCompare(right.area);
    }
    return riskPriorityFromTone(left.tone) - riskPriorityFromTone(right.tone) || right.done - left.done;
  });
  const normalizedModuleQuery = moduleSearchQuery.trim().toLowerCase();
  const searchedModuleItems = normalizedModuleQuery === ""
    ? sortedModuleItems
    : sortedModuleItems.filter((module) => module.area.toLowerCase().includes(normalizedModuleQuery));
  const atRiskModules = sortedModuleItems.filter((module) => module.tone === "error" || module.tone === "warn");
  const atRiskSearchedModules = searchedModuleItems.filter((module) => module.tone === "error" || module.tone === "warn");
  const deltaFilteredModuleItems = moduleDeltaBucketFilter === "all"
    ? searchedModuleItems
    : searchedModuleItems.filter((module) => getModuleDeltaBucket(module.delta) === moduleDeltaBucketFilter);
  const atRiskDeltaFilteredModules = moduleDeltaBucketFilter === "all"
    ? atRiskSearchedModules
    : atRiskSearchedModules.filter((module) => getModuleDeltaBucket(module.delta) === moduleDeltaBucketFilter);
  const atRiskDevelopmentBuildQueue = atRiskDeltaFilteredModules
    .filter((module) => module.developmentBuild?.isActionable)
    .sort(compareModuleDevelopmentBuildPlan);
  const topDevelopmentBuildModules = atRiskDevelopmentBuildQueue.slice(0, 4);
  const filteredModuleItems = showAtRiskModulesOnly
    ? atRiskDeltaFilteredModules
    : deltaFilteredModuleItems;
  const topRiskModules = [...atRiskDeltaFilteredModules]
    .sort((left, right) => {
      const leftRiskPriority = riskPriorityFromTone(left.tone);
      const rightRiskPriority = riskPriorityFromTone(right.tone);
      if (leftRiskPriority !== rightRiskPriority) {
        return leftRiskPriority - rightRiskPriority;
      }
      const leftPriority = Number.isFinite(left.developmentBuild?.priority) ? left.developmentBuild.priority : 99;
      const rightPriority = Number.isFinite(right.developmentBuild?.priority) ? right.developmentBuild.priority : 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      if (left.done !== right.done) {
        return left.done - right.done;
      }
      const leftDelta = Number.isFinite(left.delta) ? Math.abs(left.delta) : -1;
      const rightDelta = Number.isFinite(right.delta) ? Math.abs(right.delta) : -1;
      if (leftDelta !== rightDelta) {
        return rightDelta - leftDelta;
      }
      return left.area.localeCompare(right.area);
    })
    .slice(0, 3);
  const averageCompletion = moduleItems.length > 0
    ? Math.round(moduleItems.reduce((acc, item) => acc + item.done, 0) / moduleItems.length)
    : 0;
  const moduleDisplayLimit = 4;
  const visibleModuleItems = showAllModules ? filteredModuleItems : filteredModuleItems.slice(0, moduleDisplayLimit);
  const riskSummary = moduleItems.reduce(
    (acc, module) => {
      acc[module.tone] = (acc[module.tone] ?? 0) + 1;
      return acc;
    },
    { error: 0, warn: 0, ok: 0, unknown: 0 },
  );
  const progressSignals = releaseState.productSignals.map((signal) => ({
    ...signal,
    tone: signalToneFromStatus(signal.status),
  }));
  const sortedProgressSignals = [...progressSignals].sort(
    (left, right) => riskPriorityFromTone(left.tone) - riskPriorityFromTone(right.tone),
  );
  const atRiskProgressSignals = sortedProgressSignals.filter((signal) => signal.tone !== "ok");
  const signalRiskSummary = progressSignals.reduce(
    (acc, signal) => {
      acc[signal.tone] = (acc[signal.tone] ?? 0) + 1;
      return acc;
    },
    { error: 0, warn: 0, ok: 0, unknown: 0 },
  );
  const overallSignalRiskTone = signalRiskSummary.error > 0 ? "error" : signalRiskSummary.warn > 0 ? "warn" : "ok";
  const overallSignalRiskText =
    progressSignals.length === 0
      ? "No signal data"
      : [
          signalRiskSummary.error ? `${signalRiskSummary.error} blocked` : "",
          signalRiskSummary.warn ? `${signalRiskSummary.warn} warning` : "",
        ]
          .filter(Boolean)
          .join(" / ") || "Stable";
  const atRiskActionCount = atRiskProgressSignals.length + atRiskModules.length;
  const actionTimestampFallback = releaseSource === "fallback" ? null : releaseGeneratedAt;
  const actionItems = [
    ...sortedProgressSignals
      .map((signal) => {
        const tone = signalToneFromStatus(signal.status);
        if (tone === "ok") {
          return null;
        }
        const hint = signalActionHintFromLabel(signal.label);
        const signalAddedAt = signal.addedAt ?? actionTimestampFallback;
        const signalUpdatedAt = signal.updatedAt ?? signalAddedAt ?? actionTimestampFallback;
        return {
          text: `Address signal: ${signal.label} (${signal.status})`,
          emphasis: true,
          priority: 1,
          href: hint?.href ?? null,
          cta: hint?.cta ?? "Review signal",
          addedAt: signalAddedAt,
          updatedAt: signalUpdatedAt,
          key: `signal-risk-${signal.label}`,
        };
      })
      .filter(Boolean),
    ...atRiskModules.map((module) => ({
      text: module.developmentBuild?.isActionable
        ? `Build queue: ${module.area} (${module.developmentBuild.shortLabel}${
          Number.isFinite(module.developmentBuild?.priority) && module.developmentBuild.priority < 99
            ? ` · P${module.developmentBuild.priority}`
            : ""
        })`
        : `Unblock module: ${module.area} (${module.statusText})`,
      emphasis: true,
      priority: module.developmentBuild?.isActionable
        ? module.developmentBuild.priority
        : 2,
      href: `#module-${slugify(module.area)}`,
      cta: module.developmentBuild?.isActionable ? module.developmentBuild.cta : "Review module progress",
      addedAt: module.addedAt ?? actionTimestampFallback,
      updatedAt: module.updatedAt ?? module.addedAt ?? actionTimestampFallback,
      key: `risk-${module.area}`,
    })),
    ...releaseState.quickActions.map((action, index) => ({
      text: action.text,
      emphasis: false,
      priority: 3,
      href: null,
      cta: null,
      addedAt: action.addedAt,
      updatedAt: action.updatedAt,
      key: `action-${index}`,
    })),
  ];
  const sortedActionItems = sortActionItemsByUpdatedAt(actionItems);
  const visibleActionItems = showAllActions ? sortedActionItems : sortedActionItems.slice(0, 3);
  const hasModuleCompletionData = moduleItems.length > 0;
  const overallRiskTone = hasModuleCompletionData
    ? riskSummary.error > 0
      ? "error"
      : riskSummary.warn > 0
        ? "warn"
        : "ok"
    : "unknown";
  const overallRiskText = hasModuleCompletionData
    ? [
        riskSummary.error ? `${riskSummary.error} blocked` : "",
        riskSummary.warn ? `${riskSummary.warn} warning` : "",
      ]
        .filter(Boolean)
        .join(" / ") || "Stable"
    : "No module risk data";
  const moduleRiskWeight = hasModuleCompletionData
    ? riskSummary.error * 2 + riskSummary.warn * 1 + riskSummary.unknown * 0.5
    : 0;
  const overallRiskScore = hasModuleCompletionData
    ? Math.max(
      0,
      Math.round(100 - (moduleRiskWeight / (moduleItems.length * 2)) * 100),
    )
    : 0;
  const overallRiskDescriptor = hasModuleCompletionData
    ? overallRiskTone === "error"
      ? "Critical risk"
      : overallRiskTone === "warn"
        ? "Elevated risk"
        : "Low risk"
    : "No module data";
  const overallRiskSummary = hasModuleCompletionData
    ? `${overallRiskDescriptor} · ${overallRiskScore}% score`
    : overallRiskDescriptor;
  const atRiskPercentage = hasModuleCompletionData
    ? Math.round(((riskSummary.error + riskSummary.warn) / moduleItems.length) * 100)
    : 0;
  const previousOverallRiskScore = previousOverallRiskRef.current?.score ?? null;
  const overallRiskScoreDelta = hasModuleCompletionData && previousOverallRiskScore !== null
    ? overallRiskScore - previousOverallRiskScore
    : null;
  const overallRiskTrendTone = getOverallRiskTrendTone(overallRiskScoreDelta);
  const overallRiskTrendText = overallRiskScoreDelta === null
    ? null
    : overallRiskScoreDelta > 0
      ? `Risk score +${overallRiskScoreDelta} from last poll`
      : overallRiskScoreDelta < 0
        ? `Risk score ${overallRiskScoreDelta} from last poll`
        : "Risk score unchanged";
  const previousAtRiskCount = previousOverallRiskRef.current?.atRiskCount ?? null;
  const atRiskCountDelta = hasModuleCompletionData && previousAtRiskCount !== null
    ? atRiskModules.length - previousAtRiskCount
    : null;
  const atRiskTrendTone = getAtRiskTrendTone(atRiskCountDelta);
  const atRiskTrendText = atRiskCountDelta === null
    ? null
    : atRiskCountDelta > 0
      ? `${atRiskCountDelta} more at-risk module${atRiskCountDelta === 1 ? "" : "s"} than last poll`
      : atRiskCountDelta < 0
        ? `${Math.abs(atRiskCountDelta)} fewer at-risk module${Math.abs(atRiskCountDelta) === 1 ? "" : "s"} than last poll`
        : "At-risk count unchanged";
  const riskDistributionItems = [
    { key: "ok", label: "OK", count: riskSummary.ok, tone: "ok" },
    { key: "warn", label: "WARN", count: riskSummary.warn, tone: "warn" },
    { key: "error", label: "ERR", count: riskSummary.error, tone: "error" },
  ];
  if (riskSummary.unknown > 0) {
    riskDistributionItems.push({
      key: "unknown",
      label: "UNK",
      count: riskSummary.unknown,
      tone: "unknown",
    });
  }

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    previousOverallRiskRef.current = {
      score: hasModuleCompletionData ? overallRiskScore : null,
      atRiskPercent: atRiskPercentage,
      atRiskCount: atRiskModules.length,
    };
  }, [atRiskModules.length, atRiskPercentage, hasModuleCompletionData, isHydrated, overallRiskScore]);
  const formattedLatency = lastPollLatencyMs === null ? "pending" : `${lastPollLatencyMs}ms`;
  const renderTimestamp = isHydrated && lastUpdated !== "Loading" ? lastUpdated : "Loading";
  const sourceTone = releaseSource === "fallback" ? "warn" : "ok";
  const sourceLabel = releaseSource === "fallback" ? "fallback snapshot" : releaseSource;
  const progressSourceLabel = getProgressSourcePresentation(releaseState.progressSource);
  const updateSource = getUpdateSourcePresentation(releaseSource);
  const payloadGeneratedAtLabel =
    releaseGeneratedAt && typeof releaseGeneratedAt === "string" ? releaseGeneratedAt : "unavailable";
  const headerTimestampLabel = isHydrated
    ? `Snapshot updated at ${renderTimestamp} · Last poll latency ${formattedLatency}`
    : "Loading snapshot...";
  const isAtRiskFilterDisabled = atRiskDeltaFilteredModules.length === 0;
  const canToggleModules = filteredModuleItems.length > moduleDisplayLimit;
  const moduleToggleButtonLabel = showAllModules
    ? "Show fewer modules"
    : `Show more modules (${filteredModuleItems.length - moduleDisplayLimit} more)`;
  const moduleSortActions = [
    { value: "risk", label: "Risk first", icon: "⚠" },
    { value: "completion", label: "Completion", icon: "%",},
    { value: "recent-delta", label: "Recent delta", icon: "⏱" },
    { value: "biggest-delta", label: "Biggest delta", icon: "⬆" },
    { value: "name", label: "Name", icon: "Aa" },
  ];
  const moduleDeltaBucketFilters = [
    { value: "all", label: "All", icon: "✦" },
    { value: "up", label: "Up", icon: "↗" },
    { value: "flat", label: "Flat", icon: "→" },
    { value: "down", label: "Down", icon: "↘" },
  ];
  const moduleSortActionLabel =
    moduleSortActions.find((action) => action.value === moduleSortMode)?.label ?? "Risk first";
  const areModuleFiltersActive = showAtRiskModulesOnly || moduleSearchQuery !== "" || moduleDeltaBucketFilter !== "all";
  const moduleFilterSummaryItems = [];
  if (moduleSearchQuery.trim()) {
    moduleFilterSummaryItems.push(`search: ${moduleSearchQuery.trim()}`);
  }
  if (moduleDeltaBucketFilter !== "all") {
    moduleFilterSummaryItems.push(`delta: ${moduleDeltaBucketFilter}`);
  }
  if (showAtRiskModulesOnly) {
    moduleFilterSummaryItems.push("at-risk only");
  }
  const moduleFilterSummary = moduleFilterSummaryItems.join(" · ");
  const getModuleDeltaBadge = (delta) => {
    if (delta === null || Number.isNaN(delta)) {
      return "—";
    }
    if (delta > 0) {
      return "↗";
    }
    if (delta < 0) {
      return "↘";
    }
    return "→";
  };
  const toggleModuleExpanded = (area) => {
    setExpandedModuleAreas((previous) => {
      const next = new Set(previous);
      if (next.has(area)) {
        next.delete(area);
        return next;
      }
      next.add(area);
      return next;
    });
  };

  return (
    <main role="main" aria-labelledby="page-title" style={{ maxWidth: 1100, margin: "0 auto", padding: "2.5rem 1.25rem 3.5rem" }}>
      <section style={{ display: "grid", gap: 18 }} aria-label="ESG RDT production dashboard">
          <header>
          <h1 id="page-title" style={{ marginBottom: 4 }}>ESG RDT Master</h1>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>Production workspace with diagnostics-first UI.</p>
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{headerTimestampLabel}</p>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
            Progress source: <span className={`release-source-pill release-source-${sourceTone}`}>{sourceLabel}</span>
          </p>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
            Last updated by:{" "}
            <span className={`release-source-pill last-updated-by-pill last-updated-by-pill-${updateSource.className}`}>
              {updateSource.text}
            </span>
          </p>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
            Progress payload generated at: <code>{payloadGeneratedAtLabel}</code>
          </p>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
            Progress source: <span className={`release-source-pill release-source-${progressSourceLabel.tone}`}>{progressSourceLabel.text}</span>
          </p>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
            Update progress without code changes: edit <code>apps/web/public/release-progress.json</code> (or set
            {" "}
            <code>RELEASE_PROGRESS_JSON</code> or <code>RELEASE_PROGRESS_JSON_FILE</code> on the server).
          </p>
          {proxySourceHint ? (
            <p
              className={`proxy-config-banner proxy-config-banner-${proxySourceHint.tone}`}
              style={{ marginTop: 10, marginBottom: 0 }}
            >
              {proxySourceHint.text}
            </p>
          ) : null}
        </header>

        <section className="surface">
          <div className="toolbar">
            <h2 style={{ marginBottom: 12 }}>Release readiness</h2>
              <div className="toolbar-actions">
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }} aria-live="polite">
                  {signals.every((signal) => signal.tone === "ok")
                    ? "All checks green"
                    : "Some endpoints require attention"}
                </p>
                {copiedState === "copied" ? (
                  <span className="copy-toast copy-toast-copied" role="status" aria-live="polite">
                    Copied
                  </span>
                ) : null}
                {copiedState === "error" ? (
                  <span className="copy-toast copy-toast-error" role="status" aria-live="polite">
                    Copy failed
                  </span>
                ) : null}
                <button
                  className="refresh-button"
                  onClick={() => {
                    void copyProgressSnapshot();
                  }}
                  type="button"
                >
                  Copy snapshot JSON
                </button>
                <button
                  className="refresh-button"
                  disabled={isRefreshing}
                  onClick={() => {
                    void loadSignals();
                }}
                type="button"
              >
                {isRefreshing ? "Refreshing..." : "Refresh now"}
              </button>
            </div>
          </div>
          <div className="status-grid" aria-live="polite" role="status" aria-label="endpoint probes">
            {signals.map((endpoint) => {
              const endpointLastPollStatus = lastPollStatusFromSignal(endpoint);
              const endpointLastPollTone = endpointLastPollStatus === "ok" ? "ok" : endpointLastPollStatus === "degraded" ? "warn" : "error";
              const endpointSourceTone = getEndpointSourceTone(endpoint.source);
              const endpointSourceLabel = getEndpointSourceLabel(endpoint.source);
              return (
              <a className={`tile ${endpoint.isStale ? "tile-stale" : ""}`} href={endpoint.href} key={endpoint.href}>
                <div className="tile-header">
                  <strong>{endpoint.title}</strong>
                  <div className="tile-status-wrap">
                    <span className={`status-pill status-${endpoint.tone}`}>{endpoint.status}</span>
                    {endpoint.isStale ? <span className="endpoint-badge endpoint-badge-stale">STALE</span> : null}
                    {!endpoint.lastSuccessAt && endpoint.tone !== "ok" && endpoint.tone !== "stale" ? (
                      <span className="endpoint-badge endpoint-badge-error">FAILED</span>
                    ) : null}
                  </div>
                </div>
                <div style={{ color: "var(--muted)", marginTop: 6 }}>{endpoint.description}</div>
                <div className="tile-detail">{endpoint.details}</div>
                <div className="endpoint-poll-line">
                  <span>Last poll status:</span>{" "}
                  <span
                    className={`status-pill status-${endpointLastPollTone}`}
                    style={{ fontSize: 10, textTransform: "lowercase" }}
                  >
                    {endpointLastPollStatus}
                  </span>
                </div>
                <div className="endpoint-source-line">
                  <span>Probe source:</span>{" "}
                  <span className={`endpoint-source-pill endpoint-source-${endpointSourceTone}`}>
                    {endpointSourceLabel}
                  </span>
                </div>
              </a>
              );
            })}
          </div>
        </section>

        <section id="progress-map" className="surface">
          <h2 style={{ marginBottom: 12 }}>Progress map</h2>
          <p className="risk-legend">
            Risk legend: <span>Blocked = &lt;50</span> · <span>Warning = 50-79</span> · <span>Healthy = 80+</span>
          </p>
          <div className="module-meta">
            <span className={`risk-chip risk-chip-${overallSignalRiskTone}`}>
              Signal risk: {overallSignalRiskText}
            </span>
            <span style={{ color: "var(--muted)" }}>
              {progressSignals.length} signals tracked · {atRiskProgressSignals.length} at risk
            </span>
          </div>
          {atRiskProgressSignals.length > 0 ? (
            <div className="module-at-risk" role="status" aria-live="polite">
              <strong style={{ fontSize: 13 }}>At-risk signals</strong>
              <div className="at-risk-list">
                {atRiskProgressSignals.map((signal) => (
                  <span key={signal.label} className={`status-pill status-${signal.tone}`}>
                    {signal.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <p style={{ marginTop: 0, fontSize: 12, color: "var(--muted)" }}>
            {releaseState.releaseStatus} progress from {releaseState.service}.
          </p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {sortedProgressSignals.map((signal) => (
              <li key={signal.label} className={`module-row module-row-${signal.tone}`} style={{ display: "grid", gap: 6 }}>
                <div className="progress-signal-row">
                  <strong>{signal.label}</strong>
                  <span className={`status-pill status-${signal.tone}`}>{signal.status}</span>
                </div>
                <div className="progress-signal-detail">{signal.detail}</div>
              </li>
            ))}
            {sortedProgressSignals.length === 0 ? (
              <li>
                <span style={{ color: "var(--muted)" }}>No product signals to show.</span>
              </li>
            ) : null}
          </ul>
        </section>

        <section id="module-completion" className="surface">
          <h2 style={{ marginBottom: 12 }}>Module completion</h2>
          <div className="module-overall-risk-panel">
            <div className="module-overall-risk-row">
              <span className={`risk-chip risk-chip-${overallRiskTone}`}>
                Overall risk: {overallRiskText}
              </span>
              <span>{averageCompletion}% weighted completion</span>
              <span style={{ color: "var(--muted)" }}>
                {moduleItems.length} modules tracked · {atRiskModules.length} at risk
              </span>
              <span style={{ color: "var(--muted)" }}>
                {atRiskPercentage}% at-risk
              </span>
              <span className={`risk-chip risk-chip-${overallRiskTone}`} aria-live="polite">
                {overallRiskSummary}
              </span>
              {overallRiskTrendText ? (
                <span className={`risk-chip risk-chip-${overallRiskTrendTone}`} aria-live="polite">
                  {overallRiskTrendText}
                </span>
              ) : null}
              {atRiskTrendText ? (
                <span className={`risk-chip risk-chip-${atRiskTrendTone}`} aria-live="polite">
                  {atRiskTrendText}
                </span>
              ) : null}
            </div>
            <div className="module-risk-meter-wrap">
              <div className="module-risk-meter" role="img" aria-label={`Module risk score ${overallRiskScore} of 100`}>
                <span
                  className={`module-risk-meter-fill module-risk-meter-${overallRiskTone}`}
                  style={{ width: `${hasModuleCompletionData ? overallRiskScore : 0}%` }}
                />
                {hasModuleCompletionData ? (
                  <span
                    className={`module-risk-meter-target ${overallRiskScore >= 80 ? "module-risk-meter-target-ok" : "module-risk-meter-target-warning"}`}
                    style={{ left: "80%" }}
                  />
                ) : null}
              </div>
              <div className="module-risk-meter-meta">
                <span className="risk-mini-stat risk-mini-stat-ok">Target 80+</span>
                <span>{hasModuleCompletionData ? `${overallRiskScore}%` : "No score data"}</span>
                <span className="risk-mini-stat risk-mini-stat-warn">
                  {100 - atRiskPercentage}% stable window
                </span>
              </div>
            </div>
            <div className="module-risk-distribution" aria-live="polite">
              {riskDistributionItems.map((bucket) => (
                <span
                  key={bucket.key}
                  className={`risk-mini-stat risk-mini-stat-${bucket.tone}`}
                >
                  {bucket.label} {bucket.count} ({clampPercent(bucket.count, moduleItems.length)}%)
                </span>
              ))}
            </div>
            {atRiskDevelopmentBuildQueue.length > 0 ? (
              <div className="module-risk-actions-note">
                Queue readiness: {atRiskDevelopmentBuildQueue.length} development build action
                {atRiskDevelopmentBuildQueue.length !== 1 ? "s" : ""} prioritized
              </div>
            ) : null}
          </div>
          {atRiskDeltaFilteredModules.length > 0 ? (
            <div className="module-mini-strip" aria-live="polite">
              <span className="module-mini-strip-label">Top at-risk modules:</span>
              {topRiskModules.map((moduleItem) => (
                <a
                  key={`top-risk-${moduleItem.area}`}
                  className={`module-mini-chip module-mini-chip-${moduleItem.tone}`}
                  href={`#module-${slugify(moduleItem.area)}`}
                >
                  <span>{renderHighlightedText(moduleItem.area, normalizedModuleQuery)}</span>
                  <span className={`module-mini-chip-risk module-mini-chip-risk-${moduleItem.tone}`}>
                    {getModuleRiskSeverityLabel(moduleItem.tone)}
                  </span>
                  <span>{moduleItem.done}%</span>
                  {Number.isFinite(moduleItem.developmentBuild?.priority) && moduleItem.developmentBuild?.priority < 99 ? (
                    <span
                      className={`module-mini-chip-priority module-mini-chip-priority-${moduleItem.developmentBuild?.tone ?? "neutral"}`}
                    >
                      P{moduleItem.developmentBuild.priority}
                    </span>
                  ) : null}
                  <span className={`module-mini-chip-delta module-mini-chip-delta-${getModuleDeltaBucket(moduleItem.delta)}`}>
                    {getModuleDeltaBadge(moduleItem.delta)}
                    {formatModuleDelta(moduleItem.delta)}
                  </span>
                </a>
              ))}
            </div>
          ) : null}
          {atRiskDeltaFilteredModules.length > 0 ? (
            <div className="module-at-risk" role="status" aria-live="polite">
              <strong style={{ fontSize: 13 }}>At-risk modules</strong>
              <div className="at-risk-list">
                {atRiskDeltaFilteredModules.map((moduleItem) => (
                  <span key={moduleItem.area} className={`status-pill status-${moduleItem.tone}`}>
                    {renderHighlightedText(moduleItem.area, normalizedModuleQuery)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {topDevelopmentBuildModules.length > 0 ? (
            <div className="module-build-strip" aria-live="polite">
              <span className="module-build-strip-label">Development build queue:</span>
              {topDevelopmentBuildModules.map((moduleItem) => (
                <a
                  key={`build-queue-${moduleItem.area}`}
                  className={`module-build-chip module-build-chip-${moduleItem.developmentBuild?.tone ?? "neutral"}`}
                  href={`#module-${slugify(moduleItem.area)}`}
                >
                  <span>{renderHighlightedText(moduleItem.area, normalizedModuleQuery)}</span>
                  <span>{moduleItem.developmentBuild?.shortLabel}</span>
                </a>
              ))}
            </div>
          ) : null}
          <div className="module-toolbar" role="group" aria-label="Module list sort and filters">
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Sort:</span>
            {moduleSortActions.map((action) => (
              <button
                className={`module-chip ${moduleSortMode === action.value ? "module-chip-active" : ""}`}
                key={`sort-${action.value}`}
                onClick={() => {
                  setModuleSortMode(action.value);
                  setStoredModuleCompletionPreferences({
                    moduleSortMode: action.value,
                    showAtRiskModulesOnly,
                    moduleDeltaBucketFilter,
                  });
                  setShowAllModules(false);
                }}
                type="button"
                aria-pressed={moduleSortMode === action.value}
              >
                <span aria-hidden="true">{action.icon}</span> {action.label}
              </button>
            ))}
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Delta:</span>
            {moduleDeltaBucketFilters.map((filter) => (
              <button
                className={`module-chip ${moduleDeltaBucketFilter === filter.value ? "module-chip-active" : ""}`}
                key={`delta-${filter.value}`}
                onClick={() => {
                  setModuleDeltaBucketFilter(filter.value);
                  setStoredModuleCompletionPreferences({
                    moduleSortMode,
                    showAtRiskModulesOnly,
                    moduleDeltaBucketFilter: filter.value,
                  });
                  setShowAllModules(false);
                }}
                type="button"
                aria-pressed={moduleDeltaBucketFilter === filter.value}
              >
                <span aria-hidden="true">{filter.icon}</span> {filter.label}
              </button>
            ))}
            <button
              className={`module-chip ${showAtRiskModulesOnly ? "module-chip-active" : ""}`}
              onClick={() => {
                setShowAtRiskModulesOnly((state) => {
                  const next = !state;
                  setStoredModuleCompletionPreferences({
                    moduleSortMode,
                    showAtRiskModulesOnly: next,
                    moduleDeltaBucketFilter,
                  });
                  return next;
                });
                setShowAllModules(false);
              }}
              disabled={isAtRiskFilterDisabled}
              type="button"
              aria-pressed={showAtRiskModulesOnly}
            >
              {showAtRiskModulesOnly ? "Showing at-risk only" : "At-risk only"}
            </button>
            <button
              className={`module-chip ${compactModuleRows ? "module-chip-active" : ""}`}
              onClick={() => {
                const nextCompactRows = !compactModuleRows;
                setCompactModuleRows(nextCompactRows);
                setStoredCompactModuleMode(nextCompactRows);
                setShowAllModules(false);
              }}
              type="button"
              aria-pressed={compactModuleRows}
            >
              {compactModuleRows ? "Compact rows on" : "Compact rows"}
            </button>
            <label htmlFor="module-search-input" className="sr-only">
              Filter modules by name
            </label>
            <input
              id="module-search-input"
              className="module-search"
              placeholder="Filter modules"
              value={moduleSearchQuery}
              onChange={(event) => {
                setModuleSearchQuery(event.target.value);
                setShowAllModules(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") {
                  return;
                }
                if (moduleSearchQuery === "") {
                  return;
                }
                event.preventDefault();
                setModuleSearchQuery("");
                setShowAllModules(false);
              }}
              aria-label="Filter modules by name"
            />
            {moduleSearchQuery ? (
              <button
                className="module-chip"
                onClick={() => {
                  setModuleSearchQuery("");
                  setShowAllModules(false);
                }}
                type="button"
              >
                Clear filter
              </button>
            ) : null}
            {areModuleFiltersActive ? (
              <button
                className="module-chip"
                onClick={() => {
                  setModuleDeltaBucketFilter("all");
                  setShowAtRiskModulesOnly(false);
                  setModuleSearchQuery("");
                  setStoredModuleCompletionPreferences({
                    moduleSortMode,
                    showAtRiskModulesOnly: false,
                    moduleDeltaBucketFilter: "all",
                  });
                  setShowAllModules(false);
                }}
                type="button"
              >
                Clear filters
              </button>
            ) : null}
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Active sort: {moduleSortActionLabel}
            </span>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--muted)" }}>
            {normalizedModuleQuery === ""
              ? filteredModuleItems.length === moduleItems.length
                ? `${moduleItems.length} total modules`
                : `${filteredModuleItems.length} / ${moduleItems.length} modules shown`
              : `${filteredModuleItems.length} / ${moduleItems.length} modules match "${moduleSearchQuery}"`}
            {moduleFilterSummary ? ` · Filters: ${moduleFilterSummary}` : ""}
          </p>
          {filteredModuleItems.length === 0 ? (
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
              No modules match the current filters.
              {areModuleFiltersActive ? (
                <button
                  className="module-chip"
                  style={{ marginLeft: 8, verticalAlign: "middle" }}
                  onClick={() => {
                    setModuleDeltaBucketFilter("all");
                    setShowAtRiskModulesOnly(false);
                    setModuleSearchQuery("");
                    setStoredModuleCompletionPreferences({
                      moduleSortMode,
                      showAtRiskModulesOnly: false,
                      moduleDeltaBucketFilter: "all",
                    });
                    setShowAllModules(false);
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </p>
          ) : null}
          {canToggleModules ? (
            <button
              className="refresh-button"
              style={{ marginBottom: 12 }}
              onClick={() => {
                setShowAllModules((state) => !state);
              }}
              type="button"
            >
              {moduleToggleButtonLabel}
            </button>
          ) : null}
          <div style={{ display: "grid", gap: 12 }}>
            {visibleModuleItems.map((item) => {
              const done = item.done;
              const tone = item.tone;
                  const deltaTone = item.delta === null ? "neutral" : item.delta > 0 ? "up" : item.delta < 0 ? "down" : "neutral";
                  const buildPlan = item.developmentBuild ?? getModuleDevelopmentBuildPlan(item);
                  const lastUpdatedAtLabel = formatModuleMetaAge(item.addedAt, item.updatedAt);
                  const isExpanded = expandedModuleAreas.has(item.area);
                  const moduleSlug = slugify(item.area);
              return (
                <div
                  className={`module-row module-row-${tone} ${compactModuleRows ? "module-row-compact" : ""}`}
                  id={`module-${moduleSlug}`}
                  key={item.area}
                >
                  <div className="module-row-header">
                    <span>{renderHighlightedText(item.area, normalizedModuleQuery)}</span>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <span className={`status-pill status-${tone}`} title={progressLabelFromDone(done)}>
                        {done}%
                      </span>
                      <span className={`module-delta-mini module-delta-mini-${deltaTone}`} aria-hidden="true">
                        {getModuleDeltaBadge(item.delta)} {getModuleDeltaDisplay(item.delta)}
                      </span>
                      <button
                        className="module-details-toggle"
                        type="button"
                        onClick={() => {
                          toggleModuleExpanded(item.area);
                        }}
                        aria-expanded={isExpanded}
                        aria-pressed={isExpanded}
                        aria-label={`${isExpanded ? "Hide" : "Show"} details for ${item.area}`}
                        aria-controls={`module-details-${moduleSlug}`}
                      >
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>
                    </span>
                  </div>
                  <div
                    className={`meter-wrap module-meter meter-${tone}`}
                    role="progressbar"
                    aria-label={`${item.area} completion`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={done}
                  >
                    <div className={`meter-fill meter-fill-${tone}`} style={{ width: `${done}%` }} />
                  </div>
                {isExpanded ? (
                    <div className="module-details" id={`module-details-${moduleSlug}`}>
                      <div>
                        Added: <strong>{item.addedAt ? formatRelativeAge(item.addedAt) || "unknown" : "unknown"}</strong>
                      </div>
                      <div>
                        Last updated:{" "}
                        <strong>{item.updatedAt ? formatRelativeAge(item.updatedAt) || "unknown" : "unknown"}</strong>
                      </div>
                      <div>
                        Status: <strong>{item.statusText}</strong>
                      </div>
                      <div>
                        Risk: <strong>{getModuleRiskSeverityLabel(tone)}</strong>
                      </div>
                      <div>
                        Source: <strong>{progressSourceLabel.text}</strong>
                      </div>
                      {buildPlan.shortLabel ? (
                        <div>
                          Build plan: <strong>{buildPlan.shortLabel}</strong>
                          {buildPlan.priority !== null && Number.isFinite(buildPlan.priority) ? (
                            <>
                              {" "}
                              (priority {buildPlan.priority})
                            </>
                          ) : null}
                          {item.buildLabel ? (
                            <>
                              {" "}
                              · label: <strong>{item.buildLabel}</strong>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="module-row-foot">
                    Status: <span style={{ textTransform: "capitalize" }}>{item.statusText}</span>{" "}
                    <span className={`module-delta module-delta-${deltaTone}`}>
                      <strong>{getModuleDeltaBadge(item.delta)}</strong> Δ {getModuleDeltaDisplay(item.delta)} vs last poll
                    </span>
                    {buildPlan.isActionable ? (
                      <span className={`module-build-pill module-build-pill-${buildPlan.tone}`}>
                        {buildPlan.shortLabel}
                      </span>
                    ) : null}
                    <span className="module-meta-line">{lastUpdatedAtLabel}</span>
                  </div>
                </div>
              );
            })}
            {moduleItems.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>No modules to show.</p> : null}
          </div>
        </section>

        <section className="surface">
          <h2 style={{ marginBottom: 12 }}>Next actions</h2>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: 12 }}>
            {atRiskActionCount > 0 ? "Prioritized risk actions are highlighted." : "Execution steps from release progress source."}
          </p>
          <p className="next-action-sort-key">Sort key: updatedAt desc, then addedAt, then priority.</p>
          {actionItems.length > 3 ? (
            <button
              className="refresh-button"
              onClick={() => {
                setShowAllActions((state) => !state);
              }}
              style={{ marginBottom: 12 }}
              type="button"
            >
              {showAllActions ? "Show fewer actions" : "Show more actions"}
            </button>
          ) : null}
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {visibleActionItems.map((action) => (
              <li
                key={action.key}
                className={action.emphasis ? "next-action-item next-action-item-emphasis" : "next-action-item"}
                style={{ marginBottom: 8 }}
              >
                <span className={`priority-chip priority-${action.priority}`}>P{action.priority}</span>
                <span style={{ flex: "1 1 auto" }}>{action.text}</span>
                {action.href ? (
                  action.priority === 1 ? (
                    <button
                      className="next-action-button next-action-cta"
                      type="button"
                      onClick={() => {
                        navigateToAction(action.href);
                      }}
                      aria-label={`${action.cta}: ${action.text}`}
                    >
                      {action.cta}
                    </button>
                  ) : (
                    <a className="next-action-link" href={action.href}>
                      {action.cta}
                    </a>
                  )
                ) : null}
                {isHydrated ? <span className="next-action-meta">{formatActionAge(action)}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </section>
    </main>
  );
}
