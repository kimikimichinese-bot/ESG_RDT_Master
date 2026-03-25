"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StorageSummaryCard from "../../_components/storage-summary-card";
import { useCompanyScope } from "../../_components/use-company-scope";
import { useTenantSession } from "../../_components/use-tenant-session";
import {
  AUTH_MODE_OPTIONS,
  BACKUP_FREQUENCY_OPTIONS,
  BACKUP_PROFILE_OPTIONS,
  BACKUP_VERIFICATION_OPTIONS,
  DEFAULT_STORAGE_CONFIG,
  DOWNLOAD_ACCESS_MODE_OPTIONS,
  DUPLICATE_POLICY_OPTIONS,
  ENTERPRISE_STORAGE_HINT,
  FILENAME_STRATEGY_OPTIONS,
  FOLDER_STRATEGY_OPTIONS,
  MIGRATION_MODE_OPTIONS,
  MIGRATION_STATUS_OPTIONS,
  PREVIEW_MODE_OPTIONS,
  STORAGE_BACKEND_OPTIONS,
  STORAGE_MODE_OPTIONS,
  STORAGE_SCOPE_OPTIONS,
  validateStorageConfig,
  VERSIONING_MODE_OPTIONS,
} from "../../../_lib/storage-config";

const toApiError = (payload, status) => {
  const code = typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : `http_${status || 500}`;
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${status || 500}`;
  return `${message} [${code}]`;
};

const readJson = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(toApiError(payload, response.status));
  }
  return payload;
};

const healthBadgeClass = (status) => {
  if (status === "healthy") {
    return "storage-badge storage-badge-ok";
  }
  if (status === "unreachable" || status === "misconfigured") {
    return "storage-badge storage-badge-error";
  }
  return "storage-badge storage-badge-warn";
};

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

function Field({ id, label, help, error, children, full = false }) {
  return (
    <div className={full ? "storage-field-span-full" : ""}>
      <label className="enterprise-label" htmlFor={id}>
        {help ? <TooltipText text={help}>{label}</TooltipText> : label}
      </label>
      {children}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
    </div>
  );
}

function CheckboxField({ id, label, checked, onChange, disabled, help }) {
  return (
    <label className="enterprise-checkbox-row" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {help ? <TooltipText text={help}>{label}</TooltipText> : label}
    </label>
  );
}

function CheckList({ result }) {
  if (!result?.checks?.length) {
    return <p className="enterprise-muted">No structural checks run yet.</p>;
  }

  return (
    <div className="storage-checks-grid">
      {result.checks.map((check) => (
        <div key={check.key} className="enterprise-subcard">
          <div className="storage-readonly-row">
            <strong>{check.label}</strong>
            <span className={check.status === "ok" ? "enterprise-pill enterprise-pill-success" : "enterprise-pill enterprise-pill-warning"}>
              {check.status === "ok" ? "Pass" : "Attention"}
            </span>
          </div>
          <p className="enterprise-muted">{check.message}</p>
        </div>
      ))}
    </div>
  );
}

function MigrationPlanCard({ plan }) {
  if (!plan) {
    return <p className="enterprise-muted">Generate a migration plan to estimate legacy evidence impact.</p>;
  }

  return (
    <div className="storage-migration-grid">
      <div className="enterprise-subcard">
        <strong>Total evidence</strong>
        <p>{plan.totalEvidence}</p>
      </div>
      <div className="enterprise-subcard">
        <strong>Records with blob_url</strong>
        <p>{plan.recordsWithBlobUrl}</p>
      </div>
      <div className="enterprise-subcard">
        <strong>Records missing blob_url</strong>
        <p>{plan.recordsMissingBlobUrl}</p>
      </div>
      <div className="enterprise-subcard">
        <strong>Records linked to entities</strong>
        <p>{plan.recordsLinkedToEntities}</p>
      </div>
      <div className="enterprise-subcard">
        <strong>Eligible for secure mode</strong>
        <p>{plan.recordsEligibleForSecureMode}</p>
      </div>
      <div className="enterprise-subcard">
        <strong>Recommended progressive</strong>
        <p>{plan.recommendedModes?.progressiveMigration ?? 0}</p>
      </div>
      {Array.isArray(plan.notes) && plan.notes.length > 0 ? (
        <div className="storage-field-span-full enterprise-subcard">
          {plan.notes.map((note) => (
            <p key={note} className="enterprise-muted">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function StorageBackupConfigurationPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);
  const [form, setForm] = useState(DEFAULT_STORAGE_CONFIG);
  const [summary, setSummary] = useState(null);
  const [companyOverrides, setCompanyOverrides] = useState([]);
  const [access, setAccess] = useState({ canView: false, canEdit: false, summaryOnly: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [validationErrors, setValidationErrors] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [migrationPlan, setMigrationPlan] = useState(null);

  const clientValidation = useMemo(() => validateStorageConfig(form), [form]);
  const canEdit = access.canEdit && !tenant.impersonationReadOnly;
  const showCompanyTarget = form.scopeLevel === "company";
  const isPathBackend = ["nas_path", "local_path", "external_disk_path"].includes(form.primaryBackend);
  const isMicrosoftBackend = ["onedrive", "sharepoint"].includes(form.primaryBackend);
  const isDropboxBackend = form.primaryBackend === "dropbox";
  const isGoogleDriveBackend = form.primaryBackend === "google_drive";
  const isCloudDriveBackend = isMicrosoftBackend || isDropboxBackend || isGoogleDriveBackend;

  const loadConfig = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const payload = await readJson(
        await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/storage-config`, {
          cache: "no-store",
        }),
      );

      setAccess(payload.access || { canView: false, canEdit: false, summaryOnly: false });
      setCompanyOverrides(Array.isArray(payload.companyOverrides) ? payload.companyOverrides : []);
      setSummary(payload.summary || null);
      setForm({
        ...DEFAULT_STORAGE_CONFIG,
        ...(payload.config || {}),
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load storage configuration");
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadConfig();
    }
  }, [tenant.loading, tenant.tenantId, loadConfig]);

  useEffect(() => {
    if (!showCompanyTarget && form.companyId) {
      setForm((current) => ({ ...current, companyId: "" }));
    }
  }, [showCompanyTarget, form.companyId]);

  const onFieldChange = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationErrors((current) => ({ ...current, [key]: "" }));
    setMessage("");
    setError("");
  };

  const submitConfig = async (activationMode) => {
    if (!tenant.tenantId || !canEdit) {
      return;
    }

    const localValidation = validateStorageConfig(form);
    if (!localValidation.valid) {
      setValidationErrors(localValidation.errors);
      setError("Resolve validation issues before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setValidationErrors({});
    try {
      const payload = await readJson(
        await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/storage-config`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            activationMode,
          }),
        }),
      );
      setForm((current) => ({ ...current, ...(payload.config || {}) }));
      setSummary(payload.summary || null);
      setMessage(activationMode === "activate" ? "Storage configuration saved and marked active." : "Draft saved.");
      await loadConfig();
    } catch (saveError) {
      const messageText = saveError instanceof Error ? saveError.message : "Unable to save storage configuration";
      setError(messageText);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (mode) => {
    if (!tenant.tenantId || !canEdit) {
      return;
    }

    setTesting(true);
    setError("");
    setMessage("");
    try {
      const payload = await readJson(
        await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/storage-config/test`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            config: form,
          }),
        }),
      );
      setTestResult(payload);
      const firstFailedCheck = Array.isArray(payload.checks) ? payload.checks.find((item) => item.status !== "ok") : null;
      setForm((current) => ({
        ...current,
        repositoryHealthStatus: payload.healthStatus || current.repositoryHealthStatus,
        lastValidationAt: new Date().toISOString(),
        lastErrorMessage: payload.healthStatus === "healthy" ? "" : firstFailedCheck?.message || current.lastErrorMessage,
      }));
      setMessage(payload.message || "Storage validation completed.");
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Unable to run structural validation");
    } finally {
      setTesting(false);
    }
  };

  const generatePlan = async () => {
    if (!tenant.tenantId || !canEdit) {
      return;
    }
    setPlanning(true);
    setError("");
    setMessage("");
    try {
      const payload = await readJson(
        await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/storage-config/migration-plan`, {
          method: "POST",
        }),
      );
      setMigrationPlan(payload.plan || null);
      setMessage("Migration plan generated.");
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Unable to generate migration plan");
    } finally {
      setPlanning(false);
    }
  };

  if (!tenant.loading && tenant.role === "Personnel") {
    return (
      <section className="enterprise-grid">
        <h2 className="enterprise-section-title">Storage & Backup Configuration</h2>
        <p className="enterprise-status enterprise-status-error">This area is not available for the Personnel role.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="enterprise-grid">
        <h2 className="enterprise-section-title">Storage & Backup Configuration</h2>
        <p className="enterprise-status">Loading storage configuration...</p>
      </section>
    );
  }

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Storage & Backup Configuration</h2>
          <p className="enterprise-muted">
            Configure where evidence files live, how they are accessed, and how backup/recovery works.
          </p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadConfig()} disabled={loading || saving}>
            Refresh
          </button>
          <button className="enterprise-button-secondary" type="button" onClick={() => void submitConfig("draft")} disabled={!canEdit || saving}>
            {saving ? "Saving..." : "Save draft"}
          </button>
          <button
            className="enterprise-button-primary"
            type="button"
            onClick={() => void submitConfig("activate")}
            disabled={!canEdit || saving || !clientValidation.valid}
          >
            {saving ? "Saving..." : "Save & activate"}
          </button>
        </div>
      </div>

      {tenant.impersonationReadOnly ? (
        <p className="enterprise-status enterprise-status-warn">Read-only impersonation is active. Writes are blocked.</p>
      ) : null}
      {!canEdit && access.summaryOnly ? (
        <p className="enterprise-status enterprise-status-warn">Auditor access is summary-only in this area.</p>
      ) : null}
      {!canEdit && !access.summaryOnly && access.canView ? (
        <p className="enterprise-status enterprise-status-warn">This configuration is visible in read-only mode for your role.</p>
      ) : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status enterprise-status-ok">{message}</p> : null}

      <div className="storage-config-layout">
        <div className="storage-config-main">
          <section className="enterprise-card">
            <div className="storage-section-header">
              <div>
                <h3>Storage mode</h3>
                <p className="enterprise-muted">Select the storage operating model and scope.</p>
              </div>
              <span className={healthBadgeClass(form.repositoryHealthStatus)}>{form.repositoryHealthStatus}</span>
            </div>
            <div className="storage-field-grid">
              <Field
                id="storage-mode"
                label="Storage mode"
                help="Choose whether the platform or the customer controls the repository."
                error={validationErrors.storageMode}
              >
                <select
                  id="storage-mode"
                  className="enterprise-input"
                  value={form.storageMode}
                  onChange={(event) => onFieldChange("storageMode", event.target.value)}
                  disabled={!canEdit}
                >
                  {STORAGE_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="scope-level" label="Applies to" error={validationErrors.scopeLevel}>
                <select
                  id="scope-level"
                  className="enterprise-input"
                  value={form.scopeLevel}
                  onChange={(event) => onFieldChange("scopeLevel", event.target.value)}
                  disabled={!canEdit}
                >
                  {STORAGE_SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              {showCompanyTarget ? (
                <Field id="company-target" label="Company override target" error={validationErrors.companyId}>
                  <select
                    id="company-target"
                    className="enterprise-input"
                    value={form.companyId}
                    onChange={(event) => onFieldChange("companyId", event.target.value)}
                    disabled={!canEdit}
                  >
                    <option value="">Select company</option>
                    {companyScope.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
          </section>

          {access.summaryOnly ? null : (
            <>
              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Primary evidence repository</h3>
                    <p className="enterprise-muted">Define which repository should receive evidence records by default.</p>
                  </div>
                  <p className="enterprise-muted">
                    Enterprise recommendation: {ENTERPRISE_STORAGE_HINT.storageMode.replaceAll("_", " ")} +{" "}
                    {ENTERPRISE_STORAGE_HINT.primaryBackend.replaceAll("_", " ")}
                  </p>
                </div>
                <div className="storage-field-grid">
                  <Field id="primary-backend" label="Primary evidence repository" error={validationErrors.primaryBackend}>
                    <select
                      id="primary-backend"
                      className="enterprise-input"
                      value={form.primaryBackend}
                      onChange={(event) => onFieldChange("primaryBackend", event.target.value)}
                      disabled={!canEdit}
                    >
                      <option value="">Select backend</option>
                      {STORAGE_BACKEND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="repository-name" label="Repository name" error={validationErrors.repositoryDisplayName}>
                    <input
                      id="repository-name"
                      className="enterprise-input"
                      value={form.repositoryDisplayName}
                      onChange={(event) => onFieldChange("repositoryDisplayName", event.target.value)}
                      disabled={!canEdit}
                    />
                  </Field>
                  <div className="storage-field-span-full storage-readonly-row">
                    <CheckboxField
                      id="active-repository"
                      label="Active repository"
                      checked={form.isActive}
                      onChange={(event) => onFieldChange("isActive", event.target.checked)}
                      disabled={!canEdit}
                    />
                    <CheckboxField
                      id="default-uploads"
                      label="Use as default for uploads"
                      checked={form.isDefault}
                      onChange={(event) => onFieldChange("isDefault", event.target.checked)}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Repository connection</h3>
                    <p className="enterprise-muted">
                      Store metadata in the DB and resolve provider secrets server-side. OneDrive, Dropbox, and Google Drive can be validated live without changing platform login.
                    </p>
                  </div>
                </div>
                <div className="storage-field-grid">
                  {isMicrosoftBackend ? (
                    <>
                      <Field id="auth-mode" label="Authentication mode" error={validationErrors.authMode}>
                        <select
                          id="auth-mode"
                          className="enterprise-input"
                          value={form.authMode}
                          onChange={(event) => onFieldChange("authMode", event.target.value)}
                          disabled={!canEdit}
                        >
                          <option value="">Select mode</option>
                          {AUTH_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="external-tenant-id" label="Microsoft tenant ID" error={validationErrors.externalTenantId}>
                        <input
                          id="external-tenant-id"
                          className="enterprise-input"
                          value={form.externalTenantId}
                          onChange={(event) => onFieldChange("externalTenantId", event.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field id="drive-id" label="Drive ID" error={validationErrors.driveId}>
                        <input
                          id="drive-id"
                          className="enterprise-input"
                          value={form.driveId}
                          onChange={(event) => onFieldChange("driveId", event.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field id="root-folder-id" label="Root folder ID">
                        <input
                          id="root-folder-id"
                          className="enterprise-input"
                          value={form.rootFolderId}
                          onChange={(event) => onFieldChange("rootFolderId", event.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field id="root-folder-path" label="Root folder path" error={validationErrors.rootFolderPath}>
                        <input
                          id="root-folder-path"
                          className="enterprise-input"
                          value={form.rootFolderPath}
                          onChange={(event) => onFieldChange("rootFolderPath", event.target.value)}
                          disabled={!canEdit}
                          placeholder="/Shared Documents/Evidence"
                        />
                      </Field>
                      <Field id="secret-reference" label="Secret / token reference">
                        <div className="enterprise-form-grid">
                          <input
                            id="secret-reference"
                            className="enterprise-input"
                            value={form.secretReference}
                            onChange={(event) => onFieldChange("secretReference", event.target.value)}
                            disabled={!canEdit}
                            placeholder="kv://tenant/<tenant-id>/storage/onedrive/default"
                          />
                          <p className="enterprise-muted">
                            This is a logical reference, not the secret itself. The real secret is resolved from a secure local file and is not stored in the DB.
                          </p>
                          {validationErrors.secretReference ? (
                            <p className="enterprise-status enterprise-status-error">{validationErrors.secretReference}</p>
                          ) : null}
                        </div>
                      </Field>
                      <div className="storage-field-span-full storage-readonly-row">
                        <CheckboxField
                          id="preview-supported"
                          label="Enable preview"
                          checked={form.previewSupported}
                          onChange={(event) => onFieldChange("previewSupported", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="allow-platform-upload"
                          label="Allow upload via platform"
                          checked={form.allowPlatformUpload}
                          onChange={(event) => onFieldChange("allowPlatformUpload", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="allow-reference-only-mode"
                          label="Allow reference-only mode"
                          checked={form.allowReferenceOnlyMode}
                          onChange={(event) => onFieldChange("allowReferenceOnlyMode", event.target.checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    </>
                  ) : null}

                  {isDropboxBackend ? (
                    <>
                      <Field id="dropbox-auth-mode" label="Authentication mode" error={validationErrors.authMode}>
                        <select
                          id="dropbox-auth-mode"
                          className="enterprise-input"
                          value={form.authMode}
                          onChange={(event) => onFieldChange("authMode", event.target.value)}
                          disabled={!canEdit}
                        >
                          <option value="">Select mode</option>
                          {AUTH_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="dropbox-root-folder-id" label="Dropbox folder ID / path alias">
                        <input
                          id="dropbox-root-folder-id"
                          className="enterprise-input"
                          value={form.rootFolderId}
                          onChange={(event) => onFieldChange("rootFolderId", event.target.value)}
                          disabled={!canEdit}
                          placeholder="Optional provider folder identifier"
                        />
                      </Field>
                      <Field id="dropbox-root-folder-path" label="Root folder path" error={validationErrors.rootFolderPath}>
                        <input
                          id="dropbox-root-folder-path"
                          className="enterprise-input"
                          value={form.rootFolderPath}
                          onChange={(event) => onFieldChange("rootFolderPath", event.target.value)}
                          disabled={!canEdit}
                          placeholder="/Evidence"
                        />
                      </Field>
                      <Field id="dropbox-secret-reference" label="Secret / token reference">
                        <div className="enterprise-form-grid">
                          <input
                            id="dropbox-secret-reference"
                            className="enterprise-input"
                            value={form.secretReference}
                            onChange={(event) => onFieldChange("secretReference", event.target.value)}
                            disabled={!canEdit}
                            placeholder="kv://tenant/<tenant-id>/storage/dropbox/default"
                          />
                          <p className="enterprise-muted">
                            This is a logical reference, not the secret itself. The real secret is resolved from a secure local file and is not stored in the DB.
                          </p>
                          {validationErrors.secretReference ? (
                            <p className="enterprise-status enterprise-status-error">{validationErrors.secretReference}</p>
                          ) : null}
                        </div>
                      </Field>
                      <div className="storage-field-span-full storage-readonly-row">
                        <CheckboxField
                          id="dropbox-preview-supported"
                          label="Enable preview"
                          checked={form.previewSupported}
                          onChange={(event) => onFieldChange("previewSupported", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="dropbox-allow-platform-upload"
                          label="Allow upload via platform"
                          checked={form.allowPlatformUpload}
                          onChange={(event) => onFieldChange("allowPlatformUpload", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="dropbox-allow-reference-only-mode"
                          label="Allow reference-only mode"
                          checked={form.allowReferenceOnlyMode}
                          onChange={(event) => onFieldChange("allowReferenceOnlyMode", event.target.checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    </>
                  ) : null}

                  {isGoogleDriveBackend ? (
                    <>
                      <Field id="google-auth-mode" label="Authentication mode" error={validationErrors.authMode}>
                        <select
                          id="google-auth-mode"
                          className="enterprise-input"
                          value={form.authMode}
                          onChange={(event) => onFieldChange("authMode", event.target.value)}
                          disabled={!canEdit}
                        >
                          <option value="">Select mode</option>
                          {AUTH_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="google-drive-id" label="Shared drive ID">
                        <input
                          id="google-drive-id"
                          className="enterprise-input"
                          value={form.driveId}
                          onChange={(event) => onFieldChange("driveId", event.target.value)}
                          disabled={!canEdit}
                          placeholder="Optional shared drive identifier"
                        />
                      </Field>
                      <Field id="google-root-folder-id" label="Root folder ID">
                        <input
                          id="google-root-folder-id"
                          className="enterprise-input"
                          value={form.rootFolderId}
                          onChange={(event) => onFieldChange("rootFolderId", event.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field id="google-root-folder-path" label="Root folder path" error={validationErrors.rootFolderPath}>
                        <input
                          id="google-root-folder-path"
                          className="enterprise-input"
                          value={form.rootFolderPath}
                          onChange={(event) => onFieldChange("rootFolderPath", event.target.value)}
                          disabled={!canEdit}
                          placeholder="Evidence/Compliance"
                        />
                      </Field>
                      <Field id="google-secret-reference" label="Secret / token reference">
                        <div className="enterprise-form-grid">
                          <input
                            id="google-secret-reference"
                            className="enterprise-input"
                            value={form.secretReference}
                            onChange={(event) => onFieldChange("secretReference", event.target.value)}
                            disabled={!canEdit}
                            placeholder="kv://tenant/<tenant-id>/storage/google_drive/default"
                          />
                          <p className="enterprise-muted">
                            This is a logical reference, not the secret itself. The real secret is resolved from a secure local file and is not stored in the DB.
                          </p>
                          {validationErrors.secretReference ? (
                            <p className="enterprise-status enterprise-status-error">{validationErrors.secretReference}</p>
                          ) : null}
                        </div>
                      </Field>
                      <div className="storage-field-span-full storage-readonly-row">
                        <CheckboxField
                          id="google-preview-supported"
                          label="Enable preview"
                          checked={form.previewSupported}
                          onChange={(event) => onFieldChange("previewSupported", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="google-allow-platform-upload"
                          label="Allow upload via platform"
                          checked={form.allowPlatformUpload}
                          onChange={(event) => onFieldChange("allowPlatformUpload", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="google-allow-reference-only-mode"
                          label="Allow reference-only mode"
                          checked={form.allowReferenceOnlyMode}
                          onChange={(event) => onFieldChange("allowReferenceOnlyMode", event.target.checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    </>
                  ) : null}

                  {isPathBackend ? (
                    <>
                      <Field id="mount-path" label="Mounted path" error={validationErrors.mountPath}>
                        <input
                          id="mount-path"
                          className="enterprise-input"
                          value={form.mountPath}
                          onChange={(event) => onFieldChange("mountPath", event.target.value)}
                          disabled={!canEdit}
                          placeholder="/mnt/evidence"
                        />
                      </Field>
                      <Field id="path-access-mode" label="Path access mode" error={validationErrors.pathAccessMode}>
                        <select
                          id="path-access-mode"
                          className="enterprise-input"
                          value={form.pathAccessMode}
                          onChange={(event) => onFieldChange("pathAccessMode", event.target.value)}
                          disabled={!canEdit}
                        >
                          <option value="">Select mode</option>
                          <option value="platform_reads_and_writes">Platform reads and writes</option>
                          <option value="platform_metadata_only">Platform metadata only</option>
                          <option value="reference_only">Reference only</option>
                        </select>
                      </Field>
                      <div className="storage-field-span-full enterprise-subcard">
                        <strong>Verify path availability</strong>
                        <p className="enterprise-muted">Path availability is validated structurally only in this phase.</p>
                      </div>
                    </>
                  ) : null}

                  {!isCloudDriveBackend && !isPathBackend ? (
                    <>
                      <Field id="generic-auth-mode" label="Authentication mode">
                        <select
                          id="generic-auth-mode"
                          className="enterprise-input"
                          value={form.authMode}
                          onChange={(event) => onFieldChange("authMode", event.target.value)}
                          disabled={!canEdit}
                        >
                          <option value="">Select mode</option>
                          {AUTH_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="generic-root-path" label="Root folder path / bucket / container">
                        <input
                          id="generic-root-path"
                          className="enterprise-input"
                          value={form.rootFolderPath}
                          onChange={(event) => onFieldChange("rootFolderPath", event.target.value)}
                          disabled={!canEdit}
                          placeholder="Prepared for a future adapter"
                        />
                      </Field>
                      <Field id="generic-secret-reference" label="Secret reference">
                        <div className="enterprise-form-grid">
                          <input
                            id="generic-secret-reference"
                            className="enterprise-input"
                            value={form.secretReference}
                            onChange={(event) => onFieldChange("secretReference", event.target.value)}
                            disabled={!canEdit}
                            placeholder="kv://tenant/<tenant-id>/storage/provider/default"
                          />
                          <p className="enterprise-muted">
                            Logical reference only. The real provider secret is resolved from a secure local file and never persisted in `tenant_storage_config`.
                          </p>
                          {validationErrors.secretReference ? (
                            <p className="enterprise-status enterprise-status-error">{validationErrors.secretReference}</p>
                          ) : null}
                        </div>
                      </Field>
                      <div className="storage-field-span-full storage-readonly-row">
                        <CheckboxField
                          id="generic-preview"
                          label="Enable preview"
                          checked={form.previewSupported}
                          onChange={(event) => onFieldChange("previewSupported", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="generic-platform-upload"
                          label="Allow upload via platform"
                          checked={form.allowPlatformUpload}
                          onChange={(event) => onFieldChange("allowPlatformUpload", event.target.checked)}
                          disabled={!canEdit}
                        />
                        <CheckboxField
                          id="generic-reference-mode"
                          label="Allow reference-only mode"
                          checked={form.allowReferenceOnlyMode}
                          onChange={(event) => onFieldChange("allowReferenceOnlyMode", event.target.checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Access & delivery policy</h3>
                    <p className="enterprise-muted">Control how files are delivered, previewed and exported.</p>
                  </div>
                </div>
                <div className="storage-field-grid">
                  <Field id="download-access-mode" label="File access mode">
                    <select
                      id="download-access-mode"
                      className="enterprise-input"
                      value={form.downloadAccessMode}
                      onChange={(event) => onFieldChange("downloadAccessMode", event.target.value)}
                      disabled={!canEdit}
                    >
                      {DOWNLOAD_ACCESS_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="signed-url-ttl" label="Temporary link expiry" error={validationErrors.signedUrlTtlSec}>
                    <input
                      id="signed-url-ttl"
                      className="enterprise-input"
                      type="number"
                      min="30"
                      max="3600"
                      value={form.signedUrlTtlSec ?? ""}
                      onChange={(event) => onFieldChange("signedUrlTtlSec", event.target.value === "" ? "" : Number(event.target.value))}
                      disabled={!canEdit || form.downloadAccessMode !== "signed_url_short_lived"}
                    />
                  </Field>
                  <Field id="preview-mode" label="Preview mode">
                    <select
                      id="preview-mode"
                      className="enterprise-input"
                      value={form.previewMode}
                      onChange={(event) => onFieldChange("previewMode", event.target.value)}
                      disabled={!canEdit}
                    >
                      {PREVIEW_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="export-link-mode" label="Export link mode">
                    <select
                      id="export-link-mode"
                      className="enterprise-input"
                      value={form.exportLinkMode}
                      onChange={(event) => onFieldChange("exportLinkMode", event.target.value)}
                      disabled={!canEdit}
                    >
                      <option value="no_links">No links</option>
                      <option value="reference_only">Reference only</option>
                      <option value="short_lived_links">Short-lived links</option>
                      <option value="direct_links_if_allowed">Direct links if allowed</option>
                    </select>
                  </Field>
                  <div className="storage-field-span-full storage-readonly-row">
                    <CheckboxField
                      id="audit-downloads"
                      label="Audit downloads and previews"
                      checked={form.auditDownloads}
                      onChange={(event) => onFieldChange("auditDownloads", event.target.checked)}
                      disabled={!canEdit}
                    />
                    <CheckboxField
                      id="allow-export-links"
                      label="Include file links in exports"
                      checked={form.allowExportFileLinks}
                      onChange={(event) => onFieldChange("allowExportFileLinks", event.target.checked)}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Backup & recovery</h3>
                    <p className="enterprise-muted">Set retention and verification expectations without changing live upload behavior.</p>
                  </div>
                </div>
                <div className="storage-field-grid">
                  <div className="enterprise-subcard">
                    <strong>Backup strategy</strong>
                    <p>{form.backupProfile === "3_2_1_standard" ? "3 copies / 2 media / 1 offsite" : "Policy-driven"}</p>
                  </div>
                  <Field id="backup-profile" label="Backup profile">
                    <select
                      id="backup-profile"
                      className="enterprise-input"
                      value={form.backupProfile}
                      onChange={(event) => onFieldChange("backupProfile", event.target.value)}
                      disabled={!canEdit}
                    >
                      {BACKUP_PROFILE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="backup-frequency" label="Backup frequency">
                    <select
                      id="backup-frequency"
                      className="enterprise-input"
                      value={form.backupFrequency}
                      onChange={(event) => onFieldChange("backupFrequency", event.target.value)}
                      disabled={!canEdit}
                    >
                      {BACKUP_FREQUENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="backup-retention" label="Backup retention (days)" error={validationErrors.backupRetentionDays}>
                    <input
                      id="backup-retention"
                      className="enterprise-input"
                      type="number"
                      min="1"
                      max="3650"
                      value={form.backupRetentionDays ?? ""}
                      onChange={(event) =>
                        onFieldChange("backupRetentionDays", event.target.value === "" ? "" : Number(event.target.value))
                      }
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field id="backup-verification" label="Backup verification">
                    <select
                      id="backup-verification"
                      className="enterprise-input"
                      value={form.backupVerificationMode}
                      onChange={(event) => onFieldChange("backupVerificationMode", event.target.value)}
                      disabled={!canEdit}
                    >
                      {BACKUP_VERIFICATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="offsite-repository" label="Offsite backup target" error={validationErrors.offsiteRepository}>
                    <input
                      id="offsite-repository"
                      className="enterprise-input"
                      value={form.offsiteRepository}
                      onChange={(event) => onFieldChange("offsiteRepository", event.target.value)}
                      disabled={!canEdit}
                      placeholder="Secondary vault / immutable archive"
                    />
                  </Field>
                  <Field id="backup-notes" label="Backup notes" full>
                    <textarea
                      id="backup-notes"
                      className="enterprise-input"
                      rows={3}
                      value={form.backupNotes}
                      onChange={(event) => onFieldChange("backupNotes", event.target.value)}
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Evidence organization</h3>
                    <p className="enterprise-muted">Prepare folder and filename conventions for future storage-aware uploads.</p>
                  </div>
                </div>
                <div className="storage-field-grid">
                  <Field id="folder-strategy" label="Folder structure">
                    <select
                      id="folder-strategy"
                      className="enterprise-input"
                      value={form.folderStrategy}
                      onChange={(event) => onFieldChange("folderStrategy", event.target.value)}
                      disabled={!canEdit}
                    >
                      {FOLDER_STRATEGY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="custom-folder-pattern" label="Custom folder pattern" error={validationErrors.customFolderPattern}>
                    <input
                      id="custom-folder-pattern"
                      className="enterprise-input"
                      value={form.customFolderPattern}
                      onChange={(event) => onFieldChange("customFolderPattern", event.target.value)}
                      disabled={!canEdit || form.folderStrategy !== "custom"}
                      placeholder="{tenant}/{company}/{year}/{doc_type}"
                    />
                  </Field>
                  <Field id="filename-strategy" label="Filename convention">
                    <select
                      id="filename-strategy"
                      className="enterprise-input"
                      value={form.filenameStrategy}
                      onChange={(event) => onFieldChange("filenameStrategy", event.target.value)}
                      disabled={!canEdit}
                    >
                      {FILENAME_STRATEGY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="duplicate-policy" label="Duplicate handling">
                    <select
                      id="duplicate-policy"
                      className="enterprise-input"
                      value={form.duplicatePolicy}
                      onChange={(event) => onFieldChange("duplicatePolicy", event.target.value)}
                      disabled={!canEdit}
                    >
                      {DUPLICATE_POLICY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="versioning-mode" label="Version handling">
                    <select
                      id="versioning-mode"
                      className="enterprise-input"
                      value={form.versioningMode}
                      onChange={(event) => onFieldChange("versioningMode", event.target.value)}
                      disabled={!canEdit}
                    >
                      {VERSIONING_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="storage-field-span-full storage-readonly-row">
                    <CheckboxField
                      id="enforce-checksum"
                      label="Compute checksum"
                      checked={form.enforceChecksum}
                      onChange={(event) => onFieldChange("enforceChecksum", event.target.checked)}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Health & validation</h3>
                    <p className="enterprise-muted">Run structural validation for all backends and live Microsoft Graph checks when OneDrive is selected.</p>
                  </div>
                  <div className="enterprise-inline-actions">
                    <button className="enterprise-button-secondary" type="button" onClick={() => void runTest("connection")} disabled={!canEdit || testing}>
                      {testing ? "Testing..." : "Test connection"}
                    </button>
                    <button className="enterprise-button-secondary" type="button" onClick={() => void runTest("preview")} disabled={!canEdit || testing}>
                      Test preview
                    </button>
                    <button className="enterprise-button-secondary" type="button" onClick={() => void runTest("upload")} disabled={!canEdit || testing}>
                      Test upload
                    </button>
                  </div>
                </div>
                <div className="storage-field-grid">
                  <div className="enterprise-subcard">
                    <strong>Last connection check</strong>
                    <p>{form.lastValidationAt ? new Date(form.lastValidationAt).toLocaleString() : "Not checked yet"}</p>
                  </div>
                  <div className="enterprise-subcard">
                    <strong>Repository status</strong>
                    <p>{form.repositoryHealthStatus}</p>
                  </div>
                  <div className="enterprise-subcard storage-field-span-full">
                    <strong>Last repository error</strong>
                    <p>{form.lastErrorMessage || "No repository error stored."}</p>
                  </div>
                  <div className="storage-field-span-full">
                    <CheckList result={testResult} />
                  </div>
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Migration</h3>
                    <p className="enterprise-muted">Plan the move from legacy `blob_url` records to a storage-aware model without migrating files yet.</p>
                  </div>
                  <div className="enterprise-inline-actions">
                    <button className="enterprise-button-secondary" type="button" onClick={() => void generatePlan()} disabled={!canEdit || planning}>
                      {planning ? "Planning..." : "Generate migration plan"}
                    </button>
                    <button className="enterprise-button-secondary" type="button" disabled>
                      Run migration
                    </button>
                  </div>
                </div>
                <div className="storage-field-grid">
                  <Field id="migration-mode" label="Migration mode">
                    <select
                      id="migration-mode"
                      className="enterprise-input"
                      value={form.migrationMode}
                      onChange={(event) => onFieldChange("migrationMode", event.target.value)}
                      disabled={!canEdit}
                    >
                      {MIGRATION_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="migration-batch-size" label="Migration batch size" error={validationErrors.migrationBatchSize}>
                    <input
                      id="migration-batch-size"
                      className="enterprise-input"
                      type="number"
                      min="1"
                      max="5000"
                      value={form.migrationBatchSize ?? ""}
                      onChange={(event) =>
                        onFieldChange("migrationBatchSize", event.target.value === "" ? "" : Number(event.target.value))
                      }
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field id="migration-status" label="Migration status">
                    <select
                      id="migration-status"
                      className="enterprise-input"
                      value={form.migrationStatus}
                      onChange={(event) => onFieldChange("migrationStatus", event.target.value)}
                      disabled={!canEdit}
                    >
                      {MIGRATION_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="storage-field-span-full storage-readonly-row">
                    <CheckboxField
                      id="legacy-access-fallback"
                      label="Legacy access fallback"
                      checked={form.legacyAccessFallback}
                      onChange={(event) => onFieldChange("legacyAccessFallback", event.target.checked)}
                      disabled={!canEdit}
                    />
                  </div>
                  <Field id="migration-notes" label="Migration notes" full>
                    <textarea
                      id="migration-notes"
                      className="enterprise-input"
                      rows={3}
                      value={form.migrationNotes}
                      onChange={(event) => onFieldChange("migrationNotes", event.target.value)}
                      disabled={!canEdit}
                    />
                  </Field>
                  <div className="storage-field-span-full">
                    <MigrationPlanCard plan={migrationPlan} />
                  </div>
                </div>
              </section>

              <section className="enterprise-card">
                <div className="storage-section-header">
                  <div>
                    <h3>Audit / admin notes</h3>
                    <p className="enterprise-muted">Administrative notes for tenant admins and superadmins. Evidence access logs remain an extension point for a later phase.</p>
                  </div>
                </div>
                <div className="storage-field-grid">
                  <Field id="admin-notes" label="Admin notes" full>
                    <textarea
                      id="admin-notes"
                      className="enterprise-input"
                      rows={4}
                      value={form.adminNotes}
                      onChange={(event) => onFieldChange("adminNotes", event.target.value)}
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="storage-config-side">
          <StorageSummaryCard summary={summary} />
          {companyOverrides.length > 0 ? (
            <section className="enterprise-card">
              <h3>Company overrides</h3>
              <div className="storage-checks-grid">
                {companyOverrides.map((item) => (
                  <div key={item.id} className="enterprise-subcard">
                    <strong>{item.repositoryDisplayName}</strong>
                    <p className="enterprise-muted">
                      {item.companyId || "Company"} · {item.primaryBackend} · {item.repositoryHealthStatus}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="enterprise-card">
              <h3>Company overrides</h3>
              <p className="enterprise-muted">No company-specific overrides saved yet. The scope selector above can prepare one.</p>
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
