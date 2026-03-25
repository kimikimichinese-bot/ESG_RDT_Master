import { randomUUID } from "node:crypto";
import { resolveStorageSecret } from "./storage-secrets.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const createGoogleDriveError = (code, message, details = {}) => {
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

const normalizeSecretPayload = (payload, config) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createGoogleDriveError("gdrive_secret_payload_invalid", "Resolved Google Drive secret payload must be an object.");
  }
  if (toCleanString(config?.authMode) !== "oauth_delegated") {
    throw createGoogleDriveError(
      "gdrive_auth_mode_unsupported",
      "Google Drive currently supports oauth_delegated in this phase.",
      { authMode: config?.authMode || "" },
    );
  }
  const normalized = {
    clientId: toCleanString(payload.clientId),
    clientSecret: toCleanString(payload.clientSecret),
    refreshToken: toCleanString(payload.refreshToken),
    accessToken: toCleanString(payload.accessToken),
    tokenType: toCleanString(payload.tokenType) || "Bearer",
    expiresAt: parseIso(payload.expiresAt),
    scope: toCleanString(payload.scope),
  };
  if (!normalized.clientId || !normalized.clientSecret || (!normalized.refreshToken && !normalized.accessToken)) {
    throw createGoogleDriveError(
      "gdrive_secret_payload_invalid",
      "Google Drive delegated auth requires clientId, clientSecret, and refreshToken or accessToken.",
    );
  }
  return normalized;
};

const readGoogleDriveError = async (response, code, fallbackMessage, details = {}) => {
  const rawText = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    parsed = null;
  }
  throw createGoogleDriveError(code, parsed?.error?.message || rawText || fallbackMessage, {
    status: response.status,
    ...details,
  });
};

const refreshGoogleDriveToken = async (secretPayload) => {
  if (secretPayload.accessToken && isTokenFresh(secretPayload.expiresAt)) {
    return {
      accessToken: secretPayload.accessToken,
      tokenType: secretPayload.tokenType || "Bearer",
      expiresAt: secretPayload.expiresAt?.toISOString?.() || null,
    };
  }
  if (!secretPayload.refreshToken) {
    throw createGoogleDriveError("gdrive_secret_payload_invalid", "Google Drive refreshToken is required.");
  }
  const params = new URLSearchParams();
  params.set("client_id", secretPayload.clientId);
  params.set("client_secret", secretPayload.clientSecret);
  params.set("refresh_token", secretPayload.refreshToken);
  params.set("grant_type", "refresh_token");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });
  if (!response.ok) {
    await readGoogleDriveError(response, "gdrive_auth_failed", "Google Drive token refresh failed.");
  }
  const payload = await response.json();
  const accessToken = toCleanString(payload?.access_token);
  if (!accessToken) {
    throw createGoogleDriveError("gdrive_auth_failed", "Google Drive token response did not include an access token.");
  }
  return {
    accessToken,
    tokenType: toCleanString(payload?.token_type) || "Bearer",
    expiresAt:
      Number.isFinite(Number(payload?.expires_in)) && Number(payload.expires_in) > 0
        ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
        : null,
  };
};

const fetchGoogleDriveJson = async ({ accessToken, url, method = "GET", body = null, headers = {} }) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    await readGoogleDriveError(response, "gdrive_api_failed", "Google Drive API request failed.", { url, method });
  }
  return response.json();
};

const fetchGoogleDriveRaw = async ({ accessToken, url, method = "GET", headers = {}, body = null }) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    ...(body ? { body } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    await readGoogleDriveError(response, "gdrive_api_failed", "Google Drive content request failed.", { url, method });
  }
  return response;
};

const escapeQueryValue = (value) => String(value || "").replace(/'/g, "\\'");

export const resolveGoogleDriveAccess = async (config) => {
  const secretPayload = normalizeSecretPayload(await resolveStorageSecret(config.secretReference), config);
  const token = await refreshGoogleDriveToken(secretPayload);
  return {
    ...token,
    secretKeys: Object.keys(secretPayload).sort(),
  };
};

export const validateGoogleDriveConfig = (config = {}) => {
  const errors = [];
  if (!toCleanString(config.authMode)) {
    errors.push({ key: "auth_mode", message: "Authentication mode is required." });
  }
  if (!toCleanString(config.secretReference)) {
    errors.push({ key: "secret_reference", message: "secret_reference is required." });
  }
  if (!toCleanString(config.rootFolderId) && !toCleanString(config.rootFolderPath)) {
    errors.push({ key: "root_folder", message: "Root folder ID or root folder path is required." });
  }
  return {
    ok: errors.length === 0,
    errors,
  };
};

const searchFolderByName = async ({ accessToken, driveId, parentId, name }) => {
  const query = [`mimeType='${FOLDER_MIME_TYPE}'`, `name='${escapeQueryValue(name)}'`, `'${parentId}' in parents`, "trashed=false"];
  const params = new URLSearchParams();
  params.set("q", query.join(" and "));
  params.set("fields", "files(id,name,driveId,webViewLink)");
  params.set("supportsAllDrives", "true");
  params.set("includeItemsFromAllDrives", "true");
  if (driveId) {
    params.set("corpora", "drive");
    params.set("driveId", driveId);
  } else {
    params.set("corpora", "allDrives");
  }
  const response = await fetchGoogleDriveJson({
    accessToken,
    url: `${API_BASE_URL}/files?${params.toString()}`,
  });
  return response.files?.[0] || null;
};

const createFolder = async ({ accessToken, driveId, parentId, name }) =>
  fetchGoogleDriveJson({
    accessToken,
    url: `${API_BASE_URL}/files?supportsAllDrives=true`,
    method: "POST",
    body: {
      name,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentId],
      ...(driveId ? { driveId } : {}),
    },
  });

const ensureFolderPath = async ({ accessToken, driveId, parentId, segments }) => {
  let currentParentId = parentId;
  let currentFolder = null;
  for (const segment of segments) {
    currentFolder = await searchFolderByName({
      accessToken,
      driveId,
      parentId: currentParentId,
      name: segment,
    });
    if (!currentFolder) {
      currentFolder = await createFolder({
        accessToken,
        driveId,
        parentId: currentParentId,
        name: segment,
      });
    }
    currentParentId = currentFolder.id;
  }
  return currentFolder || { id: parentId, driveId };
};

const resolveRootFolder = async (config, accessToken) => {
  if (toCleanString(config.rootFolderId)) {
    return fetchGoogleDriveJson({
      accessToken,
      url:
        `${API_BASE_URL}/files/${encodeURIComponent(config.rootFolderId)}` +
        "?supportsAllDrives=true&fields=id,name,driveId,webViewLink,mimeType",
    });
  }

  const segments = splitFolderPath(config.rootFolderPath);
  let parentId = "root";
  let current = null;
  for (const segment of segments) {
    current = await searchFolderByName({
      accessToken,
      driveId: toCleanString(config.driveId),
      parentId,
      name: segment,
    });
    if (!current) {
      throw createGoogleDriveError("gdrive_root_not_found", `Google Drive root folder path segment not found: ${segment}`);
    }
    parentId = current.id;
  }
  return current || { id: "root", name: "My Drive Root", driveId: toCleanString(config.driveId) || null };
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

const uploadGoogleDriveFile = async ({ accessToken, metadata, fileBuffer, contentType }) => {
  const boundary = `esgrdt-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${
      contentType || "application/octet-stream"
    }\r\n\r\n`,
    "utf-8",
  );
  const closing = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  const body = Buffer.concat([preamble, fileBuffer, closing]);
  const response = await fetch(`${UPLOAD_BASE_URL}/files?uploadType=multipart&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    await readGoogleDriveError(response, "gdrive_upload_failed", "Google Drive upload failed.");
  }
  return response.json();
};

const deleteGoogleDriveFile = async ({ accessToken, fileId }) => {
  const response = await fetch(`${API_BASE_URL}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) {
    await readGoogleDriveError(response, "gdrive_delete_failed", "Google Drive delete failed.");
  }
};

export const runGoogleDriveHealthCheck = async (config, { mode = "connection" } = {}) => {
  const checks = [];
  const validation = validateGoogleDriveConfig(config);
  for (const error of validation.errors) {
    checks.push({
      key: error.key,
      label: error.key.replaceAll("_", " "),
      status: "failed",
      message: error.message,
      extra: { code: "gdrive_config_invalid" },
    });
  }
  if (!validation.ok) {
    return {
      ok: true,
      healthStatus: "misconfigured",
      checks,
      message: "Google Drive configuration is incomplete.",
    };
  }

  let token = null;
  let root = null;
  try {
    token = await resolveGoogleDriveAccess(config);
    checks.push({
      key: "auth",
      label: "Authentication",
      status: "ok",
      message: "Google Drive access token resolved successfully.",
      extra: { code: "gdrive_auth_ok", expiresAt: token.expiresAt, secretKeys: token.secretKeys },
    });
    const about = await fetchGoogleDriveJson({
      accessToken: token.accessToken,
      url: "https://www.googleapis.com/drive/v3/about?fields=user",
    });
    checks.push({
      key: "account_access",
      label: "Account access",
      status: "ok",
      message: `Google account reachable: ${about?.user?.emailAddress || "connected"}`,
      extra: { code: "gdrive_account_ok" },
    });
    root = await resolveRootFolder(config, token.accessToken);
    checks.push({
      key: "root_folder_access",
      label: "Root folder access",
      status: "ok",
      message: `Root folder reachable: ${root?.name || config.rootFolderId || config.rootFolderPath}`,
      extra: { code: "gdrive_root_ok", rootFolderId: root?.id || null, driveId: root?.driveId || config.driveId || null },
    });
  } catch (error) {
    checks.push({
      key: "repository_access",
      label: "Repository access",
      status: "failed",
      message: error instanceof Error ? error.message : "Google Drive access failed.",
      extra: { code: typeof error?.code === "string" ? error.code : "gdrive_access_failed" },
    });
    return {
      ok: true,
      healthStatus: "warning",
      checks,
      message: "Google Drive validation failed.",
    };
  }

  if (mode === "upload" || mode === "preview") {
    let probe = null;
    try {
      probe = await uploadGoogleDriveFile({
        accessToken: token.accessToken,
        metadata: {
          name: `.esg-rdt-probe-${Date.now()}.txt`,
          parents: [root.id],
        },
        fileBuffer: Buffer.from(`probe:${Date.now()}`, "utf-8"),
        contentType: "text/plain; charset=utf-8",
      });
      checks.push({
        key: "probe_upload",
        label: "Probe upload",
        status: "ok",
        message: "Temporary Google Drive probe file uploaded successfully.",
        extra: { code: "gdrive_probe_upload_ok", fileId: probe?.id || null },
      });
      if (mode === "preview") {
        const previewResponse = await fetchGoogleDriveRaw({
          accessToken: token.accessToken,
          url: `${API_BASE_URL}/files/${encodeURIComponent(probe.id)}?alt=media&supportsAllDrives=true`,
        });
        const previewText = await previewResponse.text();
        checks.push({
          key: "probe_preview",
          label: "Probe preview",
          status: previewText.startsWith("probe:") ? "ok" : "failed",
          message: previewText.startsWith("probe:")
            ? "Temporary probe content was fetched successfully through Google Drive."
            : "Probe content could not be verified.",
          extra: { code: previewText.startsWith("probe:") ? "gdrive_probe_preview_ok" : "gdrive_probe_preview_failed" },
        });
      }
    } catch (error) {
      checks.push({
        key: mode === "preview" ? "probe_preview" : "probe_upload",
        label: mode === "preview" ? "Probe preview" : "Probe upload",
        status: "failed",
        message: error instanceof Error ? error.message : "Google Drive probe failed.",
        extra: { code: typeof error?.code === "string" ? error.code : "gdrive_probe_failed" },
      });
      return {
        ok: true,
        healthStatus: "warning",
        checks,
        message: mode === "preview" ? "Google Drive preview probe failed." : "Google Drive upload probe failed.",
      };
    } finally {
      if (probe?.id) {
        try {
          await deleteGoogleDriveFile({ accessToken: token.accessToken, fileId: probe.id });
        } catch (_error) {
          // ignore cleanup errors
        }
      }
    }
  }

  return {
    ok: true,
    healthStatus: "healthy",
    checks,
    message:
      mode === "connection"
        ? "Google Drive connection validated successfully."
        : mode === "preview"
          ? "Google Drive preview probe completed successfully."
          : "Google Drive upload probe completed successfully.",
  };
};

export const uploadGoogleDriveEvidence = async ({ config, tenantId, fileBuffer, filename, contentType, metadata = {} }) => {
  const token = await resolveGoogleDriveAccess(config);
  const root = await resolveRootFolder(config, token.accessToken);
  const folderSegments = toUploadFolderSegments({ config, tenantId, metadata });
  const parentFolder = await ensureFolderPath({
    accessToken: token.accessToken,
    driveId: toCleanString(config.driveId) || root?.driveId || "",
    parentId: root.id,
    segments: folderSegments,
  });
  const storedFilename = toStoredFilename({ config, filename, metadata });
  const uploaded = await uploadGoogleDriveFile({
    accessToken: token.accessToken,
    metadata: {
      name: storedFilename,
      parents: [parentFolder.id],
    },
    fileBuffer,
    contentType,
  });
  return {
    storageKey: [...folderSegments, storedFilename].join("/"),
    externalFileId: uploaded?.id || null,
    externalDriveId: uploaded?.driveId || parentFolder?.driveId || config.driveId || null,
    externalParentId: parentFolder.id,
    externalWebUrl: uploaded?.webViewLink || null,
    sourceOfTruth: "google_drive",
    storageStatus: "available",
    lastVerifiedAt: new Date().toISOString(),
  };
};

export const statGoogleDriveEvidence = async ({ config, evidence }) => {
  const token = await resolveGoogleDriveAccess(config);
  const fileId = toCleanString(evidence?.external_file_id || evidence?.externalFileId);
  if (!fileId) {
    throw createGoogleDriveError("gdrive_evidence_missing_file_id", "Google Drive-backed evidence is missing external_file_id.");
  }
  return fetchGoogleDriveJson({
    accessToken: token.accessToken,
    url:
      `${API_BASE_URL}/files/${encodeURIComponent(fileId)}` +
      "?supportsAllDrives=true&fields=id,name,size,driveId,webViewLink,mimeType,parents",
  });
};

export const streamGoogleDriveEvidence = async ({ config, evidence, disposition = "inline" }) => {
  const token = await resolveGoogleDriveAccess(config);
  const fileId = toCleanString(evidence?.external_file_id || evidence?.externalFileId);
  if (!fileId) {
    throw createGoogleDriveError("gdrive_evidence_missing_file_id", "Google Drive-backed evidence is missing external_file_id.");
  }
  const upstream = await fetchGoogleDriveRaw({
    accessToken: token.accessToken,
    url: `${API_BASE_URL}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
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

export const getGoogleDriveAccessDescriptor = ({ disposition = "inline" } = {}) => ({
  mode: "proxy_stream",
  disposition,
});
