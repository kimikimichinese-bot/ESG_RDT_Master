import { randomUUID } from "node:crypto";
import { resolveStorageSecret } from "./storage-secrets.js";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const SIMPLE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const createOneDriveError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const encodeGraphSegment = (value) => encodeURIComponent(String(value ?? ""));

const encodeGraphPath = (value) =>
  String(value || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const parseIso = (value) => {
  const normalized = toCleanString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isTokenFresh = (expiresAt) => {
  if (!(expiresAt instanceof Date)) {
    return false;
  }
  return expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_SKEW_MS;
};

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
    throw createOneDriveError("onedrive_secret_payload_invalid", "Resolved OneDrive secret payload must be an object.");
  }

  const authMode = toCleanString(config?.authMode);
  const normalized = {
    clientId: toCleanString(payload.clientId),
    clientSecret: toCleanString(payload.clientSecret),
    refreshToken: toCleanString(payload.refreshToken),
    accessToken: toCleanString(payload.accessToken),
    tokenType: toCleanString(payload.tokenType) || "Bearer",
    expiresAt: parseIso(payload.expiresAt),
    scope: toCleanString(payload.scope),
  };

  if (authMode === "client_credentials") {
    if (!normalized.clientId || !normalized.clientSecret) {
      throw createOneDriveError(
        "onedrive_secret_payload_invalid",
        "OneDrive client credentials mode requires clientId and clientSecret in the resolved secret payload.",
      );
    }
    return normalized;
  }

  if (authMode === "oauth_delegated") {
    if (normalized.accessToken || (normalized.refreshToken && normalized.clientId && normalized.clientSecret)) {
      return normalized;
    }
    throw createOneDriveError(
      "onedrive_secret_payload_invalid",
      "OneDrive delegated mode requires accessToken or refreshToken plus clientId/clientSecret in the resolved secret payload.",
    );
  }

  throw createOneDriveError(
    "onedrive_auth_mode_unsupported",
    "OneDrive supports client_credentials or oauth_delegated in this phase.",
    { authMode },
  );
};

const readGraphError = async (response, code, fallbackMessage, details = {}) => {
  let parsed = null;
  let rawText = "";
  try {
    rawText = await response.text();
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    parsed = null;
  }

  const providerCode = parsed?.error?.code || null;
  const providerMessage = parsed?.error?.message || rawText || fallbackMessage;
  throw createOneDriveError(code, providerMessage, {
    status: response.status,
    providerCode,
    ...details,
  });
};

const fetchGraphJson = async ({ accessToken, path, method = "GET", body = null, headers = {} }) => {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
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
    await readGraphError(response, "onedrive_graph_request_failed", "OneDrive Graph request failed.", { path, method });
  }
  return response.json();
};

const fetchGraphRaw = async ({ accessToken, path, method = "GET", headers = {}, body = null }) => {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    ...(body ? { body } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    await readGraphError(response, "onedrive_graph_request_failed", "OneDrive Graph request failed.", { path, method });
  }
  return response;
};

const fetchToken = async (config, secretPayload) => {
  const tenantId = toCleanString(config?.externalTenantId);
  if (!tenantId) {
    throw createOneDriveError("onedrive_config_invalid", "Microsoft tenant ID is required.");
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeGraphSegment(tenantId)}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.set("client_id", secretPayload.clientId);
  params.set("client_secret", secretPayload.clientSecret);

  if (config.authMode === "client_credentials") {
    params.set("grant_type", "client_credentials");
    params.set("scope", DEFAULT_GRAPH_SCOPE);
  } else if (config.authMode === "oauth_delegated") {
    if (secretPayload.accessToken && isTokenFresh(secretPayload.expiresAt)) {
      return {
        accessToken: secretPayload.accessToken,
        tokenType: secretPayload.tokenType || "Bearer",
        expiresAt: secretPayload.expiresAt?.toISOString?.() || null,
      };
    }
    if (!secretPayload.refreshToken) {
      throw createOneDriveError(
        "onedrive_secret_payload_invalid",
        "Delegated OneDrive auth requires a fresh accessToken or a refreshToken.",
      );
    }
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", secretPayload.refreshToken);
    params.set("scope", secretPayload.scope || "offline_access Files.ReadWrite.All Sites.ReadWrite.All");
  } else {
    throw createOneDriveError(
      "onedrive_auth_mode_unsupported",
      "OneDrive supports client_credentials or oauth_delegated in this phase.",
      { authMode: config.authMode },
    );
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    await readGraphError(response, "onedrive_auth_failed", "Failed to obtain a Microsoft Graph access token.", {
      authMode: config.authMode,
    });
  }

  const payload = await response.json();
  const accessToken = toCleanString(payload?.access_token);
  if (!accessToken) {
    throw createOneDriveError("onedrive_auth_failed", "Microsoft token response did not include an access token.");
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

export const resolveOneDriveAccess = async (config) => {
  const payload = normalizeSecretPayload(await resolveStorageSecret(config.secretReference), config);
  const token = await fetchToken(config, payload);
  return {
    ...token,
    secretKeys: Object.keys(payload).sort(),
  };
};

const getDriveMetadata = async (config, accessToken) =>
  fetchGraphJson({
    accessToken,
    path: `/drives/${encodeGraphSegment(config.driveId)}?$select=id,name,driveType,webUrl`,
  });

const getRootFolderMetadata = async (config, accessToken) => {
  if (toCleanString(config.rootFolderId)) {
    return fetchGraphJson({
      accessToken,
      path: `/drives/${encodeGraphSegment(config.driveId)}/items/${encodeGraphSegment(config.rootFolderId)}?$select=id,name,webUrl,parentReference,folder`,
    });
  }

  const rootPath = splitFolderPath(config.rootFolderPath).join("/");
  if (!rootPath) {
    throw createOneDriveError("onedrive_config_invalid", "OneDrive root folder ID or root folder path is required.");
  }

  return fetchGraphJson({
    accessToken,
    path: `/drives/${encodeGraphSegment(config.driveId)}/root:/${encodeGraphPath(rootPath)}?$select=id,name,webUrl,parentReference,folder`,
  });
};

const getChildFolderByName = async ({ accessToken, driveId, parentId, name }) => {
  try {
    return await fetchGraphJson({
      accessToken,
      path: `/drives/${encodeGraphSegment(driveId)}/items/${encodeGraphSegment(parentId)}:/${encodeGraphPath(name)}?$select=id,name,webUrl,parentReference,folder`,
    });
  } catch (error) {
    if (error?.details?.status !== 404) {
      throw error;
    }
    return null;
  }
};

const ensureFolderPath = async ({ accessToken, driveId, parentId, segments }) => {
  let currentParentId = parentId;
  let currentFolder = null;
  for (const segment of segments) {
    const existing = await getChildFolderByName({
      accessToken,
      driveId,
      parentId: currentParentId,
      name: segment,
    });
    if (existing?.id) {
      currentFolder = existing;
      currentParentId = existing.id;
      continue;
    }
    currentFolder = await fetchGraphJson({
      accessToken,
      method: "POST",
      path: `/drives/${encodeGraphSegment(driveId)}/items/${encodeGraphSegment(currentParentId)}/children`,
      body: {
        name: segment,
        folder: {},
        "@microsoft.graph.conflictBehavior": "replace",
      },
    });
    currentParentId = currentFolder.id;
  }
  return currentFolder || { id: parentId };
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

const uploadSimpleFile = async ({ accessToken, driveId, parentId, filename, fileBuffer, contentType }) => {
  const response = await fetch(
    `${GRAPH_BASE_URL}/drives/${encodeGraphSegment(driveId)}/items/${encodeGraphSegment(parentId)}:/${encodeGraphPath(filename)}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType || "application/octet-stream",
      },
      body: fileBuffer,
      cache: "no-store",
    },
  );

  if (!response.ok) {
    await readGraphError(response, "onedrive_upload_failed", "OneDrive upload failed.");
  }

  return response.json();
};

const uploadLargeFile = async ({ accessToken, driveId, parentId, filename, fileBuffer, contentType }) => {
  const session = await fetchGraphJson({
    accessToken,
    method: "POST",
    path: `/drives/${encodeGraphSegment(driveId)}/items/${encodeGraphSegment(parentId)}:/${encodeGraphPath(filename)}:/createUploadSession`,
    body: {
      item: {
        "@microsoft.graph.conflictBehavior": "replace",
      },
    },
  });

  const uploadUrl = toCleanString(session?.uploadUrl);
  if (!uploadUrl) {
    throw createOneDriveError("onedrive_upload_session_failed", "OneDrive upload session did not return an uploadUrl.");
  }

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(fileBuffer.byteLength),
      "Content-Range": `bytes 0-${fileBuffer.byteLength - 1}/${fileBuffer.byteLength}`,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: fileBuffer,
    cache: "no-store",
  });

  if (!response.ok) {
    await readGraphError(response, "onedrive_upload_failed", "OneDrive upload session failed.");
  }

  return response.json();
};

const deleteItem = async ({ accessToken, driveId, itemId }) => {
  const response = await fetch(`${GRAPH_BASE_URL}/drives/${encodeGraphSegment(driveId)}/items/${encodeGraphSegment(itemId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok && response.status !== 404) {
    await readGraphError(response, "onedrive_delete_failed", "Unable to delete OneDrive probe item.");
  }
};

export const validateOneDriveConfig = (config = {}) => {
  const errors = [];
  if (!toCleanString(config.authMode)) {
    errors.push({ key: "auth_mode", message: "Authentication mode is required." });
  }
  if (!toCleanString(config.externalTenantId)) {
    errors.push({ key: "external_tenant_id", message: "Microsoft tenant ID is required." });
  }
  if (!toCleanString(config.driveId)) {
    errors.push({ key: "drive_id", message: "Drive ID is required." });
  }
  if (!toCleanString(config.rootFolderId) && !toCleanString(config.rootFolderPath)) {
    errors.push({ key: "root_folder", message: "Root folder ID or root folder path is required." });
  }
  if (!toCleanString(config.secretReference)) {
    errors.push({ key: "secret_reference", message: "secret_reference is required." });
  }
  return {
    ok: errors.length === 0,
    errors,
  };
};

export const runOneDriveHealthCheck = async (config, { mode = "connection" } = {}) => {
  const checks = [];
  const validation = validateOneDriveConfig(config);
  for (const error of validation.errors) {
    checks.push({
      key: error.key,
      label: error.key.replaceAll("_", " "),
      status: "failed",
      message: error.message,
      extra: { code: "onedrive_config_invalid" },
    });
  }
  if (!validation.ok) {
    return {
      ok: true,
      healthStatus: "misconfigured",
      checks,
      message: "OneDrive configuration is incomplete.",
    };
  }

  let token = null;
  let rootFolder = null;
  try {
    token = await resolveOneDriveAccess(config);
    checks.push({
      key: "auth",
      label: "Authentication",
      status: "ok",
      message: "Microsoft Graph access token resolved successfully.",
      extra: {
        code: "onedrive_auth_ok",
        expiresAt: token.expiresAt,
        secretKeys: token.secretKeys,
      },
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "onedrive_auth_failed";
    checks.push({
      key: "auth",
      label: "Authentication",
      status: "failed",
      message: error instanceof Error ? error.message : "Authentication failed.",
      extra: { code },
    });
    return {
      ok: true,
      healthStatus: code === "onedrive_auth_failed" ? "auth_expired" : "misconfigured",
      checks,
      message: "OneDrive authentication failed.",
    };
  }

  try {
    const drive = await getDriveMetadata(config, token.accessToken);
    checks.push({
      key: "drive_access",
      label: "Drive access",
      status: "ok",
      message: `Drive reachable: ${drive?.name || config.driveId}`,
      extra: { code: "onedrive_drive_ok", driveId: drive?.id || config.driveId },
    });

    rootFolder = await getRootFolderMetadata(config, token.accessToken);
    checks.push({
      key: "root_folder_access",
      label: "Root folder access",
      status: "ok",
      message: `Root folder reachable: ${rootFolder?.name || config.rootFolderPath || config.rootFolderId}`,
      extra: {
        code: "onedrive_root_ok",
        rootFolderId: rootFolder?.id || null,
        webUrl: rootFolder?.webUrl || null,
      },
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "onedrive_graph_request_failed";
    checks.push({
      key: "repository_access",
      label: "Repository access",
      status: "failed",
      message: error instanceof Error ? error.message : "Unable to access the configured drive or root folder.",
      extra: { code },
    });
    return {
      ok: true,
      healthStatus: code === "onedrive_auth_failed" ? "auth_expired" : "unreachable",
      checks,
      message: "OneDrive repository access failed.",
    };
  }

  if (mode === "upload" || mode === "preview") {
    const probeName = `.esg-rdt-probe-${Date.now()}.txt`;
    let probeItem = null;
    try {
      probeItem = await uploadSimpleFile({
        accessToken: token.accessToken,
        driveId: config.driveId,
        parentId: rootFolder.id,
        filename: probeName,
        fileBuffer: Buffer.from(`probe:${Date.now()}`, "utf-8"),
        contentType: "text/plain; charset=utf-8",
      });
      checks.push({
        key: "probe_upload",
        label: "Probe upload",
        status: "ok",
        message: "Temporary OneDrive probe file uploaded successfully.",
        extra: { code: "onedrive_probe_upload_ok", itemId: probeItem?.id || null },
      });

      if (mode === "preview") {
        const previewResponse = await fetchGraphRaw({
          accessToken: token.accessToken,
          path: `/drives/${encodeGraphSegment(config.driveId)}/items/${encodeGraphSegment(probeItem.id)}/content`,
        });
        const previewText = await previewResponse.text();
        checks.push({
          key: "probe_preview",
          label: "Probe preview",
          status: previewText.startsWith("probe:") ? "ok" : "failed",
          message: previewText.startsWith("probe:")
            ? "Temporary probe content was fetched successfully through Microsoft Graph."
            : "Probe content could not be verified.",
          extra: { code: previewText.startsWith("probe:") ? "onedrive_probe_preview_ok" : "onedrive_probe_preview_failed" },
        });
      }
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "onedrive_probe_failed";
      checks.push({
        key: mode === "preview" ? "probe_preview" : "probe_upload",
        label: mode === "preview" ? "Probe preview" : "Probe upload",
        status: "failed",
        message: error instanceof Error ? error.message : "OneDrive probe failed.",
        extra: { code },
      });
      return {
        ok: true,
        healthStatus: "warning",
        checks,
        message: mode === "preview" ? "OneDrive preview probe failed." : "OneDrive upload probe failed.",
      };
    } finally {
      if (probeItem?.id) {
        try {
          await deleteItem({
            accessToken: token.accessToken,
            driveId: config.driveId,
            itemId: probeItem.id,
          });
        } catch (_error) {
          // Probe cleanup should not mask the primary result.
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
        ? "OneDrive connection validated successfully."
        : mode === "preview"
          ? "OneDrive preview probe completed successfully."
          : "OneDrive upload probe completed successfully.",
  };
};

export const uploadOneDriveEvidence = async ({ config, tenantId, fileBuffer, filename, contentType, metadata = {} }) => {
  const token = await resolveOneDriveAccess(config);
  const rootFolder = await getRootFolderMetadata(config, token.accessToken);
  const folderSegments = toUploadFolderSegments({ config, tenantId, metadata });
  const targetFolder = await ensureFolderPath({
    accessToken: token.accessToken,
    driveId: config.driveId,
    parentId: rootFolder.id,
    segments: folderSegments,
  });
  const storedFilename = toStoredFilename({ config, filename, metadata });

  const uploadedItem =
    fileBuffer.byteLength > SIMPLE_UPLOAD_LIMIT_BYTES
      ? await uploadLargeFile({
          accessToken: token.accessToken,
          driveId: config.driveId,
          parentId: targetFolder.id,
          filename: storedFilename,
          fileBuffer,
          contentType,
        })
      : await uploadSimpleFile({
          accessToken: token.accessToken,
          driveId: config.driveId,
          parentId: targetFolder.id,
          filename: storedFilename,
          fileBuffer,
          contentType,
        });

  return {
    storageKey: [...folderSegments, storedFilename].join("/"),
    externalFileId: uploadedItem?.id || null,
    externalDriveId: uploadedItem?.parentReference?.driveId || config.driveId,
    externalParentId: uploadedItem?.parentReference?.id || targetFolder.id || null,
    externalWebUrl: uploadedItem?.webUrl || null,
    sourceOfTruth: "onedrive",
    storageStatus: "available",
    lastVerifiedAt: new Date().toISOString(),
  };
};

export const statOneDriveEvidence = async ({ config, evidence }) => {
  const externalFileId = toCleanString(evidence?.external_file_id || evidence?.externalFileId);
  if (!externalFileId) {
    throw createOneDriveError("onedrive_evidence_missing_external_file_id", "OneDrive-backed evidence is missing external_file_id.");
  }
  const token = await resolveOneDriveAccess(config);
  const item = await fetchGraphJson({
    accessToken: token.accessToken,
    path:
      `/drives/${encodeGraphSegment(config.driveId)}/items/${encodeGraphSegment(externalFileId)}` +
      "?$select=id,name,size,webUrl,lastModifiedDateTime,parentReference,file",
  });
  return item;
};

export const streamOneDriveEvidence = async ({ config, evidence, disposition = "inline" }) => {
  const externalFileId = toCleanString(evidence?.external_file_id || evidence?.externalFileId);
  if (!externalFileId) {
    throw createOneDriveError("onedrive_evidence_missing_external_file_id", "OneDrive-backed evidence is missing external_file_id.");
  }
  const token = await resolveOneDriveAccess(config);
  const upstream = await fetchGraphRaw({
    accessToken: token.accessToken,
    path: `/drives/${encodeGraphSegment(config.driveId)}/items/${encodeGraphSegment(externalFileId)}/content`,
  });
  const contentType = upstream.headers.get("content-type") || evidence?.content_type || evidence?.contentType || "application/octet-stream";
  const filename = normalizeItemName(evidence?.filename);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Disposition": `${disposition}; filename="${filename.replace(/"/g, "")}"`,
    },
  });
};

export const getOneDriveAccessDescriptor = ({ disposition = "inline" } = {}) => ({
  mode: "proxy_stream",
  disposition,
});
