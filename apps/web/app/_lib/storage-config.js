const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const toNullableString = (value) => {
  const normalized = toCleanString(value);
  return normalized || null;
};

const toBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
};

const toInteger = (value, fallback = null) => {
  if (value === "" || value == null) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const STORAGE_SCOPE_OPTIONS = [
  { value: "tenant", label: "Tenant-wide" },
  { value: "company", label: "Company override" },
];

export const STORAGE_MODE_OPTIONS = [
  { value: "platform_managed", label: "Platform managed" },
  { value: "customer_managed", label: "Customer managed" },
  { value: "hybrid", label: "Hybrid" },
];

export const STORAGE_BACKEND_OPTIONS = [
  { value: "vercel_blob", label: "Vercel Blob" },
  { value: "onedrive", label: "OneDrive" },
  { value: "sharepoint", label: "SharePoint" },
  { value: "dropbox", label: "Dropbox" },
  { value: "google_drive", label: "Google Drive" },
  { value: "nas_path", label: "NAS path" },
  { value: "local_path", label: "Local path" },
  { value: "external_disk_path", label: "External disk path" },
  { value: "s3", label: "S3" },
  { value: "azure_blob", label: "Azure Blob" },
  { value: "other_webdav", label: "Other WebDAV" },
];

export const AUTH_MODE_OPTIONS = [
  { value: "oauth_delegated", label: "OAuth delegated" },
  { value: "client_credentials", label: "Client credentials" },
  { value: "service_account", label: "Service account" },
  { value: "shared_secret", label: "Shared secret" },
  { value: "manual_reference", label: "Manual reference" },
];

export const PATH_ACCESS_MODE_OPTIONS = [
  { value: "platform_reads_and_writes", label: "Platform reads and writes" },
  { value: "platform_metadata_only", label: "Platform metadata only" },
  { value: "reference_only", label: "Reference only" },
];

export const DOWNLOAD_ACCESS_MODE_OPTIONS = [
  { value: "signed_url_short_lived", label: "Signed URL short-lived" },
  { value: "proxy_stream", label: "Proxy stream" },
  { value: "provider_preview_link", label: "Provider preview link" },
  { value: "metadata_only", label: "Metadata only" },
];

export const PREVIEW_MODE_OPTIONS = [
  { value: "platform_viewer", label: "Platform viewer" },
  { value: "provider_viewer", label: "Provider viewer" },
  { value: "download_only", label: "Download only" },
];

export const EXPORT_LINK_MODE_OPTIONS = [
  { value: "no_links", label: "No links" },
  { value: "reference_only", label: "Reference only" },
  { value: "short_lived_links", label: "Short-lived links" },
  { value: "direct_links_if_allowed", label: "Direct links if allowed" },
];

export const BACKUP_PROFILE_OPTIONS = [
  { value: "no_backup", label: "No backup" },
  { value: "basic_2_copy", label: "Basic 2-copy" },
  { value: "3_2_1_standard", label: "3-2-1 standard" },
  { value: "custom", label: "Custom" },
];

export const BACKUP_FREQUENCY_OPTIONS = [
  { value: "realtime", label: "Real-time" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "manual", label: "Manual" },
];

export const BACKUP_VERIFICATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "existence_check", label: "Existence check" },
  { value: "checksum_check", label: "Checksum check" },
  { value: "sample_restore_check", label: "Sample restore check" },
];

export const FOLDER_STRATEGY_OPTIONS = [
  { value: "tenant_company_year", label: "Tenant / Company / Year" },
  { value: "company_site_year", label: "Company / Site / Year" },
  { value: "year_doc_type", label: "Year / Document type" },
  { value: "company_year_entity_type", label: "Company / Year / Entity type" },
  { value: "custom", label: "Custom pattern" },
];

export const FILENAME_STRATEGY_OPTIONS = [
  { value: "original_filename", label: "Original filename" },
  { value: "timestamp_original", label: "Timestamp + original" },
  { value: "uuid_original", label: "UUID + original" },
  { value: "entity_prefixed", label: "Entity-prefixed" },
  { value: "custom", label: "Custom" },
];

export const DUPLICATE_POLICY_OPTIONS = [
  { value: "allow_duplicates", label: "Allow duplicates" },
  { value: "warn_on_same_hash", label: "Warn on same hash" },
  { value: "block_on_same_hash", label: "Block on same hash" },
  { value: "create_new_version", label: "Create new version" },
];

export const VERSIONING_MODE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "manual_versions", label: "Manual versions" },
  { value: "auto_version_on_replace", label: "Auto-version on replace" },
];

export const REPOSITORY_HEALTH_OPTIONS = [
  { value: "healthy", label: "Healthy" },
  { value: "warning", label: "Warning" },
  { value: "unreachable", label: "Unreachable" },
  { value: "auth_expired", label: "Auth expired" },
  { value: "misconfigured", label: "Misconfigured" },
];

export const MIGRATION_MODE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "new_uploads_only", label: "New uploads only" },
  { value: "progressive_migration", label: "Progressive migration" },
  { value: "full_cutover", label: "Full cutover" },
];

export const MIGRATION_STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "running", label: "Running" },
  { value: "partial", label: "Partial" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export const STORAGE_ADAPTERS = {
  vercel_blob: {
    type: "platform",
    supportsPreview: true,
    canUpload: true,
    structuralChecks: ["repository_name", "download_access_mode", "signed_url_ttl"],
  },
  onedrive: {
    type: "customer",
    supportsPreview: true,
    canUpload: true,
    structuralChecks: ["auth_mode", "external_tenant_id", "drive_id", "root_folder"],
  },
  sharepoint: {
    type: "customer",
    supportsPreview: true,
    canUpload: true,
    structuralChecks: ["auth_mode", "external_tenant_id", "drive_id", "root_folder"],
  },
  dropbox: {
    type: "customer",
    supportsPreview: true,
    canUpload: true,
    structuralChecks: ["auth_mode", "root_folder"],
  },
  google_drive: {
    type: "customer",
    supportsPreview: true,
    canUpload: true,
    structuralChecks: ["auth_mode", "root_folder"],
  },
  nas_path: {
    type: "path",
    supportsPreview: false,
    canUpload: false,
    structuralChecks: ["mount_path", "path_access_mode"],
  },
  local_path: {
    type: "path",
    supportsPreview: false,
    canUpload: false,
    structuralChecks: ["mount_path", "path_access_mode"],
  },
  external_disk_path: {
    type: "path",
    supportsPreview: false,
    canUpload: false,
    structuralChecks: ["mount_path", "path_access_mode"],
  },
  s3: {
    type: "customer",
    supportsPreview: false,
    canUpload: true,
    structuralChecks: ["auth_mode", "root_folder"],
  },
  azure_blob: {
    type: "customer",
    supportsPreview: false,
    canUpload: true,
    structuralChecks: ["auth_mode", "root_folder"],
  },
  other_webdav: {
    type: "customer",
    supportsPreview: false,
    canUpload: false,
    structuralChecks: ["auth_mode", "root_folder"],
  },
};

export const EVIDENCE_ACCESS_LOG_ACTIONS = ["preview", "download", "signed_url_issued", "validation_check"];

export const DEFAULT_STORAGE_CONFIG = {
  scopeLevel: "tenant",
  companyId: "",
  storageMode: "platform_managed",
  primaryBackend: "vercel_blob",
  repositoryDisplayName: "Primary evidence vault",
  isActive: true,
  isDefault: true,
  authMode: "",
  secretReference: "",
  rootFolderPath: "",
  rootFolderId: "",
  driveId: "",
  externalTenantId: "",
  mountPath: "",
  pathAccessMode: "platform_reads_and_writes",
  previewSupported: true,
  allowPlatformUpload: true,
  allowReferenceOnlyMode: false,
  downloadAccessMode: "signed_url_short_lived",
  signedUrlTtlSec: 300,
  previewMode: "platform_viewer",
  auditDownloads: true,
  allowExportFileLinks: false,
  exportLinkMode: "reference_only",
  backupProfile: "no_backup",
  backupFrequency: "daily",
  backupRetentionDays: null,
  backupVerificationMode: "none",
  offsiteRepository: "",
  folderStrategy: "tenant_company_year",
  customFolderPattern: "",
  filenameStrategy: "timestamp_original",
  enforceChecksum: true,
  duplicatePolicy: "warn_on_same_hash",
  versioningMode: "auto_version_on_replace",
  repositoryHealthStatus: "warning",
  lastValidationAt: null,
  lastErrorMessage: "",
  migrationMode: "new_uploads_only",
  legacyAccessFallback: true,
  migrationBatchSize: 100,
  migrationStatus: "not_started",
  migrationNotes: "",
  backupNotes: "",
  adminNotes: "",
};

export const ENTERPRISE_STORAGE_HINT = {
  storageMode: "customer_managed",
  primaryBackend: "onedrive",
  exportLinkMode: "reference_only",
  backupProfile: "3_2_1_standard",
};

export const HEALTH_TONE = {
  healthy: "ok",
  warning: "warn",
  unreachable: "error",
  auth_expired: "warn",
  misconfigured: "error",
};

export const normalizeStorageConfigInput = (input = {}) => ({
  scopeLevel: toCleanString(input.scopeLevel || input.scope_level) || DEFAULT_STORAGE_CONFIG.scopeLevel,
  companyId: toCleanString(input.companyId || input.company_id),
  storageMode: toCleanString(input.storageMode || input.storage_mode) || DEFAULT_STORAGE_CONFIG.storageMode,
  primaryBackend: toCleanString(input.primaryBackend || input.primary_backend),
  repositoryDisplayName:
    toCleanString(input.repositoryDisplayName || input.repository_display_name) || DEFAULT_STORAGE_CONFIG.repositoryDisplayName,
  isActive: toBoolean(input.isActive ?? input.is_active, DEFAULT_STORAGE_CONFIG.isActive),
  isDefault: toBoolean(input.isDefault ?? input.is_default, DEFAULT_STORAGE_CONFIG.isDefault),
  authMode: toCleanString(input.authMode || input.auth_mode),
  secretReference: toCleanString(input.secretReference || input.secret_reference),
  rootFolderPath: toCleanString(input.rootFolderPath || input.root_folder_path),
  rootFolderId: toCleanString(input.rootFolderId || input.root_folder_id),
  driveId: toCleanString(input.driveId || input.drive_id),
  externalTenantId: toCleanString(input.externalTenantId || input.external_tenant_id),
  mountPath: toCleanString(input.mountPath || input.mount_path),
  pathAccessMode: toCleanString(input.pathAccessMode || input.path_access_mode) || DEFAULT_STORAGE_CONFIG.pathAccessMode,
  previewSupported: toBoolean(input.previewSupported ?? input.preview_supported, DEFAULT_STORAGE_CONFIG.previewSupported),
  allowPlatformUpload: toBoolean(
    input.allowPlatformUpload ?? input.allow_platform_upload,
    DEFAULT_STORAGE_CONFIG.allowPlatformUpload,
  ),
  allowReferenceOnlyMode: toBoolean(
    input.allowReferenceOnlyMode ?? input.allow_reference_only_mode,
    DEFAULT_STORAGE_CONFIG.allowReferenceOnlyMode,
  ),
  downloadAccessMode:
    toCleanString(input.downloadAccessMode || input.download_access_mode) || DEFAULT_STORAGE_CONFIG.downloadAccessMode,
  signedUrlTtlSec: toInteger(input.signedUrlTtlSec ?? input.signed_url_ttl_sec, DEFAULT_STORAGE_CONFIG.signedUrlTtlSec),
  previewMode: toCleanString(input.previewMode || input.preview_mode) || DEFAULT_STORAGE_CONFIG.previewMode,
  auditDownloads: toBoolean(input.auditDownloads ?? input.audit_downloads, DEFAULT_STORAGE_CONFIG.auditDownloads),
  allowExportFileLinks: toBoolean(
    input.allowExportFileLinks ?? input.allow_export_file_links,
    DEFAULT_STORAGE_CONFIG.allowExportFileLinks,
  ),
  exportLinkMode: toCleanString(input.exportLinkMode || input.export_link_mode) || DEFAULT_STORAGE_CONFIG.exportLinkMode,
  backupProfile: toCleanString(input.backupProfile || input.backup_profile) || DEFAULT_STORAGE_CONFIG.backupProfile,
  backupFrequency: toCleanString(input.backupFrequency || input.backup_frequency) || DEFAULT_STORAGE_CONFIG.backupFrequency,
  backupRetentionDays: toInteger(input.backupRetentionDays ?? input.backup_retention_days, null),
  backupVerificationMode:
    toCleanString(input.backupVerificationMode || input.backup_verification_mode) || DEFAULT_STORAGE_CONFIG.backupVerificationMode,
  offsiteRepository: toCleanString(input.offsiteRepository || input.offsite_repository),
  folderStrategy: toCleanString(input.folderStrategy || input.folder_strategy) || DEFAULT_STORAGE_CONFIG.folderStrategy,
  customFolderPattern: toCleanString(input.customFolderPattern || input.custom_folder_pattern),
  filenameStrategy: toCleanString(input.filenameStrategy || input.filename_strategy) || DEFAULT_STORAGE_CONFIG.filenameStrategy,
  enforceChecksum: toBoolean(input.enforceChecksum ?? input.enforce_checksum, DEFAULT_STORAGE_CONFIG.enforceChecksum),
  duplicatePolicy: toCleanString(input.duplicatePolicy || input.duplicate_policy) || DEFAULT_STORAGE_CONFIG.duplicatePolicy,
  versioningMode: toCleanString(input.versioningMode || input.versioning_mode) || DEFAULT_STORAGE_CONFIG.versioningMode,
  repositoryHealthStatus:
    toCleanString(input.repositoryHealthStatus || input.repository_health_status) || DEFAULT_STORAGE_CONFIG.repositoryHealthStatus,
  lastValidationAt: input.lastValidationAt || input.last_validation_at || null,
  lastErrorMessage: toCleanString(input.lastErrorMessage || input.last_error_message),
  migrationMode: toCleanString(input.migrationMode || input.migration_mode) || DEFAULT_STORAGE_CONFIG.migrationMode,
  legacyAccessFallback: toBoolean(
    input.legacyAccessFallback ?? input.legacy_access_fallback,
    DEFAULT_STORAGE_CONFIG.legacyAccessFallback,
  ),
  migrationBatchSize: toInteger(input.migrationBatchSize ?? input.migration_batch_size, DEFAULT_STORAGE_CONFIG.migrationBatchSize),
  migrationStatus: toCleanString(input.migrationStatus || input.migration_status) || DEFAULT_STORAGE_CONFIG.migrationStatus,
  migrationNotes: toCleanString(input.migrationNotes || input.migration_notes),
  backupNotes: toCleanString(input.backupNotes || input.backup_notes),
  adminNotes: toCleanString(input.adminNotes || input.admin_notes),
});

export const getStorageBackendMeta = (backend) => STORAGE_ADAPTERS[backend] || null;

export const requiresStorageSecretReference = (input = {}) => {
  const config = normalizeStorageConfigInput({
    ...DEFAULT_STORAGE_CONFIG,
    ...input,
  });
  const adapter = getStorageBackendMeta(config.primaryBackend);
  return adapter?.type === "customer" && config.primaryBackend !== "vercel_blob";
};

export const validateStorageConfig = (input = {}) => {
  const config = normalizeStorageConfigInput({
    ...DEFAULT_STORAGE_CONFIG,
    ...input,
  });
  const errors = {};
  const adapter = getStorageBackendMeta(config.primaryBackend);

  if (!config.primaryBackend) {
    errors.primaryBackend = "Select a primary evidence repository.";
  }

  if (!config.repositoryDisplayName) {
    errors.repositoryDisplayName = "Repository name is required.";
  }

  if (!["tenant", "company"].includes(config.scopeLevel)) {
    errors.scopeLevel = "Select where this configuration applies.";
  }

  if (config.scopeLevel === "company" && !config.companyId) {
    errors.companyId = "Company override target is required.";
  }

  if (
    config.storageMode === "platform_managed" &&
    config.primaryBackend &&
    config.primaryBackend !== "vercel_blob"
  ) {
    errors.storageMode = "Platform-managed mode currently supports only Vercel Blob.";
  }

  if (
    config.storageMode === "customer_managed" &&
    config.primaryBackend &&
    config.primaryBackend === "vercel_blob"
  ) {
    errors.storageMode = "Customer-managed mode requires a customer-controlled backend.";
  }

  if (["onedrive", "sharepoint"].includes(config.primaryBackend)) {
    if (!config.authMode) {
      errors.authMode = "Authentication mode is required.";
    }
    if (!config.externalTenantId) {
      errors.externalTenantId = "Microsoft tenant ID is required.";
    }
    if (!config.driveId) {
      errors.driveId = "Drive ID is required.";
    }
    if (!config.rootFolderId && !config.rootFolderPath) {
      errors.rootFolderPath = "Root folder path or root folder ID is required.";
    }
  }

  if (config.primaryBackend === "dropbox") {
    if (!config.authMode) {
      errors.authMode = "Authentication mode is required.";
    }
    if (!config.rootFolderId && !config.rootFolderPath) {
      errors.rootFolderPath = "Dropbox root folder path or root folder ID is required.";
    }
  }

  if (config.primaryBackend === "google_drive") {
    if (!config.authMode) {
      errors.authMode = "Authentication mode is required.";
    }
    if (!config.rootFolderId && !config.rootFolderPath) {
      errors.rootFolderPath = "Google Drive root folder ID or path is required.";
    }
  }

  if (adapter?.type === "path") {
    if (!config.mountPath) {
      errors.mountPath = "Mounted path is required.";
    }
    if (!config.pathAccessMode) {
      errors.pathAccessMode = "Path access mode is required.";
    }
  }

  if (requiresStorageSecretReference(config) && !config.secretReference) {
    errors.secretReference = "A secret reference is required. The real secret is resolved from a local secure file, not stored in the DB.";
  }

  if (config.downloadAccessMode === "signed_url_short_lived") {
    if (!Number.isFinite(config.signedUrlTtlSec) || config.signedUrlTtlSec < 30 || config.signedUrlTtlSec > 3600) {
      errors.signedUrlTtlSec = "Temporary link expiry must be between 30 and 3600 seconds.";
    }
  }

  if (
    config.backupRetentionDays != null &&
    (!Number.isFinite(config.backupRetentionDays) || config.backupRetentionDays < 1 || config.backupRetentionDays > 3650)
  ) {
    errors.backupRetentionDays = "Backup retention must be between 1 and 3650 days.";
  }

  if (config.folderStrategy === "custom" && !config.customFolderPattern) {
    errors.customFolderPattern = "Provide a custom folder pattern.";
  }

  if (config.backupProfile === "3_2_1_standard" && !config.offsiteRepository) {
    errors.offsiteRepository = "An offsite backup target is required for the 3-2-1 profile.";
  }

  if (
    config.migrationBatchSize != null &&
    (!Number.isFinite(config.migrationBatchSize) || config.migrationBatchSize < 1 || config.migrationBatchSize > 5000)
  ) {
    errors.migrationBatchSize = "Migration batch size must be between 1 and 5000.";
  }

  return {
    config,
    adapter,
    errors,
    valid: Object.keys(errors).length === 0,
  };
};

export const buildStorageSummary = (config, extras = {}) => {
  const safeConfig = config ? normalizeStorageConfigInput(config) : normalizeStorageConfigInput(DEFAULT_STORAGE_CONFIG);
  return {
    primaryStorage: safeConfig.repositoryDisplayName || "Not configured",
    scope: safeConfig.scopeLevel === "company" ? "Company override" : "Tenant default",
    defaultBackend: safeConfig.primaryBackend || "Not configured",
    accessMode: safeConfig.downloadAccessMode || "Not configured",
    backupProfile: safeConfig.backupProfile || "Not configured",
    repositoryHealth: safeConfig.repositoryHealthStatus || "warning",
    lastConnectionCheck: safeConfig.lastValidationAt || null,
    evidenceRecordsUsingBackend:
      Number.isFinite(Number(extras.evidenceRecordsUsingBackend)) ? Number(extras.evidenceRecordsUsingBackend) : null,
    migrationMode: safeConfig.migrationMode || "none",
    migrationStatus: safeConfig.migrationStatus || "not_started",
    notes: [
      safeConfig.backupNotes ? `Backup: ${safeConfig.backupNotes}` : null,
      safeConfig.migrationNotes ? `Migration: ${safeConfig.migrationNotes}` : null,
      safeConfig.adminNotes ? `Admin: ${safeConfig.adminNotes}` : null,
    ].filter(Boolean),
  };
};

export const formatStorageOptionLabel = (options, value) => options.find((item) => item.value === value)?.label || value || "-";

export const toStorageConfigRecord = (config) => ({
  scopeLevel: config.scopeLevel,
  companyId: config.companyId || null,
  storageMode: config.storageMode,
  primaryBackend: config.primaryBackend,
  repositoryDisplayName: config.repositoryDisplayName,
  isActive: config.isActive,
  isDefault: config.isDefault,
  authMode: toNullableString(config.authMode),
  secretReference: toNullableString(config.secretReference),
  rootFolderPath: toNullableString(config.rootFolderPath),
  rootFolderId: toNullableString(config.rootFolderId),
  driveId: toNullableString(config.driveId),
  externalTenantId: toNullableString(config.externalTenantId),
  mountPath: toNullableString(config.mountPath),
  pathAccessMode: toNullableString(config.pathAccessMode),
  previewSupported: config.previewSupported,
  allowPlatformUpload: config.allowPlatformUpload,
  allowReferenceOnlyMode: config.allowReferenceOnlyMode,
  downloadAccessMode: config.downloadAccessMode,
  signedUrlTtlSec: config.signedUrlTtlSec,
  previewMode: config.previewMode,
  auditDownloads: config.auditDownloads,
  allowExportFileLinks: config.allowExportFileLinks,
  exportLinkMode: config.exportLinkMode,
  backupProfile: config.backupProfile,
  backupFrequency: config.backupFrequency,
  backupRetentionDays: config.backupRetentionDays,
  backupVerificationMode: config.backupVerificationMode,
  offsiteRepository: toNullableString(config.offsiteRepository),
  folderStrategy: config.folderStrategy,
  customFolderPattern: toNullableString(config.customFolderPattern),
  filenameStrategy: config.filenameStrategy,
  enforceChecksum: config.enforceChecksum,
  duplicatePolicy: config.duplicatePolicy,
  versioningMode: config.versioningMode,
  repositoryHealthStatus: config.repositoryHealthStatus,
  lastValidationAt: config.lastValidationAt || null,
  lastErrorMessage: toNullableString(config.lastErrorMessage),
  migrationMode: config.migrationMode,
  legacyAccessFallback: config.legacyAccessFallback,
  migrationBatchSize: config.migrationBatchSize,
  migrationStatus: config.migrationStatus,
  migrationNotes: toNullableString(config.migrationNotes),
  backupNotes: toNullableString(config.backupNotes),
  adminNotes: toNullableString(config.adminNotes),
});
