import { randomUUID } from "node:crypto";
import {
  DEFAULT_STORAGE_CONFIG,
  EVIDENCE_ACCESS_LOG_ACTIONS,
  HEALTH_TONE,
  STORAGE_ADAPTERS,
  buildStorageSummary,
  normalizeStorageConfigInput,
  requiresStorageSecretReference,
  toStorageConfigRecord,
  validateStorageConfig,
} from "../../../_lib/storage-config.js";
import { ROLES } from "./rbac.js";
import { getStorageSecretSummary, resolveStorageSecret } from "./storage-secrets.js";
import { getStorageAdapter } from "./storage-adapters.js";
import { ensureEnterpriseSchema, ensureStorageSchema } from "./db.js";

const toIso = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const countValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id || null,
    scopeLevel: row.scope_level,
    storageMode: row.storage_mode,
    primaryBackend: row.primary_backend,
    repositoryDisplayName: row.repository_display_name,
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    authMode: row.auth_mode || "",
    secretReference: row.secret_reference || "",
    rootFolderPath: row.root_folder_path || "",
    rootFolderId: row.root_folder_id || "",
    driveId: row.drive_id || "",
    externalTenantId: row.external_tenant_id || "",
    mountPath: row.mount_path || "",
    pathAccessMode: row.path_access_mode || "",
    previewSupported: Boolean(row.preview_supported),
    allowPlatformUpload: Boolean(row.allow_platform_upload),
    allowReferenceOnlyMode: Boolean(row.allow_reference_only_mode),
    downloadAccessMode: row.download_access_mode,
    signedUrlTtlSec: row.signed_url_ttl_sec == null ? null : Number(row.signed_url_ttl_sec),
    previewMode: row.preview_mode,
    auditDownloads: Boolean(row.audit_downloads),
    allowExportFileLinks: Boolean(row.allow_export_file_links),
    exportLinkMode: row.export_link_mode,
    backupProfile: row.backup_profile,
    backupFrequency: row.backup_frequency,
    backupRetentionDays: row.backup_retention_days == null ? null : Number(row.backup_retention_days),
    backupVerificationMode: row.backup_verification_mode,
    offsiteRepository: row.offsite_repository || "",
    folderStrategy: row.folder_strategy,
    customFolderPattern: row.custom_folder_pattern || "",
    filenameStrategy: row.filename_strategy,
    enforceChecksum: Boolean(row.enforce_checksum),
    duplicatePolicy: row.duplicate_policy,
    versioningMode: row.versioning_mode,
    repositoryHealthStatus: row.repository_health_status,
    lastValidationAt: toIso(row.last_validation_at),
    lastErrorMessage: row.last_error_message || "",
    migrationMode: row.migration_mode,
    legacyAccessFallback: Boolean(row.legacy_access_fallback),
    migrationBatchSize: row.migration_batch_size == null ? null : Number(row.migration_batch_size),
    migrationStatus: row.migration_status,
    migrationNotes: row.migration_notes || "",
    backupNotes: row.backup_notes || "",
    adminNotes: row.admin_notes || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
};

export const getStorageAccessProfile = (context) => {
  if (context?.isSuperadmin) {
    return { canView: true, canEdit: !context.impersonationReadOnly, summaryOnly: false };
  }
  const role = context?.membership?.role;
  if (role === ROLES.TENANT_ADMIN) {
    return { canView: true, canEdit: true, summaryOnly: false };
  }
  if (role === ROLES.MANAGER) {
    return { canView: true, canEdit: false, summaryOnly: false };
  }
  if (role === ROLES.AUDITOR) {
    return { canView: true, canEdit: false, summaryOnly: true };
  }
  return { canView: false, canEdit: false, summaryOnly: false };
};

export const ensureTenantStorageConfigTables = async () => {
  await ensureEnterpriseSchema();
  await ensureStorageSchema();
};

export const getStorageConfigByScope = async (sql, tenantId, { scopeLevel = "tenant", companyId = null } = {}) => {
  await ensureTenantStorageConfigTables();
  const rows = await sql`
    SELECT *
    FROM tenant_storage_config
    WHERE tenant_id = ${tenantId}
      AND scope_level = ${scopeLevel}
      AND (
        (${scopeLevel} = 'tenant' AND company_id IS NULL)
        OR (${scopeLevel} = 'company' AND company_id = ${companyId})
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return normalizeRow(rows?.[0] || null);
};

export const getTenantStorageConfigBundle = async (sql, tenantId) => {
  await ensureTenantStorageConfigTables();

  const [tenantRows, companyRows, usageRows] = await Promise.all([
    sql`
      SELECT *
      FROM tenant_storage_config
      WHERE tenant_id = ${tenantId}
        AND scope_level = 'tenant'
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `,
    sql`
      SELECT *
      FROM tenant_storage_config
      WHERE tenant_id = ${tenantId}
        AND scope_level = 'company'
      ORDER BY updated_at DESC
    `,
    sql`
      SELECT
        COUNT(*)::int AS total_evidence,
        COUNT(*) FILTER (WHERE blob_url IS NOT NULL AND blob_url <> '')::int AS blob_url_records,
        COUNT(*) FILTER (WHERE storage_backend = 'onedrive')::int AS onedrive_records,
        COUNT(*) FILTER (WHERE storage_backend = 'dropbox')::int AS dropbox_records,
        COUNT(*) FILTER (WHERE storage_backend = 'google_drive')::int AS google_drive_records
      FROM evidence
      WHERE tenant_id = ${tenantId}
    `,
  ]);

  const config = normalizeRow(tenantRows?.[0] || null);
  const companyOverrides = companyRows.map((row) => normalizeRow(row));
  const usage = usageRows?.[0] || {};
  const usageColumnByBackend = {
    onedrive: "onedrive_records",
    dropbox: "dropbox_records",
    google_drive: "google_drive_records",
    vercel_blob: "blob_url_records",
  };
  const evidenceRecordsUsingBackend = usageColumnByBackend[config?.primaryBackend]
    ? countValue(usage[usageColumnByBackend[config.primaryBackend]])
    : null;

  return {
    config,
    companyOverrides,
    summary: buildStorageSummary(config || DEFAULT_STORAGE_CONFIG, {
      evidenceRecordsUsingBackend,
    }),
  };
};

export const assertCompanyScope = async (sql, tenantId, scopeLevel, companyId) => {
  if (scopeLevel !== "company") {
    return null;
  }
  if (!companyId) {
    return null;
  }
  const rows = await sql`
    SELECT id, name
    FROM companies
    WHERE tenant_id = ${tenantId}
      AND id = ${companyId}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export const saveTenantStorageConfig = async (sql, tenantId, payload = {}, options = {}) => {
  await ensureTenantStorageConfigTables();

  const normalized = normalizeStorageConfigInput({
    ...DEFAULT_STORAGE_CONFIG,
    ...payload,
  });
  const validation = validateStorageConfig(normalized);
  if (!validation.valid) {
    return {
      ok: false,
      code: "validation_failed",
      message: "Storage configuration validation failed.",
      validation: validation.errors,
    };
  }

  if (validation.config.scopeLevel === "company") {
    const company = await assertCompanyScope(sql, tenantId, validation.config.scopeLevel, validation.config.companyId);
    if (!company) {
      return {
        ok: false,
        code: "invalid_company",
        message: "Selected company override target is invalid for this tenant.",
        validation: {
          companyId: "Select a valid company for the override.",
        },
      };
    }
  }

  const record = toStorageConfigRecord(validation.config);
  const nowHealth = validation.config.isActive
    ? validation.config.repositoryHealthStatus || "warning"
    : "warning";
  const previous = await getStorageConfigByScope(sql, tenantId, {
    scopeLevel: record.scopeLevel,
    companyId: record.companyId,
  });
  const nextId = previous?.id || randomUUID();
  const activateRecord = typeof options.activate === "boolean" ? options.activate : record.isActive;
  const setDefault = typeof options.activate === "boolean" ? options.activate : record.isDefault;

  const rows = await sql`
    INSERT INTO tenant_storage_config (
      id,
      tenant_id,
      company_id,
      scope_level,
      storage_mode,
      primary_backend,
      repository_display_name,
      is_active,
      is_default,
      auth_mode,
      secret_reference,
      root_folder_path,
      root_folder_id,
      drive_id,
      external_tenant_id,
      mount_path,
      path_access_mode,
      preview_supported,
      allow_platform_upload,
      allow_reference_only_mode,
      download_access_mode,
      signed_url_ttl_sec,
      preview_mode,
      audit_downloads,
      allow_export_file_links,
      export_link_mode,
      backup_profile,
      backup_frequency,
      backup_retention_days,
      backup_verification_mode,
      offsite_repository,
      folder_strategy,
      custom_folder_pattern,
      filename_strategy,
      enforce_checksum,
      duplicate_policy,
      versioning_mode,
      repository_health_status,
      last_validation_at,
      last_error_message,
      migration_mode,
      legacy_access_fallback,
      migration_batch_size,
      migration_status,
      migration_notes,
      backup_notes,
      admin_notes,
      created_at,
      updated_at
    )
    VALUES (
      ${nextId},
      ${tenantId},
      ${record.companyId},
      ${record.scopeLevel},
      ${record.storageMode},
      ${record.primaryBackend},
      ${record.repositoryDisplayName},
      ${activateRecord},
      ${setDefault},
      ${record.authMode},
      ${record.secretReference},
      ${record.rootFolderPath},
      ${record.rootFolderId},
      ${record.driveId},
      ${record.externalTenantId},
      ${record.mountPath},
      ${record.pathAccessMode},
      ${record.previewSupported},
      ${record.allowPlatformUpload},
      ${record.allowReferenceOnlyMode},
      ${record.downloadAccessMode},
      ${record.signedUrlTtlSec},
      ${record.previewMode},
      ${record.auditDownloads},
      ${record.allowExportFileLinks},
      ${record.exportLinkMode},
      ${record.backupProfile},
      ${record.backupFrequency},
      ${record.backupRetentionDays},
      ${record.backupVerificationMode},
      ${record.offsiteRepository},
      ${record.folderStrategy},
      ${record.customFolderPattern},
      ${record.filenameStrategy},
      ${record.enforceChecksum},
      ${record.duplicatePolicy},
      ${record.versioningMode},
      ${nowHealth},
      ${record.lastValidationAt},
      ${record.lastErrorMessage},
      ${record.migrationMode},
      ${record.legacyAccessFallback},
      ${record.migrationBatchSize},
      ${record.migrationStatus},
      ${record.migrationNotes},
      ${record.backupNotes},
      ${record.adminNotes},
      COALESCE((SELECT created_at FROM tenant_storage_config WHERE id = ${nextId}), NOW()),
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      company_id = EXCLUDED.company_id,
      scope_level = EXCLUDED.scope_level,
      storage_mode = EXCLUDED.storage_mode,
      primary_backend = EXCLUDED.primary_backend,
      repository_display_name = EXCLUDED.repository_display_name,
      is_active = EXCLUDED.is_active,
      is_default = EXCLUDED.is_default,
      auth_mode = EXCLUDED.auth_mode,
      secret_reference = EXCLUDED.secret_reference,
      root_folder_path = EXCLUDED.root_folder_path,
      root_folder_id = EXCLUDED.root_folder_id,
      drive_id = EXCLUDED.drive_id,
      external_tenant_id = EXCLUDED.external_tenant_id,
      mount_path = EXCLUDED.mount_path,
      path_access_mode = EXCLUDED.path_access_mode,
      preview_supported = EXCLUDED.preview_supported,
      allow_platform_upload = EXCLUDED.allow_platform_upload,
      allow_reference_only_mode = EXCLUDED.allow_reference_only_mode,
      download_access_mode = EXCLUDED.download_access_mode,
      signed_url_ttl_sec = EXCLUDED.signed_url_ttl_sec,
      preview_mode = EXCLUDED.preview_mode,
      audit_downloads = EXCLUDED.audit_downloads,
      allow_export_file_links = EXCLUDED.allow_export_file_links,
      export_link_mode = EXCLUDED.export_link_mode,
      backup_profile = EXCLUDED.backup_profile,
      backup_frequency = EXCLUDED.backup_frequency,
      backup_retention_days = EXCLUDED.backup_retention_days,
      backup_verification_mode = EXCLUDED.backup_verification_mode,
      offsite_repository = EXCLUDED.offsite_repository,
      folder_strategy = EXCLUDED.folder_strategy,
      custom_folder_pattern = EXCLUDED.custom_folder_pattern,
      filename_strategy = EXCLUDED.filename_strategy,
      enforce_checksum = EXCLUDED.enforce_checksum,
      duplicate_policy = EXCLUDED.duplicate_policy,
      versioning_mode = EXCLUDED.versioning_mode,
      repository_health_status = EXCLUDED.repository_health_status,
      last_validation_at = EXCLUDED.last_validation_at,
      last_error_message = EXCLUDED.last_error_message,
      migration_mode = EXCLUDED.migration_mode,
      legacy_access_fallback = EXCLUDED.legacy_access_fallback,
      migration_batch_size = EXCLUDED.migration_batch_size,
      migration_status = EXCLUDED.migration_status,
      migration_notes = EXCLUDED.migration_notes,
      backup_notes = EXCLUDED.backup_notes,
      admin_notes = EXCLUDED.admin_notes,
      updated_at = NOW()
    RETURNING *
  `;

  const config = normalizeRow(rows?.[0] || null);
  const usageRows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE blob_url IS NOT NULL AND blob_url <> '')::int AS blob_url_records,
      COUNT(*) FILTER (WHERE storage_backend = 'onedrive')::int AS onedrive_records,
      COUNT(*) FILTER (WHERE storage_backend = 'dropbox')::int AS dropbox_records,
      COUNT(*) FILTER (WHERE storage_backend = 'google_drive')::int AS google_drive_records
    FROM evidence
    WHERE tenant_id = ${tenantId}
  `;

  return {
    ok: true,
    config,
    summary: buildStorageSummary(config, {
      evidenceRecordsUsingBackend: (() => {
        const usage = usageRows?.[0] || {};
        const usageColumnByBackend = {
          onedrive: "onedrive_records",
          dropbox: "dropbox_records",
          google_drive: "google_drive_records",
          vercel_blob: "blob_url_records",
        };
        const usageColumn = usageColumnByBackend[config?.primaryBackend];
        return usageColumn ? countValue(usage[usageColumn]) : null;
      })(),
    }),
  };
};

const buildCheck = (key, label, ok, message, extra = null) => ({
  key,
  label,
  status: ok ? "ok" : "failed",
  message,
  ...(extra && typeof extra === "object" ? { extra } : {}),
});

const summarizeHealthChecks = (checks, fallbackHealth = "warning", successMessage = "Validation passed.") => {
  const failed = checks.filter((item) => item.status !== "ok");
  return {
    healthStatus: failed.length === 0 ? "healthy" : fallbackHealth,
    message: failed.length === 0 ? successMessage : "Validation found missing or inconsistent fields.",
  };
};

export const runStorageConfigTest = async (input = {}, { mode = "connection" } = {}) => {
  const validation = validateStorageConfig(input);
  const config = validation.config;
  const adapter = STORAGE_ADAPTERS[config.primaryBackend] || null;
  const checks = [];

  checks.push(buildCheck("backend", "Backend selected", Boolean(config.primaryBackend), config.primaryBackend || "Missing backend"));
  checks.push(
    buildCheck(
      "repository_name",
      "Repository name",
      Boolean(config.repositoryDisplayName),
      config.repositoryDisplayName || "Missing repository display name",
    ),
  );

  if (config.primaryBackend === "vercel_blob") {
    checks.push(
      buildCheck(
        "platform_managed",
        "Platform-managed baseline",
        config.storageMode === "platform_managed" || config.storageMode === "hybrid",
        "Vercel Blob should stay platform-managed or hybrid in this phase.",
      ),
    );
  }

  if (["onedrive", "sharepoint"].includes(config.primaryBackend)) {
    checks.push(buildCheck("auth_mode", "Authentication mode", Boolean(config.authMode), config.authMode || "Missing auth mode"));
    checks.push(
      buildCheck(
        "external_tenant_id",
        "External tenant ID",
        Boolean(config.externalTenantId),
        config.externalTenantId || "Missing Microsoft tenant ID",
      ),
    );
    checks.push(buildCheck("drive_id", "Drive ID", Boolean(config.driveId), config.driveId || "Missing drive ID"));
    checks.push(
      buildCheck(
        "root_folder",
        "Root folder",
        Boolean(config.rootFolderId || config.rootFolderPath),
        config.rootFolderId || config.rootFolderPath || "Missing root folder path or ID",
      ),
    );
  }

  if (config.primaryBackend === "dropbox") {
    checks.push(buildCheck("auth_mode", "Authentication mode", Boolean(config.authMode), config.authMode || "Missing auth mode"));
    checks.push(
      buildCheck(
        "root_folder",
        "Root folder",
        Boolean(config.rootFolderId || config.rootFolderPath),
        config.rootFolderId || config.rootFolderPath || "Missing Dropbox root folder path or ID",
      ),
    );
  }

  if (config.primaryBackend === "google_drive") {
    checks.push(buildCheck("auth_mode", "Authentication mode", Boolean(config.authMode), config.authMode || "Missing auth mode"));
    checks.push(
      buildCheck(
        "root_folder",
        "Root folder",
        Boolean(config.rootFolderId || config.rootFolderPath),
        config.rootFolderId || config.rootFolderPath || "Missing Google Drive root folder path or ID",
      ),
    );
  }

  if (adapter?.type === "path") {
    checks.push(buildCheck("mount_path", "Mounted path", Boolean(config.mountPath), config.mountPath || "Missing mounted path"));
    checks.push(
      buildCheck(
        "path_access_mode",
        "Path access mode",
        Boolean(config.pathAccessMode),
        config.pathAccessMode || "Missing path access mode",
      ),
    );
  }

  if (requiresStorageSecretReference(config)) {
    if (!config.secretReference) {
      checks.push(
        buildCheck(
          "secret_reference",
          "Secret reference",
          false,
          "Secret reference missing. The DB stores only the logical reference, not the real provider secret.",
          { code: "storage_secret_reference_missing" },
        ),
      );
    } else {
      try {
        const payload = await resolveStorageSecret(config.secretReference);
        const summary = await getStorageSecretSummary(config.secretReference);
        checks.push(
          buildCheck(
            "secret_reference",
            "Secret reference",
            true,
            `Secret reference resolved from local secure file (${summary.fieldCount} fields).`,
            {
              code: "storage_secret_reference_resolved",
              keys: summary.keys,
              fieldCount: summary.fieldCount,
            },
          ),
        );
        if (!payload || typeof payload !== "object") {
          checks.push(
            buildCheck(
              "secret_payload",
              "Secret payload",
              false,
              "Resolved secret payload is malformed.",
              { code: "storage_secret_payload_malformed" },
            ),
          );
        }
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "storage_secret_resolution_failed";
        checks.push(
          buildCheck(
            "secret_reference",
            "Secret reference",
            false,
            error instanceof Error ? error.message : "Secret resolution failed.",
            { code },
          ),
        );
      }
    }
  }

  if (mode === "preview") {
    checks.push(
      buildCheck(
        "preview",
        "Preview support",
        config.previewSupported && config.previewMode !== "download_only",
        config.previewSupported ? "Preview capability is structurally enabled." : "Preview is disabled for this repository.",
      ),
    );
  }

  if (mode === "upload") {
    checks.push(
      buildCheck(
        "upload",
        "Platform upload",
        config.allowPlatformUpload,
        config.allowPlatformUpload ? "Platform upload is allowed." : "Platform upload is disabled.",
      ),
    );
  }

  if (["onedrive", "dropbox", "google_drive"].includes(config.primaryBackend)) {
    const providerAdapter = getStorageAdapter(config);
    const liveResult = await providerAdapter.healthCheck(config, { mode });
    return {
      ok: true,
      healthStatus: liveResult.healthStatus || "warning",
      checks: [...checks, ...(Array.isArray(liveResult.checks) ? liveResult.checks : [])],
      message: liveResult.message || "External storage validation completed.",
      healthTone: HEALTH_TONE[liveResult.healthStatus] || "warn",
    };
  }

  const { healthStatus, message } = summarizeHealthChecks(
    checks,
    config.primaryBackend ? "warning" : "misconfigured",
    "Structural validation passed. External providers were not contacted.",
  );

  return {
    ok: true,
    healthStatus,
    checks,
    message,
    healthTone: HEALTH_TONE[healthStatus] || "warn",
  };
};

export const buildEvidenceAccessLogExtension = (payload = {}) => ({
  tenantId: payload.tenantId || null,
  evidenceId: payload.evidenceId || null,
  userId: payload.userId || null,
  action: EVIDENCE_ACCESS_LOG_ACTIONS.includes(payload.action) ? payload.action : "validation_check",
  accessMode: payload.accessMode || "metadata_only",
  requestId: payload.requestId || null,
});

export const generateStorageMigrationPlan = async (sql, tenantId, activeConfig = null) => {
  await ensureTenantStorageConfigTables();
  const [summaryRows, ecoTableRows] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS total_evidence,
        COUNT(*) FILTER (WHERE blob_url IS NOT NULL AND blob_url <> '')::int AS with_blob_url,
        COUNT(*) FILTER (WHERE blob_url IS NULL OR blob_url = '')::int AS missing_blob_url
      FROM evidence
      WHERE tenant_id = ${tenantId}
    `,
    sql`SELECT to_regclass('public.ecovadis_answer_evidence')::text AS table_name`,
  ]);

  const hasEcoTable = Boolean(ecoTableRows?.[0]?.table_name);
  const linkedRows = hasEcoTable
    ? await sql`
        SELECT COUNT(DISTINCT evidence_id)::int AS linked_count
        FROM (
          SELECT evidence_id FROM entity_evidence WHERE tenant_id = ${tenantId}
          UNION ALL
          SELECT evidence_id FROM activities WHERE tenant_id = ${tenantId} AND evidence_id IS NOT NULL
          UNION ALL
          SELECT evidence_id FROM ecovadis_answer_evidence WHERE tenant_id = ${tenantId}
        ) linked
      `
    : await sql`
        SELECT COUNT(DISTINCT evidence_id)::int AS linked_count
        FROM (
          SELECT evidence_id FROM entity_evidence WHERE tenant_id = ${tenantId}
          UNION ALL
          SELECT evidence_id FROM activities WHERE tenant_id = ${tenantId} AND evidence_id IS NOT NULL
        ) linked
      `;

  const totalEvidence = countValue(summaryRows?.[0]?.total_evidence);
  const withBlobUrl = countValue(summaryRows?.[0]?.with_blob_url);
  const missingBlobUrl = countValue(summaryRows?.[0]?.missing_blob_url);
  const linkedToEntities = countValue(linkedRows?.[0]?.linked_count);
  const eligibleForSecureMode = withBlobUrl;

  return {
    totalEvidence,
    recordsWithBlobUrl: withBlobUrl,
    recordsMissingBlobUrl: missingBlobUrl,
    recordsLinkedToEntities: linkedToEntities,
    recordsEligibleForSecureMode: eligibleForSecureMode,
    recommendedModes: {
      newUploadsOnly: totalEvidence,
      progressiveMigration: withBlobUrl,
      fullCutover: missingBlobUrl === 0 ? withBlobUrl : 0,
    },
    currentMode: activeConfig?.migrationMode || "new_uploads_only",
    notes: [
      "Counts are structural only. No file migration is executed in this phase.",
      "Legacy blob_url compatibility remains enabled.",
      missingBlobUrl > 0
        ? "Full cutover is blocked until legacy records without blob_url are remediated."
        : "Full cutover is structurally possible once storage adapters are implemented.",
    ],
  };
};
