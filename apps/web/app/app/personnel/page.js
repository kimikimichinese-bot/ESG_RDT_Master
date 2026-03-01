"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";

const emptyForm = { fullName: "", email: "", title: "", siteId: "" };

export default function PersonnelPage() {
  const tenant = useTenantSession();
  const [people, setPeople] = useState([]);
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

  const loadData = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [peopleRes, sitesRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/people`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
      ]);

      const [peoplePayload, sitesPayload] = await Promise.all([
        peopleRes.json().catch(() => ({})),
        sitesRes.json().catch(() => ({})),
      ]);

      if (!peopleRes.ok || !sitesRes.ok) {
        throw new Error("Failed to load personnel data");
      }

      setPeople(Array.isArray(peoplePayload.people) ? peoplePayload.people : []);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load personnel");
      setPeople([]);
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId]);

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

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (person) => {
    setEditing(person);
    setForm({
      fullName: person.fullName || "",
      email: person.email || "",
      title: person.title || "",
      siteId: person.siteId || "",
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
        ? `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/people/${encodeURIComponent(editing.id)}`
        : `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/people`;
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
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save person");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (person) => {
    if (!tenant.tenantId) {
      return;
    }

    const confirmed = window.confirm(`Delete person \"${person.fullName}\"?`);
    if (!confirmed) {
      return;
    }

    setError("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/people/${encodeURIComponent(person.id)}`,
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
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete person");
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Personnel</h2>
          <p className="enterprise-muted">Tenant workforce, roles and optional site assignment.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              Add person
            </button>
          ) : null}
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading personnel...</p> : null}

      {!loading && people.length === 0 ? <div className="enterprise-empty">No personnel records yet.</div> : null}

      {!loading && people.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Title</th>
                <th>Site</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>{person.fullName}</td>
                  <td>{person.email || "-"}</td>
                  <td>{person.title || "-"}</td>
                  <td>{person.siteId ? siteMap.get(person.siteId) || "Unknown site" : "-"}</td>
                  <td>
                    <div className="enterprise-inline-actions">
                      {canWrite ? (
                        <>
                          <button className="enterprise-button-secondary" type="button" onClick={() => openEdit(person)}>
                            Edit
                          </button>
                          <button className="enterprise-button-danger" type="button" onClick={() => void onDelete(person)}>
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
        <Modal title={editing ? "Edit person" : "Add person"} onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={onSubmit}>
            <label className="enterprise-label" htmlFor="person-fullname">
              Full name
            </label>
            <input
              id="person-fullname"
              className="enterprise-input"
              type="text"
              value={form.fullName}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="person-email">
              Email
            </label>
            <input
              id="person-email"
              className="enterprise-input"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="person-title">
              Title
            </label>
            <input
              id="person-title"
              className="enterprise-input"
              type="text"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="person-site">
              Site
            </label>
            <select
              id="person-site"
              className="enterprise-input"
              value={form.siteId}
              onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}
            >
              <option value="">No site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Create person"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
