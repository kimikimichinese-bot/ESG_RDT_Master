"use client";

import Link from "next/link";
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

const emptyForm = {
  siteId: "",
};

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

export default function EvidencePage() {
  const tenant = useTenantSession();
  const [items, setItems] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedFile, setSelectedFile] = useState(null);
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
      const [evidenceRes, sitesRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
      ]);

      const [evidencePayload, sitesPayload] = await Promise.all([
        evidenceRes.json().catch(() => ({})),
        sitesRes.json().catch(() => ({})),
      ]);

      if (!evidenceRes.ok) {
        throw new Error(extractErrorMessage(evidencePayload, `HTTP ${evidenceRes.status}`));
      }
      if (!sitesRes.ok) {
        throw new Error(extractErrorMessage(sitesPayload, `HTTP ${sitesRes.status}`));
      }

      setItems(Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence : []);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load evidence");
      setItems([]);
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
    setForm(emptyForm);
    setSelectedFile(null);
    setSuccessMessage("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setForm(emptyForm);
    setSelectedFile(null);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!tenant.tenantId) {
      return;
    }
    if (!selectedFile) {
      setError("Select a file before uploading.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (form.siteId) {
        formData.append("siteId", form.siteId);
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/upload`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
      }

      closeModal();
      setSuccessMessage("Evidence uploaded successfully.");
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to upload evidence");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (item) => {
    if (!tenant.tenantId) {
      return;
    }

    const confirmed = window.confirm(`Delete evidence \"${item.filename}\"?`);
    if (!confirmed) {
      return;
    }

    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
      }
      setSuccessMessage("Evidence deleted.");
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete evidence");
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Evidence Vault</h2>
          <p className="enterprise-muted">Upload files and keep metadata in tenant scope.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              <TooltipText text="Carica documento">Add evidence</TooltipText>
            </button>
          ) : null}
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {successMessage ? <p className="enterprise-status">{successMessage}</p> : null}
      {loading ? <p className="enterprise-status">Loading evidence...</p> : null}

      {!loading && items.length === 0 ? <div className="enterprise-empty">No evidence records yet.</div> : null}

      {!loading && items.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Size</th>
                <th>Site</th>
                <th>
                  <TooltipText text="Apri anteprima">Viewer</TooltipText>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.filename}</td>
                  <td>{item.contentType}</td>
                  <td>{item.sizeBytes}</td>
                  <td>{item.siteId ? siteMap.get(item.siteId) || "Unknown site" : "-"}</td>
                  <td>
                    <Link className="enterprise-button-secondary" href={`/app/evidence/${item.id}`}>
                      Open
                    </Link>
                  </td>
                  <td>
                    <div className="enterprise-inline-actions">
                      {canWrite ? (
                        <button className="enterprise-button-danger" type="button" onClick={() => void onDelete(item)}>
                          Delete
                        </button>
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
        <Modal title="Add evidence" onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={onSubmit}>
            <label className="enterprise-label" htmlFor="evidence-site">
              Site (optional)
            </label>
            <select
              id="evidence-site"
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

            <label className="enterprise-label" htmlFor="evidence-file">
              File
            </label>
            <input
              id="evidence-file"
              className="enterprise-input"
              type="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              required
            />

            {selectedFile ? (
              <p className="enterprise-muted" style={{ margin: 0 }}>
                Selected: {selectedFile.name}
              </p>
            ) : null}

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving || !selectedFile}>
                {saving ? "Uploading..." : <TooltipText text="Carica documento">Upload evidence</TooltipText>}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
