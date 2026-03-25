"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTenantSession } from "../../_components/use-tenant-session";

export default function EvidenceDetailPage() {
  const params = useParams();
  const evidenceId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const tenant = useTenantSession();

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEvidence = useCallback(async () => {
    if (!tenant.tenantId || !evidenceId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/${encodeURIComponent(evidenceId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setItem(payload.evidence || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load evidence");
      setItem(null);
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
            </div>
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
    </section>
  );
}
