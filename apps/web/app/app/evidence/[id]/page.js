"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../../_components/modal";
import { useTenantSession } from "../../_components/use-tenant-session";

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

export default function EvidenceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const evidenceId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const tenant = useTenantSession();

  const [item, setItem] = useState(null);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    filename: "",
    siteId: "",
    issueDate: "",
    docType: "other",
    scopeCoverage: "tenant",
    isEncrypted: false,
    language: "",
  });

  const canWrite = useMemo(
    () =>
      !tenant.impersonationReadOnly &&
      (tenant.platformRole === "superadmin" || tenant.role === "TenantAdmin" || tenant.role === "Manager"),
    [tenant.impersonationReadOnly, tenant.platformRole, tenant.role],
  );

  const loadEvidence = useCallback(async () => {
    if (!tenant.tenantId || !evidenceId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [evidenceResponse, sitesResponse] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(evidenceId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
      ]);
      const [evidencePayload, sitesPayload] = await Promise.all([
        evidenceResponse.json().catch(() => ({})),
        sitesResponse.json().catch(() => ({})),
      ]);
      if (!evidenceResponse.ok) {
        throw new Error(extractErrorMessage(evidencePayload, `HTTP ${evidenceResponse.status}`));
      }
      if (!sitesResponse.ok) {
        throw new Error(extractErrorMessage(sitesPayload, `HTTP ${sitesResponse.status}`));
      }

      const nextItem = evidencePayload.evidence || null;
      setItem(nextItem);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
      setForm({
        filename: nextItem?.filename || "",
        siteId: nextItem?.siteId || "",
        issueDate: nextItem?.issueDate || "",
        docType: nextItem?.docType || "other",
        scopeCoverage: nextItem?.scopeCoverage || "tenant",
        isEncrypted: nextItem?.isEncrypted === true,
        language: nextItem?.language || "",
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load evidence");
      setItem(null);
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId, evidenceId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && evidenceId) {
      void loadEvidence();
    }
  }, [tenant.loading, tenant.tenantId, evidenceId, loadEvidence]);

  const canRenderPdf = Boolean(
    item?.previewUrl && typeof item.contentType === "string" && item.contentType.toLowerCase().includes("pdf"),
  );

  const onSave = async (event) => {
    event.preventDefault();
    if (!tenant.tenantId || !item) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(item.id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: form.filename.trim(),
            siteId: form.siteId || null,
            contentType: item.contentType,
            sizeBytes: item.sizeBytes,
            sha256: item.sha256,
            blobUrl: item.blobUrl,
            storageBackend: item.storageBackend,
            issueDate: form.issueDate || null,
            docType: form.docType || null,
            scopeCoverage: form.scopeCoverage || null,
            isEncrypted: form.isEncrypted === true,
            language: form.language.trim() || null,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
      }
      setModalOpen(false);
      setSuccessMessage("Evidence metadata updated.");
      await loadEvidence();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update evidence");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!tenant.tenantId || !item) {
      return;
    }
    const confirmed = window.confirm(`Delete evidence "${item.filename}"?`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
      }
      router.push("/app/evidence");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete evidence");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Evidence detail</h2>
          <p className="enterprise-muted">Metadata and secure viewer for the selected evidence.</p>
        </div>
        <div className="enterprise-inline-actions">
          <Link className="enterprise-button-secondary" href="/app/evidence">
            Back to evidence
          </Link>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {successMessage ? <p className="enterprise-status">{successMessage}</p> : null}
      {loading ? <p className="enterprise-status">Loading evidence detail...</p> : null}

      {!loading && !item ? <div className="enterprise-empty">Evidence not found.</div> : null}

      {!loading && item ? (
        <>
          <section className="enterprise-card">
            <h3>{item.filename}</h3>
            <p className="enterprise-muted">Type: {item.contentType}</p>
            <p className="enterprise-muted">Size: {item.sizeBytes}</p>
            <p className="enterprise-muted">SHA256: {item.sha256 || "-"}</p>
            <p className="enterprise-muted">Storage backend: {item.storageBackend || "vercel_blob"}</p>
            <p className="enterprise-muted">Storage status: {item.storageStatus || "available"}</p>
            <p className="enterprise-muted">Legacy blob URL: {item.blobUrl || "-"}</p>
            <div className="enterprise-inline-actions">
              {item.previewUrl ? (
                <a className="enterprise-button-secondary" href={item.previewUrl} target="_blank" rel="noreferrer noopener">
                  Preview
                </a>
              ) : null}
              {item.downloadUrl ? (
                <a className="enterprise-button-secondary" href={item.downloadUrl}>
                  Download
                </a>
              ) : null}
              {canWrite ? (
                <button className="enterprise-button-secondary" type="button" onClick={() => setModalOpen(true)}>
                  Edit metadata
                </button>
              ) : null}
              {canWrite ? (
                <button className="enterprise-button-danger" type="button" onClick={() => void onDelete()} disabled={deleting}>
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              ) : null}
            </div>
            <p className="enterprise-muted">File replacement is not supported on this record. Upload a new evidence item if the binary changes.</p>
          </section>

          <section className="enterprise-card">
            <h3>PDF viewer</h3>
            {canRenderPdf ? (
              <iframe
                title="Evidence PDF"
                className="enterprise-pdf-viewer"
                src={item.previewUrl}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="enterprise-empty">No controlled PDF preview is available for this evidence.</div>
            )}
          </section>
        </>
      ) : null}

      {modalOpen && item ? (
        <Modal title="Edit evidence metadata" onClose={() => setModalOpen(false)}>
          <form className="enterprise-form-grid" onSubmit={onSave}>
            <label className="enterprise-label" htmlFor="detail-evidence-filename">
              Filename
            </label>
            <input
              id="detail-evidence-filename"
              className="enterprise-input"
              value={form.filename}
              onChange={(event) => setForm((current) => ({ ...current, filename: event.target.value }))}
              required
            />

            <label className="enterprise-label" htmlFor="detail-evidence-site">
              Site (optional)
            </label>
            <select
              id="detail-evidence-site"
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

            <label className="enterprise-label" htmlFor="detail-evidence-issue-date">
              Issue date
            </label>
            <input
              id="detail-evidence-issue-date"
              className="enterprise-input"
              type="date"
              value={form.issueDate}
              onChange={(event) => setForm((current) => ({ ...current, issueDate: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="detail-evidence-doc-type">
              Document type
            </label>
            <select
              id="detail-evidence-doc-type"
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

            <label className="enterprise-label" htmlFor="detail-evidence-coverage">
              Coverage
            </label>
            <select
              id="detail-evidence-coverage"
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

            <label className="enterprise-label" htmlFor="detail-evidence-language">
              Language
            </label>
            <input
              id="detail-evidence-language"
              className="enterprise-input"
              value={form.language}
              onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
            />

            <label className="enterprise-label" htmlFor="detail-evidence-encrypted">
              Encrypted
            </label>
            <input
              id="detail-evidence-encrypted"
              type="checkbox"
              checked={form.isEncrypted}
              onChange={(event) => setForm((current) => ({ ...current, isEncrypted: event.target.checked }))}
            />

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save metadata"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
