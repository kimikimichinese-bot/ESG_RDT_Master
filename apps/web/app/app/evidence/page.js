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
  filename: "",
  siteId: "",
  reportingYear: String(new Date().getUTCFullYear()),
  moduleName: "",
  categoryName: "",
  issueDate: "",
  docType: "other",
  scopeCoverage: "tenant",
  isEncrypted: false,
  language: "",
};

const DOC_TYPE_OPTIONS = [
  { value: "policy", label: "Policy" },
  { value: "action", label: "Action" },
  { value: "reporting", label: "Reporting" },
  { value: "audit", label: "Audit" },
  { value: "certification", label: "Certification" },
  { value: "other", label: "Other" },
];

const COVERAGE_OPTIONS = [
  { value: "tenant", label: "Tenant" },
  { value: "company", label: "Company" },
  { value: "site", label: "Site" },
];

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
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedFile, setSelectedFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const canWrite = useMemo(
    () =>
      !tenant.impersonationReadOnly &&
      (tenant.role === "TenantAdmin" || tenant.role === "Manager" || tenant.platformRole === "superadmin"),
    [tenant.impersonationReadOnly, tenant.platformRole, tenant.role],
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
    setEditing(null);
    setForm(emptyForm);
    setSelectedFile(null);
    setSuccessMessage("");
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      filename: item.filename || "",
      siteId: item.siteId || "",
      reportingYear: String(new Date().getUTCFullYear()),
      moduleName: "",
      categoryName: "",
      issueDate: item.issueDate || "",
      docType: item.docType || "other",
      scopeCoverage: item.scopeCoverage || "tenant",
      isEncrypted: item.isEncrypted === true,
      language: item.language || "",
    });
    setSelectedFile(null);
    setSuccessMessage("");
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
    if (!editing && !selectedFile) {
      setError("Select a file before uploading.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      let response;
      if (editing) {
        response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(editing.id)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              filename: form.filename.trim(),
              siteId: form.siteId || null,
              contentType: editing.contentType,
              sizeBytes: editing.sizeBytes,
              sha256: editing.sha256,
              blobUrl: editing.blobUrl,
              storageBackend: editing.storageBackend,
              issueDate: form.issueDate || null,
              docType: form.docType || null,
              scopeCoverage: form.scopeCoverage || null,
              isEncrypted: form.isEncrypted === true,
              language: form.language.trim() || null,
            }),
          },
        );
      } else {
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (form.siteId) {
          formData.append("siteId", form.siteId);
        }
        if (form.issueDate) {
          formData.append("issueDate", form.issueDate);
        }
        if (form.reportingYear.trim()) {
          formData.append("reportingYear", form.reportingYear.trim());
        }
        if (form.moduleName.trim()) {
          formData.append("moduleName", form.moduleName.trim());
        }
        if (form.categoryName.trim()) {
          formData.append("categoryName", form.categoryName.trim());
        }
        if (form.docType) {
          formData.append("docType", form.docType);
        }
        if (form.scopeCoverage) {
          formData.append("scopeCoverage", form.scopeCoverage);
        }
        formData.append("isEncrypted", String(form.isEncrypted === true));
        if (form.language.trim()) {
          formData.append("language", form.language.trim());
        }

        response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/upload`, {
          method: "POST",
          body: formData,
        });
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
      }

      closeModal();
      setSuccessMessage(editing ? "Evidence metadata updated." : "Evidence uploaded successfully.");
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : editing ? "Unable to update evidence" : "Unable to upload evidence");
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
        <Modal title={editing ? "Edit evidence metadata" : "Add evidence"} onClose={closeModal}>
          <form className="enterprise-form-grid" onSubmit={onSubmit}>
            {editing ? (
              <>
                <label className="enterprise-label" htmlFor="evidence-filename">
                  Filename
                </label>
                <input
                  id="evidence-filename"
                  className="enterprise-input"
                  value={form.filename}
                  onChange={(event) => setForm((current) => ({ ...current, filename: event.target.value }))}
                  required
                />
              </>
            ) : null}

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

            <label className="enterprise-label" htmlFor="evidence-issue-date">
              Issue date
            </label>
            <input
              id="evidence-issue-date"
              className="enterprise-input"
              type="date"
              value={form.issueDate}
              onChange={(event) => setForm((current) => ({ ...current, issueDate: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="evidence-reporting-year">
              Reporting year
            </label>
            <input
              id="evidence-reporting-year"
              className="enterprise-input"
              value={form.reportingYear}
              onChange={(event) => setForm((current) => ({ ...current, reportingYear: event.target.value }))}
              placeholder="2026"
            />

            <label className="enterprise-label" htmlFor="evidence-module">
              Module
            </label>
            <input
              id="evidence-module"
              className="enterprise-input"
              value={form.moduleName}
              onChange={(event) => setForm((current) => ({ ...current, moduleName: event.target.value }))}
              placeholder="GHG Scope 2, Governance, Social..."
            />

            <label className="enterprise-label" htmlFor="evidence-category">
              Category
            </label>
            <input
              id="evidence-category"
              className="enterprise-input"
              value={form.categoryName}
              onChange={(event) => setForm((current) => ({ ...current, categoryName: event.target.value }))}
              placeholder="Energy Bills, Policies, Workforce..."
            />

            <label className="enterprise-label" htmlFor="evidence-doc-type">
              Document type
            </label>
            <select
              id="evidence-doc-type"
              className="enterprise-input"
              value={form.docType}
              onChange={(event) => setForm((current) => ({ ...current, docType: event.target.value }))}
            >
              {DOC_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="enterprise-label" htmlFor="evidence-coverage">
              Coverage
            </label>
            <select
              id="evidence-coverage"
              className="enterprise-input"
              value={form.scopeCoverage}
              onChange={(event) => setForm((current) => ({ ...current, scopeCoverage: event.target.value }))}
            >
              {COVERAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="enterprise-label" htmlFor="evidence-language">
              Language
            </label>
            <input
              id="evidence-language"
              className="enterprise-input"
              value={form.language}
              onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
              placeholder="en, it, fr..."
            />

            <label className="enterprise-label" htmlFor="evidence-encrypted">
              Encrypted
            </label>
            <input
              id="evidence-encrypted"
              type="checkbox"
              checked={form.isEncrypted}
              onChange={(event) => setForm((current) => ({ ...current, isEncrypted: event.target.checked }))}
            />

            {!editing ? (
              <>
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
              </>
            ) : (
              <p className="enterprise-muted" style={{ margin: 0 }}>
                File replacement is not supported on this record. Upload a new evidence item if the binary changes.
              </p>
            )}

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving || (!editing && !selectedFile)}>
                {saving ? "Saving..." : editing ? "Save metadata" : <TooltipText text="Carica documento">Upload evidence</TooltipText>}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
