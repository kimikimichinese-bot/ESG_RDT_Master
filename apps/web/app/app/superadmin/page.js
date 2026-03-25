"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantSession } from "../_components/use-tenant-session";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const INITIAL_FORM = {
  name: "",
  internalNotes: "",
};

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

export default function SuperadminDashboardPage() {
  const session = useTenantSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [data, setData] = useState({
    period: null,
    totals: null,
    tenants: [],
  });
  const [createForm, setCreateForm] = useState(INITIAL_FORM);
  const [busyCreate, setBusyCreate] = useState(false);
  const [busyTenantId, setBusyTenantId] = useState("");

  const canEdit = session.platformRole === "superadmin";
  const canView = ["superadmin", "support", "billing"].includes(session.platformRole);

  const loadData = useCallback(async () => {
    if (!canView) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/superadmin/tenants", { cache: "no-store" });
      const payload = await readJson(response);
      setData({
        period: payload.period || null,
        totals: payload.totals || null,
        tenants: Array.isArray(payload.tenants) ? payload.tenants : [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load superadmin data");
      setData({
        period: null,
        totals: null,
        tenants: [],
      });
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    if (!session.loading && canView) {
      void loadData();
    }
  }, [session.loading, canView, loadData]);

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.tenants.filter((item) => {
      const matchesSearch = query
        ? item.name?.toLowerCase().includes(query) || item.id?.toLowerCase().includes(query)
        : true;
      const matchesStatus = statusFilter === "all" ? true : item.tenantStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data.tenants, search, statusFilter]);

  const submitCreateTenant = async (event) => {
    event.preventDefault();
    if (!canEdit) {
      return;
    }
    if (!createForm.name.trim()) {
      setError("Tenant name is required.");
      return;
    }

    setBusyCreate(true);
    setError("");
    try {
      const response = await fetch("/api/v1/superadmin/tenants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createForm),
      });
      await readJson(response);
      setCreateForm(INITIAL_FORM);
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create tenant");
    } finally {
      setBusyCreate(false);
    }
  };

  const updateTenantStatus = async (tenantId, tenantStatus) => {
    if (!canEdit) {
      return;
    }
    setBusyTenantId(tenantId);
    setError("");
    try {
      const response = await fetch(`/api/v1/superadmin/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ tenantStatus }),
      });
      await readJson(response);
      await loadData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to update tenant status");
    } finally {
      setBusyTenantId("");
    }
  };

  if (!session.loading && !canView) {
    return (
      <section className="enterprise-grid">
        <h2 className="enterprise-section-title">Superadmin</h2>
        <p className="enterprise-status enterprise-status-error">
          This area is only available to platform superadmin/support/billing roles.
        </p>
      </section>
    );
  }

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Superadmin</h2>
          <p className="enterprise-muted">Platform control center for customer tenants, quotas and usage.</p>
        </div>
        <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading superadmin data...</p> : null}

      {!loading && data.totals ? (
        <div className="enterprise-kpi-grid">
          <article className="enterprise-kpi-card">
            <strong>
              <TooltipText text="Gestisci i tenant">Tenants</TooltipText>
            </strong>
            <p>{data.totals.tenantsCount}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Users</strong>
            <p>{data.totals.usersCount}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Evidence bytes</strong>
            <p>{formatBytes(data.totals.evidenceBytes)}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Exports (month)</strong>
            <p>{data.totals.exportsCount}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Jobs (month)</strong>
            <p>{data.totals.jobsCount}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>API calls (month)</strong>
            <p>{data.totals.apiCallsCount}</p>
          </article>
        </div>
      ) : null}

      {canEdit ? (
        <section className="enterprise-card">
          <h3>
            <TooltipText text="Crea un tenant">Create tenant</TooltipText>
          </h3>
          <form className="enterprise-form-grid" onSubmit={(event) => void submitCreateTenant(event)}>
            <label className="enterprise-label" htmlFor="superadmin-create-tenant-name">
              Tenant name
            </label>
            <input
              id="superadmin-create-tenant-name"
              className="enterprise-input"
              type="text"
              value={createForm.name}
              onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Customer Holding"
              disabled={busyCreate}
            />
            <label className="enterprise-label" htmlFor="superadmin-create-tenant-notes">
              Internal notes
            </label>
            <textarea
              id="superadmin-create-tenant-notes"
              className="enterprise-input"
              value={createForm.internalNotes}
              onChange={(event) => setCreateForm((current) => ({ ...current, internalNotes: event.target.value }))}
              placeholder="Internal onboarding notes"
              disabled={busyCreate}
            />
            <button className="enterprise-button-primary" type="submit" disabled={busyCreate}>
              {busyCreate ? "Creating..." : "Create tenant"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="enterprise-card">
        <h3>Tenant directory</h3>
        <div className="enterprise-filter-grid">
          <div>
            <label className="enterprise-label" htmlFor="superadmin-search">
              Search
            </label>
            <input
              id="superadmin-search"
              className="enterprise-input"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tenant name or ID"
            />
          </div>
          <div>
            <label className="enterprise-label" htmlFor="superadmin-status-filter">
              <TooltipText text="Stato operativo">Status</TooltipText>
            </label>
            <select
              id="superadmin-status-filter"
              className="enterprise-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        <div className="enterprise-table-wrap">
          <table className="enterprise-table enterprise-table-wide">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>
                  <TooltipText text="Stato operativo">Status</TooltipText>
                </th>
                <th>
                  <TooltipText text="Uso della piattaforma">Usage</TooltipText>
                </th>
                <th>
                  <TooltipText text="Quote disponibili">Quota</TooltipText>
                </th>
                <th>Companies/Sites</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.map((tenant) => {
                const overQuota =
                  tenant.overQuota?.users || tenant.overQuota?.evidence || tenant.overQuota?.exports || tenant.overQuota?.jobs;
                return (
                  <tr key={tenant.id}>
                    <td>
                      <strong>{tenant.name}</strong>
                      <div className="enterprise-muted">{tenant.id}</div>
                    </td>
                    <td>
                      <span className="enterprise-pill">{tenant.tenantStatus}</span>
                    </td>
                    <td>
                      Users {tenant.usage?.usersCount ?? 0}
                      <br />
                      Evidence {formatBytes(tenant.usage?.evidenceBytes ?? 0)}
                      <br />
                      Exports {tenant.usage?.exportsCount ?? 0} · Jobs {tenant.usage?.jobsCount ?? 0}
                    </td>
                    <td>
                      Users {tenant.entitlements?.maxUsers ?? 0}
                      <br />
                      Evidence {formatBytes(tenant.entitlements?.maxEvidenceBytes ?? 0)}
                      <br />
                      Exports {tenant.entitlements?.maxExportsPerMonth ?? 0} · Jobs {tenant.entitlements?.maxJobsPerMonth ?? 0}
                      {overQuota ? (
                        <div className="enterprise-pill enterprise-pill-warning enterprise-tooltip" data-tooltip="Quota superata" aria-label="Quota superata">
                          Over quota
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {tenant.counters?.companiesCount ?? 0} companies
                      <br />
                      {tenant.counters?.sitesCount ?? 0} sites
                    </td>
                    <td>
                      <div className="enterprise-inline-actions">
                        <Link className="enterprise-button-secondary" href={`/app/superadmin/tenants/${tenant.id}`}>
                          View
                        </Link>
                        {canEdit ? (
                          <button
                            className="enterprise-button-secondary"
                            type="button"
                            disabled={busyTenantId === tenant.id}
                            onClick={() =>
                              void updateTenantStatus(
                                tenant.id,
                                tenant.tenantStatus === "suspended" ? "active" : "suspended",
                              )
                            }
                          >
                            {busyTenantId === tenant.id
                              ? "Saving..."
                              : tenant.tenantStatus === "suspended"
                                ? "Activate"
                                : <TooltipText text="Sospendi tenant">Suspend</TooltipText>}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="enterprise-empty">No tenants matching filters.</div>
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
