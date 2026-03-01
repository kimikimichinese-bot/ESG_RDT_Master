"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";

const emptyForm = { name: "", country: "", address: "" };

export default function SitesPage() {
  const tenant = useTenantSession();
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canWrite = useMemo(
    () => tenant.role === "TenantAdmin" || tenant.role === "Manager",
    [tenant.role],
  );

  const loadSites = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setSites(Array.isArray(payload.sites) ? payload.sites : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load sites");
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadSites();
    }
  }, [tenant.loading, tenant.tenantId, loadSites]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (site) => {
    setEditing(site);
    setForm({ name: site.name || "", country: site.country || "", address: site.address || "" });
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
        ? `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites/${encodeURIComponent(editing.id)}`
        : `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`;
      const method = editing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      closeModal();
      await loadSites();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save site");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (site) => {
    if (!tenant.tenantId) {
      return;
    }

    const confirmed = window.confirm(`Delete site \"${site.name}\"?`);
    if (!confirmed) {
      return;
    }

    setError("");
    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites/${encodeURIComponent(site.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      await loadSites();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete site");
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Sites</h2>
          <p className="enterprise-muted">Multi-site registry for the active tenant.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadSites()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              New site
            </button>
          ) : null}
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading sites...</p> : null}

      {!loading && sites.length === 0 ? <div className="enterprise-empty">No sites found for this tenant.</div> : null}

      {!loading && sites.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th>Address</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id}>
                  <td>{site.name}</td>
                  <td>{site.country || "-"}</td>
                  <td>{site.address || "-"}</td>
                  <td>
                    <div className="enterprise-inline-actions">
                      {canWrite ? (
                        <>
                          <button className="enterprise-button-secondary" type="button" onClick={() => openEdit(site)}>
                            Edit
                          </button>
                          <button className="enterprise-button-danger" type="button" onClick={() => void onDelete(site)}>
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
        <Modal title={editing ? "Edit site" : "Create site"} onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={onSubmit}>
            <label className="enterprise-label" htmlFor="site-name">
              Name
            </label>
            <input
              id="site-name"
              className="enterprise-input"
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="site-country">
              Country
            </label>
            <input
              id="site-country"
              className="enterprise-input"
              type="text"
              value={form.country}
              onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="site-address">
              Address
            </label>
            <textarea
              id="site-address"
              className="enterprise-input"
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            />

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Create site"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
