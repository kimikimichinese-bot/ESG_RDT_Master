import { randomUUID } from "node:crypto";
import { resolveStorageSecret } from "./storage-secrets.js";

const TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const API_BASE_URL = "https://api.dropboxapi.com/2";
const CONTENT_BASE_URL = "https://content.dropboxapi.com/2";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const createDropboxError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const parseIso = (value) => {
  const normalized = toCleanString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isTokenFresh = (expiresAt) => expiresAt instanceof Date && expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_SKEW_MS;

const normalizeItemName = (value) => {
  const normalized = toCleanString(value).replace(/[\\/:*?"<>|#%]+/g, "-").replace(/\s+/g, " ").trim();
  return normalized || "evidence.bin";
};

const normalizeFolderSegment = (value) => {
  const normalized = normalizeItemName(value).replace(/[.]+$/g, "").trim();
  return normalized || "default";
};

const splitFolderPath = (value) =>
  String(value || "")
    .split("/")
    .map((segment) => normalizeFolderSegment(segment))
    .filter(Boolean);

const normalizeDropboxPath = (value) => {
  const cleaned = String(value || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
  return cleaned ? `/${cleaned}` : "";
};

const normalizeSecretPayload = (payload, config) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createDropboxError("dropbox_secret_payload_invalid", "Resolved Dropbox secret payload must be an object.");
  }
  if (toCleanString(config?.authMode) !== "oauth_delegated") {
    throw createDropboxError(
      "dropbox_auth_mode_unsupported",
      "Dropbox currently supports oauth_delegated in this phase.",
      { authMode: config?.authMode || "" },
    );
  }
  const normalized = {
    clientId: toCleanString(payload.clientId || payload.appKey),
    clientSecret: toCleanString(payload.clientSecret || payload.appSecret),
    refreshToken: toCleanString(payload.refreshToken),
    accessToken: toCleanString(payload.accessToken),
    tokenType: toCleanString(payload.tokenType) || "Bearer",
    expiresAt: parseIso(payload.expiresAt),
  };
  if (!normalized.clientId || !normalized.clientSecret || (!normalized.refreshToken && !normalized.accessToken)) {
    throw createDropboxError(
      "dropbox_secret_payload_invalid",
      "Dropbox delegated auth requires clientId/appKey, clientSecret/appSecret, and refreshToken or accessToken.",
    );
  }
  return normalized;
};

const readDropboxError = async (response, code, fallbackMessage, details = {}) => {
  const rawText = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    parsed = null;
  }
  throw createDropboxError(code, parsed?.error_summary || rawText || fallbackMessage, {
    status: response.status,
    ...details,
  });
};

const refreshDropboxToken = async (secretPayload) => {
  if (secretPayload.accessToken && isTokenFresh(secretPayload.expiresAt)) {
    return {
      accessToken: secretPayload.accessToken,
      tokenType: secretPayload.tokenType || "Bearer",
      expiresAt: secretPayload.expiresAt?.toISOString?.() || null,
    };
  }
  if (!secretPayload.refreshToken) {
    throw createDropboxError("dropbox_secret_payload_invalid", "Dropbox refreshToken is required.");
  }
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", secretPayload.refreshToken);
  params.set("client_id", secretPayload.clientId);
  params.set("client_secret", secretPayload.clientSecret);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });
  if (!response.ok) {
    await readDropboxError(response, "dropbox_auth_failed", "Dropbox token refresh failed.");
  }
  const payload = await response.json();
  const accessToken = toCleanString(payload?.access_token);
  if (!accessToken) {
    throw createDropboxError("dropbox_auth_failed", "Dropbox token response did not include an access token.");
  }
  return {
    accessToken,
    tokenType: "Bearer",
    expiresAt:
      Number.isFinite(Number(payload?.expires_in)) && Number(payload.expires_in) > 0
        ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
        : null,
  };
};

const fetchDropboxJson = async ({ accessToken, endpoint, body = null }) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body == null ? "null" : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    await readDropboxError(response, "dropbox_api_failed", "Dropbox API request failed.", { endpoint });
  }
  return response.json();
};

const fetchDropboxRaw = async ({ accessToken, endpoint, headers = {}, body = null }) => {
  const response = await fetch(`${CONTENT_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    await readDropboxError(response, "dropbox_api_failed", "Dropbox content request failed.", { endpoint });
  }
  return response;
};

export const resolveDropboxAccess = async (config) => {
  const secretPayload = normalizeSecretPayload(await resolveStorageSecret(config.secretReference), config);
  const token = await refreshDropboxToken(secretPayload);
  return {
    ...token,
    secretKeys: Object.keys(secretPayload).sort(),
  };
};

export const validateDropboxConfig = (config = {}) => {
  const errors = [];
  if (!toCleanString(config.authMode)) {
    errors.push({ key: "auth_mode", message: "Authentication mode is required." });
  }
  if (!toCleanString(config.secretReference)) {
    errors.push({ key: "secret_reference", message: "secret_reference is required." });
  }
  if (!toCleanString(config.rootFolderId) && !toCleanString(config.rootFolderPath)) {
    errors.push({ key: "root_folder", message: "Root folder path or root folder ID is required." });
  }
  return {
    ok: errors.length === 0,
    errors,
  };
};

const getDropboxRootMetadata = async (config, accessToken) => {
  if (toCleanString(config.rootFolderId)) {
    return fetchDropboxJson({
      accessToken,
      endpoint: "/files/get_metadata",
      body: { path: toCleanString(config.rootFolderId) },
    });
  }
  const normalizedPath = normalizeDropboxPath(config.rootFolderPath);
  if (!normalizedPath) {
    return {
      id: "root",
      path_display: "/",
      name: "Root",
    };
  }
  return fetchDropboxJson({
    accessToken,
    endpoint: "/files/get_metadata",
    body: { path: normalizedPath },
  });
};

const ensureDropboxFolderPath = async ({ accessToken, basePath, segments }) => {
  let currentPath = normalizeDropboxPath(basePath);
  for (const segment of segments) {
    currentPath = normalizeDropboxPath([currentPath, segment].join("/"));
    try {
      await fetchDropboxJson({
        accessToken,
        endpoint: "/files/create_folder_v2",
        body: {
          path: currentPath,
          autorename: false,
        },
      });
    } catch (error) {
      if (!String(error?.message || "").includes("conflict")) {
        throw error;
      }
    }
  }
  return currentPath;
};

const toUploadFolderSegments = ({ config, tenantId, metadata = {} }) => {
  const issueYear = toCleanString(metadata.issueDate).slice(0, 4) || String(new Date().getUTCFullYear());
  const docType = normalizeFolderSegment(metadata.docType || "other");
  const siteId = normalizeFolderSegment(metadata.siteId || "shared");
  const companyId = normalizeFolderSegment(metadata.companyId || siteId);

  if (config.folderStrategy === "company_site_year") {
    return [companyId, siteId, issueYear];
  }
  if (config.folderStrategy === "year_doc_type") {
    return [issueYear, docType];
  }
  if (config.folderStrategy === "company_year_entity_type") {
    return [companyId, issueYear, normalizeFolderSegment(metadata.entityType || "evidence")];
  }
  if (config.folderStrategy === "custom") {
    return splitFolderPath(config.customFolderPattern);
  }
  return [normalizeFolderSegment(tenantId), companyId, issueYear];
};

const toStoredFilename = ({ config, filename, metadata = {} }) => {
  const safeFilename = normalizeItemName(filename);
  if (config.filenameStrategy === "original_filename") {
    return safeFilename;
  }
  if (config.filenameStrategy === "uuid_original") {
    return `${randomUUID()}-${safeFilename}`;
  }
  if (config.filenameStrategy === "entity_prefixed") {
    return `${normalizeFolderSegment(metadata.docType || metadata.entityType || "evidence")}-${safeFilename}`;
  }
  return `${Date.now()}-${safeFilename}`;
};

const uploadDropboxFile = async ({ accessToken, path, fileBuffer }) => {
  const response = await fetchDropboxRaw({
    accessToken,
    endpoint: "/files/upload",
    headers: {
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path,
        mode: "add",
        autorename: true,
        mute: true,
        strict_conflict: false,
      }),
    },
    body: fileBuffer,
  });
  return response.json();
};

const deleteDropboxPath = async ({ accessToken, path }) => {
  await fetchDropboxJson({
    accessToken,
    endpoint: "/files/delete_v2",
    body: { path },
  });
};

export const runDropboxHealthCheck = async (config, { mode = "connection" } = {}) => {
  const checks = [];
  const validation = validateDropboxConfig(config);
  for (const error of validation.errors) {
    checks.push({
      key: error.key,
      label: error.key.replaceAll("_", " "),
      status: "failed",
      message: error.message,
      extra: { code: "dropbox_config_invalid" },
    });
  }
  if (!validation.ok) {
    return {
      ok: true,
      healthStatus: "misconfigured",
      checks,
      message: "Dropbox configuration is incomplete.",
    };
  }

  let token = null;
  let root = null;
  try {
    token = await resolveDropboxAccess(config);
    checks.push({
      key: "auth",
      label: "Authentication",
      status: "ok",
      message: "Dropbox access token resolved successfully.",
      extra: { code: "dropbox_auth_ok", expiresAt: token.expiresAt, secretKeys: token.secretKeys },
    });
    const account = await fetchDropboxJson({
      accessToken: token.accessToken,
      endpoint: "/users/get_current_account",
    });
    checks.push({
      key: "account_access",
      label: "Account access",
      status: "ok",
      message: `Dropbox account reachable: ${account?.email || account?.account_id || "connected"}`,
      extra: { code: "dropbox_account_ok", accountId: account?.account_id || null },
    });
    root = await getDropboxRootMetadata(config, token.accessToken);
    checks.push({
      key: "root_folder_access",
      label: "Root folder access",
      status: "ok",
      message: `Root folder reachable: ${root?.path_display || config.rootFolderPath || config.rootFolderId}`,
      extra: { code: "dropbox_root_ok", rootFolderId: root?.id || null },
    });
  } catch (error) {
    checks.push({
      key: "repository_access",
      label: "Repository access",
      status: "failed",
      message: error instanceof Error ? error.message : "Dropbox access failed.",
      extra: { code: typeof error?.code === "string" ? error.code : "dropbox_access_failed" },
    });
    return {
      ok: true,
      healthStatus: "warning",
      checks,
      message: "Dropbox validation failed.",
    };
  }

  if (mode === "upload" || mode === "preview") {
    const probePath = normalizeDropboxPath([config.rootFolderPath || "", `.esg-rdt-probe-${Date.now()}.txt`].join("/"));
    try {
      await uploadDropboxFile({
        accessToken: token.accessToken,
        path: probePath,
        fileBuffer: Buffer.from(`probe:${Date.now()}`, "utf-8"),
      });
      checks.push({
        key: "probe_upload",
        label: "Probe upload",
        status: "ok",
        message: "Temporary Dropbox probe file uploaded successfully.",
        extra: { code: "dropbox_probe_upload_ok" },
      });
      if (mode === "preview") {
        const previewResponse = await fetchDropboxRaw({
          accessToken: token.accessToken,
          endpoint: "/files/download",
          headers: {
            "Dropbox-API-Arg": JSON.stringify({ path: probePath }),
          },
        });
        const previewText = await previewResponse.text();
        checks.push({
          key: "probe_preview",
          label: "Probe preview",
          status: previewText.startsWith("probe:") ? "ok" : "failed",
          message: previewText.startsWith("probe:")
            ? "Temporary probe content was fetched successfully through Dropbox."
            : "Probe content could not be verified.",
          extra: { code: previewText.startsWith("probe:") ? "dropbox_probe_preview_ok" : "dropbox_probe_preview_failed" },
        });
      }
    } catch (error) {
      checks.push({
        key: mode === "preview" ? "probe_preview" : "probe_upload",
        label: mode === "preview" ? "Probe preview" : "Probe upload",
        status: "failed",
        message: error instanceof Error ? error.message : "Dropbox probe failed.",
        extra: { code: typeof error?.code === "string" ? error.code : "dropbox_probe_failed" },
      });
      return {
        ok: true,
        healthStatus: "warning",
        checks,
        message: mode === "preview" ? "Dropbox preview probe failed." : "Dropbox upload probe failed.",
      };
    } finally {
      try {
        await deleteDropboxPath({ accessToken: token.accessToken, path: probePath });
      } catch (_error) {
        // ignore cleanup errors
      }
    }
  }

  return {
    ok: true,
    healthStatus: "healthy",
    checks,
    message:
      mode === "connection"
        ? "Dropbox connection validated successfully."
        : mode === "preview"
          ? "Dropbox preview probe completed successfully."
          : "Dropbox upload probe completed successfully.",
  };
};

export const uploadDropboxEvidence = async ({ config, tenantId, fileBuffer, filename, metadata = {} }) => {
  const token = await resolveDropboxAccess(config);
  const basePath = toCleanString(config.rootFolderPath);
  const folderSegments = toUploadFolderSegments({ config, tenantId, metadata });
  const parentPath = await ensureDropboxFolderPath({
    accessToken: token.accessToken,
    basePath,
    segments: folderSegments,
  });
  const storedFilename = toStoredFilename({ config, filename, metadata });
  const fullPath = normalizeDropboxPath([parentPath, storedFilename].join("/"));
  const uploadedItem = await uploadDropboxFile({
    accessToken: token.accessToken,
    path: fullPath,
    fileBuffer,
  });
  return {
    storageKey: uploadedItem?.path_display || fullPath,
    externalFileId: uploadedItem?.id || null,
    externalDriveId: null,
    externalParentId: parentPath || null,
    externalWebUrl: null,
    sourceOfTruth: "dropbox",
    storageStatus: "available",
    lastVerifiedAt: new Date().toISOString(),
  };
};

export const statDropboxEvidence = async ({ config, evidence }) => {
  const token = await resolveDropboxAccess(config);
  return fetchDropboxJson({
    accessToken: token.accessToken,
    endpoint: "/files/get_metadata",
    body: {
      path: toCleanString(evidence?.external_file_id || evidence?.externalFileId || evidence?.storage_key || evidence?.storageKey),
    },
  });
};

export const streamDropboxEvidence = async ({ config, evidence, disposition = "inline" }) => {
  const token = await resolveDropboxAccess(config);
  const path = toCleanString(evidence?.external_file_id || evidence?.externalFileId || evidence?.storage_key || evidence?.storageKey);
  if (!path) {
    throw createDropboxError("dropbox_evidence_missing_path", "Dropbox-backed evidence is missing a storage path.");
  }
  const upstream = await fetchDropboxRaw({
    accessToken: token.accessToken,
    endpoint: "/files/download",
    headers: {
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || evidence?.content_type || evidence?.contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Disposition": `${disposition}; filename="${normalizeItemName(evidence?.filename).replace(/"/g, "")}"`,
    },
  });
};

export const getDropboxAccessDescriptor = ({ disposition = "inline" } = {}) => ({
  mode: "proxy_stream",
  disposition,
});
