"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";

const emptyForm = {
  filename: "",
  contentType: "application/pdf",
  sizeBytes: "0",
  sha256: "",
  blobUrl: "",
  siteId: "",
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = value.indexOf(",");
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });

export default function EvidencePage() {
  const tenant = useTenantSession();
  const [items, setItems] = useState([]);
  const [sites, setSites] = useState([]);
  const [blobEnabled, setBlobEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
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

      if (!evidenceRes.ok || !sitesRes.ok) {
        throw new Error("Failed to load evidence");
      }

      setItems(Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence : []);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
      setBlobEnabled(Boolean(evidencePayload.blobEnabled));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load evidence");
      setItems([]);
      setSites([]);
      setBlobEnabled(false);
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
    setSelectedFile(null);
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      filename: item.filename || "",
      contentType: item.contentType || "application/pdf",
      sizeBytes: item.sizeBytes != null ? String(item.sizeBytes) : "0",
      sha256: item.sha256 || "",
      blobUrl: item.blobUrl || "",
      siteId: item.siteId || "",
    });
    setSelectedFile(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setSelectedFile(null);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!tenant.tenantId) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editing) {
        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(editing.id)}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              ...form,
              sizeBytes: Number(form.sizeBytes),
              siteId: form.siteId || null,
            }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
      } else if (selectedFile) {
        const uploadMetaRes = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/upload-url`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ filename: selectedFile.name }),
          },
        );
        const uploadMetaPayload = await uploadMetaRes.json().catch(() => ({}));
        if (!uploadMetaRes.ok) {
          throw new Error(uploadMetaPayload?.error || `HTTP ${uploadMetaRes.status}`);
        }

        const fileBase64 = await fileToBase64(selectedFile);
        const completeRes = await fetch(uploadMetaPayload.uploadUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            filename: selectedFile.name,
            contentType: selectedFile.type || form.contentType || "application/pdf",
            sizeBytes: selectedFile.size,
            siteId: form.siteId || null,
            fileBase64,
          }),
        });
        const completePayload = await completeRes.json().catch(() => ({}));
        if (!completeRes.ok) {
          throw new Error(completePayload?.error || `HTTP ${completeRes.status}`);
        }
      } else {
        const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...form,
            sizeBytes: Number(form.sizeBytes),
            siteId: form.siteId || null,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
      }

      closeModal();
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save evidence");
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

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(item.id)}`,
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
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete evidence");
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Evidence Vault</h2>
          <p className="enterprise-muted">Document metadata, blob references and PDF viewing.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={openCreate}>
              Add evidence
            </button>
          ) : null}
        </div>
      </div>

      {!blobEnabled ? (
        <div className="enterprise-warning">Uploads disabled until BLOB_READ_WRITE_TOKEN is set.</div>
      ) : null}

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
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
                <th>Viewer</th>
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
                        <>
                          <button className="enterprise-button-secondary" type="button" onClick={() => openEdit(item)}>
                            Edit
                          </button>
                          <button className="enterprise-button-danger" type="button" onClick={() => void onDelete(item)}>
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
        <Modal title={editing ? "Edit evidence" : "Add evidence"} onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={onSubmit}>
            <label className="enterprise-label" htmlFor="evidence-filename">
              Filename
            </label>
            <input
              id="evidence-filename"
              className="enterprise-input"
              type="text"
              value={form.filename}
              onChange={(event) => setForm((current) => ({ ...current, filename: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="evidence-content-type">
              Content type
            </label>
            <input
              id="evidence-content-type"
              className="enterprise-input"
              type="text"
              value={form.contentType}
              onChange={(event) => setForm((current) => ({ ...current, contentType: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="evidence-site">
              Site
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

            {!editing ? (
              <>
                <label className="enterprise-label" htmlFor="evidence-file">
                  File upload
                </label>
                <input
                  id="evidence-file"
                  className="enterprise-input"
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                  disabled={!blobEnabled}
                />
              </>
            ) : null}

            <label className="enterprise-label" htmlFor="evidence-size">
              Size bytes
            </label>
            <input
              id="evidence-size"
              className="enterprise-input"
              type="number"
              value={form.sizeBytes}
              onChange={(event) => setForm((current) => ({ ...current, sizeBytes: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="evidence-sha">
              SHA256
            </label>
            <input
              id="evidence-sha"
              className="enterprise-input"
              type="text"
              value={form.sha256}
              onChange={(event) => setForm((current) => ({ ...current, sha256: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="evidence-blob-url">
              Blob URL
            </label>
            <input
              id="evidence-blob-url"
              className="enterprise-input"
              type="url"
              value={form.blobUrl}
              onChange={(event) => setForm((current) => ({ ...current, blobUrl: event.target.value }))}
            />

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Create evidence"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
