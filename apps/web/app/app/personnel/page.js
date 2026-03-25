"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const emptyForm = { fullName: "", email: "", title: "", siteIds: [] };

const extractErrorMessage = (payload, fallback) => {
  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }
  return fallback;
};

const normalizeSiteIds = (person) => {
  if (Array.isArray(person?.siteIds)) {
    return person.siteIds.filter((item, index, source) => typeof item === "string" && item && source.indexOf(item) === index);
  }
  if (typeof person?.siteId === "string" && person.siteId) {
    return [person.siteId];
  }
  return [];
};

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

      if (!peopleRes.ok) {
        throw new Error(extractErrorMessage(peoplePayload, `HTTP ${peopleRes.status}`));
      }
      if (!sitesRes.ok) {
        throw new Error(extractErrorMessage(sitesPayload, `HTTP ${sitesRes.status}`));
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
      siteIds: normalizeSiteIds(person),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const toggleSite = (siteId) => {
    setForm((current) => {
      if (current.siteIds.includes(siteId)) {
        return { ...current, siteIds: current.siteIds.filter((item) => item !== siteId) };
      }
      return { ...current, siteIds: [...current.siteIds, siteId] };
    });
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
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
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
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
      }
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete person");
    }
  };

  const renderSites = (person) => {
    const ids = normalizeSiteIds(person);
    if (ids.length === 0) {
      return "-";
    }
    return ids.map((siteId) => siteMap.get(siteId) || "Unknown site").join(", ");
  };

  const selectedSiteSummary =
    form.siteIds.length === 0
      ? "No site"
      : form.siteIds.map((siteId) => siteMap.get(siteId) || "Unknown site").join(", ");

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Personnel</h2>
          <p className="enterprise-muted">Tenant workforce, roles and multi-site assignment.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              <TooltipText text="Aggiungi una persona">Add person</TooltipText>
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
                <th>Sites</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>{person.fullName}</td>
                  <td>{person.email || "-"}</td>
                  <td>{person.title || "-"}</td>
                  <td>{renderSites(person)}</td>
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

            <label className="enterprise-label">Sites</label>
            <div className="enterprise-grid" style={{ gap: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.siteIds.length === 0}
                  onChange={() => setForm((current) => ({ ...current, siteIds: [] }))}
                />
                <span>No site</span>
              </label>
              {sites.map((site) => (
                <label key={site.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.siteIds.includes(site.id)}
                    onChange={() => toggleSite(site.id)}
                  />
                  <span>{site.name}</span>
                </label>
              ))}
              <p className="enterprise-muted" style={{ margin: 0 }}>
                Selected: {selectedSiteSummary}
              </p>
            </div>

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
