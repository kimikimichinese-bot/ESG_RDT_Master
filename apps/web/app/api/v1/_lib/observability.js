import { randomUUID } from "node:crypto";

const safePathname = (request, fallback) => {
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  try {
    return new URL(request.url).pathname;
  } catch (_error) {
    return "unknown";
  }
};

export const resolveRequestId = (request) => {
  const requestIdHeader = request?.headers?.get?.("x-request-id") || request?.headers?.get?.("x-vercel-id");
  if (typeof requestIdHeader === "string" && requestIdHeader.trim()) {
    return requestIdHeader.trim();
  }
  return randomUUID();
};

export const logRequest = ({ request, response, startedAt, context = null, route = null, requestId = null, extra = null }) => {
  const completedAt = Date.now();
  const durationMs = Math.max(0, completedAt - Number(startedAt || completedAt));
  const status = Number(response?.status || 500);
  const tenantId = context?.tenantId || extra?.tenantId || null;
  const userId = context?.user?.id || extra?.userId || null;
  const platformRole = context?.platformRole || context?.user?.platformRole || extra?.platformRole || "none";

  const payload = {
    ts: new Date(completedAt).toISOString(),
    requestId: typeof requestId === "string" && requestId.trim() ? requestId.trim() : resolveRequestId(request),
    route: safePathname(request, route),
    method: request?.method || "GET",
    status,
    ms: durationMs,
    tenantId,
    userId,
    platformRole,
    ...(extra && typeof extra === "object" ? extra : {}),
  };

  if (status >= 500) {
    console.error(JSON.stringify(payload));
    return;
  }
  console.log(JSON.stringify(payload));
};
