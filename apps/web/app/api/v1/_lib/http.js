import { randomUUID } from "node:crypto";

export const json = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

export const getRequestId = (request = null) => {
  if (request) {
    const fromHeader = request.headers?.get?.("x-request-id") || request.headers?.get?.("x-vercel-id");
    if (fromHeader && fromHeader.trim()) {
      return fromHeader.trim();
    }
  }
  return randomUUID();
};

export const errorJson = (message, status = 400, extra = {}) => {
  const normalizedMessage = typeof message === "string" && message.trim() ? message.trim() : `HTTP ${status}`;
  const code =
    typeof extra?.code === "string" && extra.code.trim()
      ? extra.code.trim()
      : status >= 500
        ? "internal_error"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : status === 429
              ? "rate_limited"
              : "bad_request";
  const requestId =
    typeof extra?.requestId === "string" && extra.requestId.trim()
      ? extra.requestId.trim()
      : typeof extra?.request_id === "string" && extra.request_id.trim()
        ? extra.request_id.trim()
        : randomUUID();
  const payloadExtra = { ...extra };
  delete payloadExtra.code;
  delete payloadExtra.requestId;
  delete payloadExtra.request_id;

  return json(
    {
      ok: false,
      code,
      message: normalizedMessage,
      error: normalizedMessage,
      ...(requestId ? { requestId } : {}),
      ...payloadExtra,
    },
    status,
  );
};

export const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export const parseJsonBody = async (request) => {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  try {
    const parsed = await request.json();
    return isPlainObject(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
};

export const toIso = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const parseJsonColumn = (value) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }
  return value;
};

export const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

export const isReadMethod = (method) => {
  const upper = (method || "GET").toUpperCase();
  return upper === "GET" || upper === "HEAD";
};
