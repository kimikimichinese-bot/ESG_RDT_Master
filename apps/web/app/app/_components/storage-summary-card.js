"use client";

import Link from "next/link";
import {
  BACKUP_PROFILE_OPTIONS,
  DOWNLOAD_ACCESS_MODE_OPTIONS,
  HEALTH_TONE,
  MIGRATION_MODE_OPTIONS,
  MIGRATION_STATUS_OPTIONS,
  STORAGE_BACKEND_OPTIONS,
  formatStorageOptionLabel,
} from "../../_lib/storage-config";

const formatDateTime = (value) => {
  if (!value) {
    return "Not checked yet";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not checked yet";
  }
  return parsed.toLocaleString();
};

export default function StorageSummaryCard({ summary, href = "", compact = false }) {
  if (!summary) {
    return null;
  }

  const healthTone = HEALTH_TONE[summary.repositoryHealth] || "warn";
  const statusClass =
    healthTone === "ok" ? "enterprise-status enterprise-status-ok" : healthTone === "error"
      ? "enterprise-status enterprise-status-error"
      : "enterprise-status enterprise-status-warn";

  return (
    <section className={`enterprise-card ${compact ? "storage-summary-card-compact" : "storage-summary-card"}`}>
      <div className="storage-summary-header">
        <div>
          <h3>Summary</h3>
          <p className="enterprise-muted">Current storage posture for this tenant.</p>
        </div>
        <span className={statusClass}>Health: {summary.repositoryHealth || "warning"}</span>
      </div>

      <div className="storage-summary-grid">
        <div>
          <strong>Primary storage</strong>
          <p>{summary.primaryStorage || "-"}</p>
        </div>
        <div>
          <strong>Scope</strong>
          <p>{summary.scope || "-"}</p>
        </div>
        <div>
          <strong>Default backend</strong>
          <p>{formatStorageOptionLabel(STORAGE_BACKEND_OPTIONS, summary.defaultBackend)}</p>
        </div>
        <div>
          <strong>Access mode</strong>
          <p>{formatStorageOptionLabel(DOWNLOAD_ACCESS_MODE_OPTIONS, summary.accessMode)}</p>
        </div>
        <div>
          <strong>Backup profile</strong>
          <p>{formatStorageOptionLabel(BACKUP_PROFILE_OPTIONS, summary.backupProfile)}</p>
        </div>
        <div>
          <strong>Last connection check</strong>
          <p>{formatDateTime(summary.lastConnectionCheck)}</p>
        </div>
        <div>
          <strong>Evidence records using this backend</strong>
          <p>{summary.evidenceRecordsUsingBackend == null ? "Not tracked yet" : summary.evidenceRecordsUsingBackend}</p>
        </div>
        <div>
          <strong>Migration mode</strong>
          <p>{formatStorageOptionLabel(MIGRATION_MODE_OPTIONS, summary.migrationMode)}</p>
        </div>
        <div>
          <strong>Migration status</strong>
          <p>{formatStorageOptionLabel(MIGRATION_STATUS_OPTIONS, summary.migrationStatus)}</p>
        </div>
      </div>

      {Array.isArray(summary.notes) && summary.notes.length > 0 ? (
        <div className="storage-summary-notes">
          {summary.notes.map((note) => (
            <p key={note} className="enterprise-muted">
              {note}
            </p>
          ))}
        </div>
      ) : null}

      {href ? (
        <div className="enterprise-inline-actions">
          <Link href={href} className="enterprise-button-secondary">
            Open configuration
          </Link>
        </div>
      ) : null}
    </section>
  );
}
