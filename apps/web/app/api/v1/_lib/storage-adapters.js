import { put } from "@vercel/blob";
import { DEFAULT_STORAGE_CONFIG, normalizeStorageConfigInput } from "../../../_lib/storage-config.js";
import { ensureStorageSchema, getSql } from "./db.js";
import {
  getDropboxAccessDescriptor,
  runDropboxHealthCheck,
  statDropboxEvidence,
  streamDropboxEvidence,
  uploadDropboxEvidence,
} from "./storage-dropbox.js";
import {
  getGoogleDriveAccessDescriptor,
  runGoogleDriveHealthCheck,
  statGoogleDriveEvidence,
  streamGoogleDriveEvidence,
  uploadGoogleDriveEvidence,
} from "./storage-google-drive.js";
import {
  getOneDriveAccessDescriptor,
  runOneDriveHealthCheck,
  statOneDriveEvidence,
  streamOneDriveEvidence,
  uploadOneDriveEvidence,
} from "./storage-onedrive.js";

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeBlobToken = (value) => {
  const raw = toCleanString(value);
  if (!raw) {
    return null;
  }
  const withoutQuotes = raw.replace(/^['"]+|['"]+$/g, "").trim();
  const withoutBearer = withoutQuotes.replace(/^bearer\s+/i, "").trim();
  const asciiOnly = withoutBearer.replace(/[^\x20-\x7E]/g, "");
  const compact = asciiOnly.replace(/\s+/g, "").trim();
  return compact || null;
};

const buildBlobKey = (tenantId, filename) => {
  const safeFilename = String(filename || "evidence.bin").replace(/[^a-zA-Z0-9._-]/g, "-");
  return `evidence/${tenantId}/${Date.now()}-${safeFilename}`;
};

const mapStorageConfigRow = (row) =>
  normalizeStorageConfigInput({
    ...DEFAULT_STORAGE_CONFIG,
    scopeLevel: row?.scope_level || "tenant",
    companyId: row?.company_id || "",
    storageMode: row?.storage_mode || DEFAULT_STORAGE_CONFIG.storageMode,
    primaryBackend: row?.primary_backend || DEFAULT_STORAGE_CONFIG.primaryBackend,
    repositoryDisplayName: row?.repository_display_name || DEFAULT_STORAGE_CONFIG.repositoryDisplayName,
    isActive: Boolean(row?.is_active),
    isDefault: Boolean(row?.is_default),
    authMode: row?.auth_mode || "",
    secretReference: row?.secret_reference || "",
    rootFolderPath: row?.root_folder_path || "",
    rootFolderId: row?.root_folder_id || "",
    driveId: row?.drive_id || "",
    externalTenantId: row?.external_tenant_id || "",
    mountPath: row?.mount_path || "",
    pathAccessMode: row?.path_access_mode || "",
    previewSupported: Boolean(row?.preview_supported),
    allowPlatformUpload: Boolean(row?.allow_platform_upload),
    allowReferenceOnlyMode: Boolean(row?.allow_reference_only_mode),
    downloadAccessMode: row?.download_access_mode || DEFAULT_STORAGE_CONFIG.downloadAccessMode,
    signedUrlTtlSec: row?.signed_url_ttl_sec == null ? DEFAULT_STORAGE_CONFIG.signedUrlTtlSec : Number(row.signed_url_ttl_sec),
    previewMode: row?.preview_mode || DEFAULT_STORAGE_CONFIG.previewMode,
    auditDownloads: Boolean(row?.audit_downloads),
    allowExportFileLinks: Boolean(row?.allow_export_file_links),
    exportLinkMode: row?.export_link_mode || DEFAULT_STORAGE_CONFIG.exportLinkMode,
    backupProfile: row?.backup_profile || DEFAULT_STORAGE_CONFIG.backupProfile,
    backupFrequency: row?.backup_frequency || DEFAULT_STORAGE_CONFIG.backupFrequency,
    backupRetentionDays: row?.backup_retention_days == null ? null : Number(row.backup_retention_days),
    backupVerificationMode: row?.backup_verification_mode || DEFAULT_STORAGE_CONFIG.backupVerificationMode,
    offsiteRepository: row?.offsite_repository || "",
    folderStrategy: row?.folder_strategy || DEFAULT_STORAGE_CONFIG.folderStrategy,
    customFolderPattern: row?.custom_folder_pattern || "",
    filenameStrategy: row?.filename_strategy || DEFAULT_STORAGE_CONFIG.filenameStrategy,
    enforceChecksum: Boolean(row?.enforce_checksum),
    duplicatePolicy: row?.duplicate_policy || DEFAULT_STORAGE_CONFIG.duplicatePolicy,
    versioningMode: row?.versioning_mode || DEFAULT_STORAGE_CONFIG.versioningMode,
    repositoryHealthStatus: row?.repository_health_status || DEFAULT_STORAGE_CONFIG.repositoryHealthStatus,
    lastValidationAt: row?.last_validation_at || null,
    lastErrorMessage: row?.last_error_message || "",
    migrationMode: row?.migration_mode || DEFAULT_STORAGE_CONFIG.migrationMode,
    legacyAccessFallback: row?.legacy_access_fallback !== false,
    migrationBatchSize: row?.migration_batch_size == null ? DEFAULT_STORAGE_CONFIG.migrationBatchSize : Number(row.migration_batch_size),
    migrationStatus: row?.migration_status || DEFAULT_STORAGE_CONFIG.migrationStatus,
    migrationNotes: row?.migration_notes || "",
    backupNotes: row?.backup_notes || "",
    adminNotes: row?.admin_notes || "",
  });

export const inferEvidenceStorageBackend = (row = {}) => {
  if (toCleanString(row.storage_backend)) {
    return toCleanString(row.storage_backend);
  }
  if (toCleanString(row.external_file_id || row.externalFileId)) {
    return "onedrive";
  }
  if (toCleanString(row.blob_url || row.blobUrl)) {
    return "vercel_blob";
  }
  return "vercel_blob";
};

export const buildControlledEvidenceUrl = (tenantId, evidenceId, mode = "preview") =>
  `/api/v1/tenants/${encodeURIComponent(tenantId)}/evidence/${encodeURIComponent(evidenceId)}/content?mode=${encodeURIComponent(mode)}`;

export const buildEvidenceAccess = (tenantId, evidenceRow = {}) => ({
  previewUrl: buildControlledEvidenceUrl(tenantId, evidenceRow.id, "preview"),
  downloadUrl: buildControlledEvidenceUrl(tenantId, evidenceRow.id, "download"),
});

export const resolveTenantStorageConfig = async (sql, tenantId, options = {}) => {
  await ensureStorageSchema();
  const client = sql || getSql();
  const activeRows = await client`
    SELECT *
    FROM tenant_storage_config
    WHERE tenant_id = ${tenantId}
      AND scope_level = 'tenant'
      AND company_id IS NULL
      AND is_active = TRUE
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  `;
  if (activeRows?.[0]) {
    return mapStorageConfigRow(activeRows[0]);
  }
  if (toCleanString(options.preferBackend)) {
    const backendRows = await client`
      SELECT *
      FROM tenant_storage_config
      WHERE tenant_id = ${tenantId}
        AND scope_level = 'tenant'
        AND company_id IS NULL
        AND primary_backend = ${options.preferBackend}
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `;
    if (backendRows?.[0]) {
      return mapStorageConfigRow(backendRows[0]);
    }
  }
  return normalizeStorageConfigInput(DEFAULT_STORAGE_CONFIG);
};

const legacyAdapter = {
  key: "vercel_blob",
  async validateConfig(config) {
    return {
      ok: Boolean(config),
      errors: [],
    };
  },
  async healthCheck() {
    return {
      ok: true,
      healthStatus: "healthy",
      checks: [
        {
          key: "legacy_platform_storage",
          label: "Platform-managed storage",
          status: "ok",
          message: "Legacy platform-managed evidence storage remains available.",
          extra: { code: "legacy_platform_storage_ok" },
        },
      ],
      message: "Platform-managed storage is available.",
    };
  },
  async uploadEvidence({ tenantId, fileBuffer, filename, contentType }) {
    const blobToken = normalizeBlobToken(process.env.BLOB_READ_WRITE_TOKEN);
    if (!blobToken) {
      const error = new Error("BLOB_READ_WRITE_TOKEN is required for platform-managed uploads.");
      error.code = "blob_token_missing";
      throw error;
    }
    const blobKey = buildBlobKey(tenantId, filename);
    const blob = await put(blobKey, fileBuffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: contentType || "application/octet-stream",
      token: blobToken,
    });
    return {
      blobUrl: blob?.url || null,
      storageKey: blobKey,
      externalFileId: null,
      externalDriveId: null,
      externalParentId: null,
      externalWebUrl: blob?.url || null,
      sourceOfTruth: "vercel_blob",
      storageStatus: "available",
      lastVerifiedAt: new Date().toISOString(),
    };
  },
  async getPreviewAccess() {
    return {
      mode: "redirect",
      disposition: "inline",
    };
  },
  async getDownloadAccess() {
    return {
      mode: "redirect",
      disposition: "attachment",
    };
  },
  async streamEvidence({ evidence, disposition = "inline" }) {
    const blobUrl = toCleanString(evidence?.blob_url || evidence?.blobUrl);
    if (!blobUrl) {
      const error = new Error("Legacy evidence record is missing blob_url.");
      error.code = "blob_url_missing";
      throw error;
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: blobUrl,
        "Cache-Control": "no-store",
        "X-Access-Disposition": disposition,
      },
    });
  },
  async stat({ evidence }) {
    return {
      id: evidence?.id || null,
      size: Number(evidence?.size_bytes ?? evidence?.sizeBytes ?? 0),
      webUrl: evidence?.blob_url || evidence?.blobUrl || null,
    };
  },
};

const oneDriveAdapter = {
  key: "onedrive",
  validateConfig: async (config) => ({ ok: true, errors: [], config }),
  healthCheck: runOneDriveHealthCheck,
  uploadEvidence: uploadOneDriveEvidence,
  getPreviewAccess: async () => getOneDriveAccessDescriptor({ disposition: "inline" }),
  getDownloadAccess: async () => getOneDriveAccessDescriptor({ disposition: "attachment" }),
  streamEvidence: streamOneDriveEvidence,
  stat: statOneDriveEvidence,
};

const dropboxAdapter = {
  key: "dropbox",
  validateConfig: async (config) => ({ ok: true, errors: [], config }),
  healthCheck: runDropboxHealthCheck,
  uploadEvidence: uploadDropboxEvidence,
  getPreviewAccess: async () => getDropboxAccessDescriptor({ disposition: "inline" }),
  getDownloadAccess: async () => getDropboxAccessDescriptor({ disposition: "attachment" }),
  streamEvidence: streamDropboxEvidence,
  stat: statDropboxEvidence,
};

const googleDriveAdapter = {
  key: "google_drive",
  validateConfig: async (config) => ({ ok: true, errors: [], config }),
  healthCheck: runGoogleDriveHealthCheck,
  uploadEvidence: uploadGoogleDriveEvidence,
  getPreviewAccess: async () => getGoogleDriveAccessDescriptor({ disposition: "inline" }),
  getDownloadAccess: async () => getGoogleDriveAccessDescriptor({ disposition: "attachment" }),
  streamEvidence: streamGoogleDriveEvidence,
  stat: statGoogleDriveEvidence,
};

const ADAPTERS = {
  vercel_blob: legacyAdapter,
  onedrive: oneDriveAdapter,
  dropbox: dropboxAdapter,
  google_drive: googleDriveAdapter,
};

export const getStorageAdapter = (configOrBackend = null) => {
  const backend =
    typeof configOrBackend === "string"
      ? configOrBackend
      : toCleanString(configOrBackend?.primaryBackend) || DEFAULT_STORAGE_CONFIG.primaryBackend;
  return ADAPTERS[backend] || legacyAdapter;
};

export { normalizeBlobToken, mapStorageConfigRow };
