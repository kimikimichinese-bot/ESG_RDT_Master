const MAX_FIELD_LENGTH = 120;

const safeParam = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, MAX_FIELD_LENGTH);
};

export const buildUnavailableHref = ({ requestId, digest, source } = {}) => {
  const params = new URLSearchParams();
  const normalizedRequestId = safeParam(requestId);
  const normalizedDigest = safeParam(digest);
  const normalizedSource = safeParam(source);

  if (normalizedRequestId) {
    params.set("requestId", normalizedRequestId);
  }
  if (normalizedDigest) {
    params.set("digest", normalizedDigest);
  }
  if (normalizedSource) {
    params.set("source", normalizedSource);
  }

  const query = params.toString();
  return query ? `/unavailable?${query}` : "/unavailable";
};
