"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import StorageSummaryCard from "../../../_components/storage-summary-card";
import { useTenantSession } from "../../../_components/use-tenant-session";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const readJson = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const baseMessage = payload?.error || payload?.message || `HTTP ${response.status}`;
    const code = typeof payload?.code === "string" ? payload.code : "";
    throw new Error(code ? `${baseMessage} [${code}]` : baseMessage);
  }
  return payload;
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export default function SuperadminTenantDetailPage({ params }) {
  const tenantId = params?.tenantId;
  const session = useTenantSession();
  const canEdit = session.platformRole === "superadmin";
  const canView = ["superadmin", "support", "billing"].includes(session.platformRole);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [storageBundle, setStorageBundle] = useState(null);
  const [adminForm, setAdminForm] = useState({
    email: "",
    name: "",
    password: "",
    overrideQuota: false,
  });

  const loadDetail = useCallback(async () => {
    if (!tenantId || !canView) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const detailPromise = readJson(await fetch(`/api/v1/superadmin/tenants/${encodeURIComponent(tenantId)}`, { cache: "no-store" }));
      const storagePromise =
        session.platformRole === "superadmin"
          ? readJson(await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/storage-config`, { cache: "no-store" }))
          : Promise.resolve(null);
      const [detailPayload, storagePayload] = await Promise.all([detailPromise, storagePromise]);
      setDetail(detailPayload);
      setStorageBundle(storagePayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load tenant detail");
      setDetail(null);
      setStorageBundle(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, canView, session.platformRole]);

  useEffect(() => {
    if (!session.loading && canView) {
      void loadDetail();
    }
  }, [session.loading, canView, loadDetail]);

  const updateTenant = async (updates) => {
    if (!canEdit || !tenantId) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/superadmin/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      await readJson(response);
      await loadDetail();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update tenant");
    } finally {
      setBusy(false);
    }
  };

  const archiveTenant = async () => {
    if (!canEdit || !tenantId) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/superadmin/tenants/${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
      });
      await readJson(response);
      await loadDetail();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Failed to archive tenant");
    } finally {
      setBusy(false);
    }
  };

  const createTenantAdmin = async (event) => {
    event.preventDefault();
    if (!canEdit || !tenantId) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/superadmin/tenants/${encodeURIComponent(tenantId)}/admins`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(adminForm),
      });
      await readJson(response);
      setAdminForm({
        email: "",
        name: "",
        password: "",
        overrideQuota: false,
      });
      await loadDetail();
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : "Failed to create tenant admin");
    } finally {
      setBusy(false);
    }
  };

  const usageSummary = useMemo(() => {
    const usage = detail?.usageCurrent || {};
    return {
      usersCount: Number(usage.usersCount ?? 0),
      evidenceBytesCumulative: Number(usage.evidenceBytesCumulative ?? 0),
      exportsCount: Number(usage.exportsCount ?? 0),
      jobsCount: Number(usage.jobsCount ?? 0),
      apiCallsCount: Number(usage.apiCallsCount ?? 0),
    };
  }, [detail]);

  if (!session.loading && !canView) {
    return (
      <section className="enterprise-grid">
        <h2 className="enterprise-section-title">Tenant detail</h2>
        <p className="enterprise-status enterprise-status-error">
          This area is only available to platform superadmin/support/billing roles.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="enterprise-grid">
        <h2 className="enterprise-section-title">Tenant detail</h2>
        <p className="enterprise-status">Loading tenant detail...</p>
      </section>
    );
  }

  if (!detail?.tenant) {
    return (
      <section className="enterprise-grid">
        <h2 className="enterprise-section-title">Tenant detail</h2>
        <p className="enterprise-status enterprise-status-error">{error || "Tenant not found."}</p>
      </section>
    );
  }

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">{detail.tenant.name}</h2>
          <p className="enterprise-muted">
            {detail.tenant.id} · status {detail.tenant.tenantStatus}
          </p>
        </div>
        <button className="enterprise-button-secondary" type="button" onClick={() => void loadDetail()} disabled={busy}>
          Refresh
        </button>
      </div>

      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}

      <div className="enterprise-card-grid">
        <section className="enterprise-card">
          <h3>Overview</h3>
          <p className="enterprise-muted">
            Users {usageSummary.usersCount} · Evidence {formatBytes(usageSummary.evidenceBytesCumulative)}
          </p>
          <p className="enterprise-muted">
            Exports {usageSummary.exportsCount} · Jobs {usageSummary.jobsCount} · API calls {usageSummary.apiCallsCount}
          </p>
          <p className="enterprise-muted">
            Companies {Array.isArray(detail.companies) ? detail.companies.length : 0} · Sites{" "}
            {Array.isArray(detail.sites) ? detail.sites.length : 0}
          </p>
        </section>

        <section className="enterprise-card">
          <h3>
            <TooltipText text="Quote disponibili">Entitlements</TooltipText>
          </h3>
          <p className="enterprise-muted">Plan: {detail.entitlements?.plan || "free"}</p>
          <p className="enterprise-muted">Max users: {detail.entitlements?.maxUsers ?? 0}</p>
          <p className="enterprise-muted">Max evidence bytes: {formatBytes(detail.entitlements?.maxEvidenceBytes ?? 0)}</p>
          <p className="enterprise-muted">
            Max exports/month: {detail.entitlements?.maxExportsPerMonth ?? 0} · Max jobs/month:{" "}
            {detail.entitlements?.maxJobsPerMonth ?? 0}
          </p>
        </section>

        <StorageSummaryCard summary={storageBundle?.summary} compact />
      </div>

      <section className="enterprise-card">
        <div className="storage-section-header">
          <div>
            <h3>Storage & backup</h3>
            <p className="enterprise-muted">Tenant-level repository health and migration posture.</p>
          </div>
          <div className="enterprise-inline-actions">
            <Link className="enterprise-button-secondary" href="/app/settings/storage-backup">
              Open storage configuration
            </Link>
          </div>
        </div>
        <p className="enterprise-muted">
          Health: {storageBundle?.summary?.repositoryHealth || "warning"} · Migration:{" "}
          {storageBundle?.summary?.migrationMode || "new_uploads_only"} / {storageBundle?.summary?.migrationStatus || "not_started"}
        </p>
        <p className="enterprise-muted">
          To edit this configuration, switch the active tenant in the top bar to this tenant and open the tenant storage page.
        </p>
        <p className="enterprise-muted">
          Notes: {Array.isArray(storageBundle?.summary?.notes) && storageBundle.summary.notes.length > 0 ? storageBundle.summary.notes.join(" | ") : "No admin notes yet."}
        </p>
      </section>

      {canEdit ? (
        <section className="enterprise-card">
          <h3>Update status, notes and quotas</h3>
          <form
            className="enterprise-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              void updateTenant({
                tenantStatus: formData.get("tenantStatus"),
                internalNotes: formData.get("internalNotes"),
                plan: formData.get("plan"),
                maxUsers: Number(formData.get("maxUsers")),
                maxEvidenceBytes: Number(formData.get("maxEvidenceBytes")),
                maxExportsPerMonth: Number(formData.get("maxExportsPerMonth")),
                maxJobsPerMonth: Number(formData.get("maxJobsPerMonth")),
              });
            }}
          >
            <label className="enterprise-label" htmlFor="tenant-status">
              <TooltipText text="Stato operativo">Tenant status</TooltipText>
            </label>
            <select id="tenant-status" name="tenantStatus" className="enterprise-input" defaultValue={detail.tenant.tenantStatus}>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="archived">archived</option>
            </select>

            <label className="enterprise-label" htmlFor="tenant-notes">
              Internal notes
            </label>
            <textarea
              id="tenant-notes"
              name="internalNotes"
              className="enterprise-input"
              defaultValue={detail.tenant.internalNotes || ""}
            />

            <label className="enterprise-label" htmlFor="tenant-plan">
              Plan
            </label>
            <input id="tenant-plan" name="plan" className="enterprise-input" defaultValue={detail.entitlements?.plan || "free"} />

            <label className="enterprise-label" htmlFor="tenant-max-users">
              Max users
            </label>
            <input
              id="tenant-max-users"
              name="maxUsers"
              className="enterprise-input"
              type="number"
              min={1}
              defaultValue={detail.entitlements?.maxUsers ?? 5}
            />

            <label className="enterprise-label" htmlFor="tenant-max-evidence-bytes">
              Max evidence bytes
            </label>
            <input
              id="tenant-max-evidence-bytes"
              name="maxEvidenceBytes"
              className="enterprise-input"
              type="number"
              min={0}
              defaultValue={detail.entitlements?.maxEvidenceBytes ?? 1073741824}
            />

            <label className="enterprise-label" htmlFor="tenant-max-exports">
              Max exports/month
            </label>
            <input
              id="tenant-max-exports"
              name="maxExportsPerMonth"
              className="enterprise-input"
              type="number"
              min={0}
              defaultValue={detail.entitlements?.maxExportsPerMonth ?? 50}
            />

            <label className="enterprise-label" htmlFor="tenant-max-jobs">
              Max jobs/month
            </label>
            <input
              id="tenant-max-jobs"
              name="maxJobsPerMonth"
              className="enterprise-input"
              type="number"
              min={0}
              defaultValue={detail.entitlements?.maxJobsPerMonth ?? 500}
            />

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save changes"}
              </button>
              <button className="enterprise-button-danger" type="button" onClick={() => void archiveTenant()} disabled={busy}>
                <TooltipText text="Sospendi tenant">Archive tenant</TooltipText>
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {canEdit ? (
        <section className="enterprise-card">
          <h3>
            <TooltipText text="Admin del tenant">Create tenant admin</TooltipText>
          </h3>
          <form className="enterprise-form-grid" onSubmit={(event) => void createTenantAdmin(event)}>
            <label className="enterprise-label" htmlFor="tenant-admin-email">
              Email
            </label>
            <input
              id="tenant-admin-email"
              className="enterprise-input"
              type="email"
              value={adminForm.email}
              onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="tenant-admin-name">
              Name
            </label>
            <input
              id="tenant-admin-name"
              className="enterprise-input"
              type="text"
              value={adminForm.name}
              onChange={(event) => setAdminForm((current) => ({ ...current, name: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="tenant-admin-password">
              Password
            </label>
            <input
              id="tenant-admin-password"
              className="enterprise-input"
              type="password"
              value={adminForm.password}
              onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))}
              minLength={8}
              required
            />

            <label className="enterprise-checkbox-row" htmlFor="tenant-admin-override-quota">
              <input
                id="tenant-admin-override-quota"
                type="checkbox"
                checked={adminForm.overrideQuota}
                onChange={(event) =>
                  setAdminForm((current) => ({
                    ...current,
                    overrideQuota: event.target.checked,
                  }))
                }
              />
              Override user quota
            </label>

            <button className="enterprise-button-primary" type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create tenant admin"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="enterprise-card">
        <h3>Usage history (last 6 months)</h3>
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Users</th>
                <th>Evidence</th>
                <th>Exports</th>
                <th>Jobs</th>
                <th>API calls</th>
              </tr>
            </thead>
            <tbody>
              {(detail.usageHistory || []).map((row) => (
                <tr key={`${row.year}-${row.month}`}>
                  <td>
                    {row.year}-{String(row.month).padStart(2, "0")}
                  </td>
                  <td>{row.usersCount}</td>
                  <td>{formatBytes(row.evidenceBytes)}</td>
                  <td>{row.exportsCount}</td>
                  <td>{row.jobsCount}</td>
                  <td>{row.apiCallsCount}</td>
                </tr>
              ))}
              {(detail.usageHistory || []).length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="enterprise-empty">No usage records available.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
