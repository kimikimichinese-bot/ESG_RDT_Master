"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const emptyForm = {
  siteId: "",
  activityType: "",
  periodStart: "",
  periodEnd: "",
  quantity: "",
  unit: "",
  notes: "",
  evidenceId: "",
};

export default function ActivitiesPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);
  const [activities, setActivities] = useState([]);
  const [sites, setSites] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const loadData = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const companyQuery = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
      const [activitiesRes, sitesRes, evidenceRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/activities${companyQuery}`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites${companyQuery}`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence${companyQuery}`, { cache: "no-store" }),
      ]);

      const [activitiesPayload, sitesPayload, evidencePayload] = await Promise.all([
        activitiesRes.json().catch(() => ({})),
        sitesRes.json().catch(() => ({})),
        evidenceRes.json().catch(() => ({})),
      ]);

      if (!activitiesRes.ok || !sitesRes.ok || !evidenceRes.ok) {
        throw new Error("Failed to load activities data");
      }

      setActivities(Array.isArray(activitiesPayload.activities) ? activitiesPayload.activities : []);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
      setEvidence(Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load activities");
      setActivities([]);
      setSites([]);
      setEvidence([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadData();
    }
  }, [tenant.loading, tenant.tenantId, loadData]);

  const siteMap = useMemo(() => {
    const map = new Map();
    for (const site of sites) {
      map.set(site.id, site.name);
    }
    return map;
  }, [sites]);

  const evidenceMap = useMemo(() => {
    const map = new Map();
    for (const item of evidence) {
      map.set(item.id, item.filename);
    }
    return map;
  }, [evidence]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (activity) => {
    setEditing(activity);
    setForm({
      siteId: activity.siteId || "",
      activityType: activity.activityType || "",
      periodStart: activity.periodStart || "",
      periodEnd: activity.periodEnd || "",
      quantity: activity.quantity != null ? String(activity.quantity) : "",
      unit: activity.unit || "",
      notes: activity.notes || "",
      evidenceId: activity.evidenceId || "",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!tenant.tenantId) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const url = editing
        ? `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/activities/${encodeURIComponent(editing.id)}`
        : `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/activities`;
      const method = editing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          quantity: Number(form.quantity),
          evidenceId: form.evidenceId || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      closeModal();
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save activity");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (activity) => {
    if (!tenant.tenantId) {
      return;
    }

    const confirmed = window.confirm(`Delete activity \"${activity.activityType}\"?`);
    if (!confirmed) {
      return;
    }

    setError("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/activities/${encodeURIComponent(activity.id)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete activity");
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Activities</h2>
          <p className="enterprise-muted">Operational records with period, quantity and optional evidence link.</p>
        </div>
        <div className="enterprise-inline-actions">
          <label className="enterprise-inline-field" htmlFor="activities-company-filter">
            Company
          </label>
          <select
            id="activities-company-filter"
            className="enterprise-input"
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              companyScope.setActiveCompanyId(event.target.value);
            }}
          >
            <option value="">All companies</option>
            {companyScope.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
                {company.isHolding ? " (Holding)" : ""}
              </option>
            ))}
          </select>
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              New activity
            </button>
          ) : null}
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading activities...</p> : null}

      {!loading && activities.length === 0 ? <div className="enterprise-empty">No activities logged yet.</div> : null}

      {!loading && activities.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Site</th>
                <th>Period</th>
                <th>Quantity</th>
                <th>Evidence</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td>{activity.activityType}</td>
                  <td>{siteMap.get(activity.siteId) || "Unknown site"}</td>
                  <td>
                    {activity.periodStart} → {activity.periodEnd}
                  </td>
                  <td>
                    {activity.quantity} {activity.unit}
                  </td>
                  <td>{activity.evidenceId ? evidenceMap.get(activity.evidenceId) || "Linked" : "-"}</td>
                  <td>
                    <div className="enterprise-inline-actions">
                      {canWrite ? (
                        <>
                          <button
                            className="enterprise-button-secondary"
                            type="button"
                            onClick={() => openEdit(activity)}
                          >
                            Edit
                          </button>
                          <button
                            className="enterprise-button-danger"
                            type="button"
                            onClick={() => void onDelete(activity)}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <span className="enterprise-muted">Read-only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {modalOpen ? (
        <Modal title={editing ? "Edit activity" : "Create activity"} onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={onSubmit}>
            <label className="enterprise-label" htmlFor="activity-site">
              Site
            </label>
            <select
              id="activity-site"
              className="enterprise-input"
              value={form.siteId}
              onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}
              required
            >
              <option value="">Select site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>

            <label className="enterprise-label" htmlFor="activity-type">
              Activity type
            </label>
            <input
              id="activity-type"
              className="enterprise-input"
              type="text"
              value={form.activityType}
              onChange={(event) => setForm((current) => ({ ...current, activityType: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="activity-start">
              Period start
            </label>
            <input
              id="activity-start"
              className="enterprise-input"
              type="date"
              value={form.periodStart}
              onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="activity-end">
              Period end
            </label>
            <input
              id="activity-end"
              className="enterprise-input"
              type="date"
              value={form.periodEnd}
              onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="activity-quantity">
              Quantity
            </label>
            <input
              id="activity-quantity"
              className="enterprise-input"
              type="number"
              step="any"
              value={form.quantity}
              onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="activity-unit">
              Unit
            </label>
            <input
              id="activity-unit"
              className="enterprise-input"
              type="text"
              value={form.unit}
              onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="activity-evidence">
              Evidence link
            </label>
            <select
              id="activity-evidence"
              className="enterprise-input"
              value={form.evidenceId}
              onChange={(event) => setForm((current) => ({ ...current, evidenceId: event.target.value }))}
            >
              <option value="">No evidence</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>

            <label className="enterprise-label" htmlFor="activity-notes">
              Notes
            </label>
            <textarea
              id="activity-notes"
              className="enterprise-input"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Create activity"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
