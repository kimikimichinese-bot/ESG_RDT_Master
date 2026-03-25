const STORE = globalThis.__esg_rdt_rate_limit_store__ || new Map();
globalThis.__esg_rdt_rate_limit_store__ = STORE;

const nowMs = () => Date.now();

const toInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const prune = (bucket, currentMs, windowMs) => {
  if (!Array.isArray(bucket.timestamps) || bucket.timestamps.length === 0) {
    bucket.timestamps = [];
    return;
  }
  const floor = currentMs - windowMs;
  bucket.timestamps = bucket.timestamps.filter((ts) => Number.isFinite(ts) && ts > floor);
};

export const consumeRateLimit = ({ key, limit, windowMs }) => {
  const normalizedKey = typeof key === "string" ? key.trim() : "";
  if (!normalizedKey) {
    return {
      allowed: true,
      limit: 0,
      remaining: 0,
      retryAfterSec: 0,
      resetAt: null,
    };
  }

  const normalizedLimit = toInteger(limit, 1);
  const normalizedWindowMs = toInteger(windowMs, 60_000);
  const currentMs = nowMs();

  const bucket = STORE.get(normalizedKey) || { timestamps: [] };
  prune(bucket, currentMs, normalizedWindowMs);

  if (bucket.timestamps.length >= normalizedLimit) {
    const oldest = bucket.timestamps[0] || currentMs;
    const retryAfterMs = Math.max(0, oldest + normalizedWindowMs - currentMs);
    return {
      allowed: false,
      limit: normalizedLimit,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      resetAt: oldest + normalizedWindowMs,
    };
  }

  bucket.timestamps.push(currentMs);
  STORE.set(normalizedKey, bucket);

  return {
    allowed: true,
    limit: normalizedLimit,
    remaining: Math.max(0, normalizedLimit - bucket.timestamps.length),
    retryAfterSec: 0,
    resetAt: bucket.timestamps[0] + normalizedWindowMs,
  };
};

export const buildRateLimitKey = ({ tenantId, routeKey }) => {
  const t = typeof tenantId === "string" && tenantId.trim() ? tenantId.trim() : "anonymous";
  const r = typeof routeKey === "string" && routeKey.trim() ? routeKey.trim() : "default";
  return `${t}:${r}`;
};

export const resetRateLimitStoreForTests = () => {
  STORE.clear();
};
