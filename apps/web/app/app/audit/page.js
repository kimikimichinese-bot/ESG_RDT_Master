"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenantSession } from "../_components/use-tenant-session";

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function AuditPage() {
  const tenant = useTenantSession();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAudit = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/audit?tenantId=${encodeURIComponent(tenant.tenantId)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load audit log");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadAudit();
    }
  }, [tenant.loading, tenant.tenantId, loadAudit]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Audit log</h2>
          <p className="enterprise-muted">Append-only trace of write operations for this tenant.</p>
        </div>
        <button className="enterprise-button-secondary" type="button" onClick={() => void loadAudit()}>
          Refresh
        </button>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading audit events...</p> : null}

      {!loading && entries.length === 0 ? <div className="enterprise-empty">No audit entries yet.</div> : null}

      {!loading && entries.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.actorUserId || "system"}</td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.entityType} · {entry.entityId}
                  </td>
                  <td>
                    <pre className="enterprise-pre">{JSON.stringify(entry.payload || {}, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
