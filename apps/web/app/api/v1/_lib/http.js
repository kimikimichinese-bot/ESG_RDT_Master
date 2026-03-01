export const json = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

export const errorJson = (message, status = 400, extra = {}) =>
  json(
    {
      error: message,
      ...extra,
    },
    status,
  );

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
