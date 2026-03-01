"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function ProjectReportPage() {
  const params = useParams();
  const projectId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    if (!projectId) {
      setError("Missing project id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/report`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }
      setReport(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const downloadJson = () => {
    if (!report || !projectId) {
      return;
    }

    const payload = JSON.stringify(report, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectId}-report.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand">Assessment report</h1>
            <p className="esg-subtitle">Riepilogo completezza ESG con gap dei campi obbligatori.</p>
          </div>
          <div className="esg-link-row">
            <Link className="esg-link-chip" href="/app/assessments">
              Back to assessments
            </Link>
            {projectId ? (
              <Link className="esg-link-chip" href={`/projects/${projectId}`}>
                Back to wizard
              </Link>
            ) : null}
          </div>
        </header>

        <section className="esg-card">
          <div className="esg-toolbar">
            <h2 style={{ margin: 0 }}>{report?.project?.name || "Project report"}</h2>
            <div className="esg-inline-actions">
              <button className="esg-button-secondary" type="button" onClick={() => void loadReport()}>
                Refresh report
              </button>
              <button className="esg-button" type="button" onClick={downloadJson} disabled={!report}>
                Export JSON
              </button>
            </div>
          </div>

          {loading ? <p className="esg-status">Loading report...</p> : null}
          {error ? <p className="esg-status esg-status-error">{error}</p> : null}

          {!loading && !error && report ? (
            <div className="esg-grid" style={{ marginTop: 12 }}>
              <div className="esg-report-grid">
                <article className="esg-report-tile">
                  <strong>Completeness</strong>
                  <p style={{ margin: "6px 0 0" }}>{report.completenessPercent}%</p>
                </article>
                <article className="esg-report-tile">
                  <strong>Required answered</strong>
                  <p style={{ margin: "6px 0 0" }}>
                    {report.totals.requiredAnswered}/{report.totals.required}
                  </p>
                </article>
                <article className="esg-report-tile">
                  <strong>Total answers</strong>
                  <p style={{ margin: "6px 0 0" }}>{report.totals.answered}</p>
                </article>
                <article className="esg-report-tile">
                  <strong>Generated</strong>
                  <p style={{ margin: "6px 0 0" }}>{formatDateTime(report.generatedAt)}</p>
                </article>
              </div>

              <section className="esg-card" style={{ padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>Category summary</h3>
                <div className="esg-report-grid">
                  {(Array.isArray(report.categorySummary) ? report.categorySummary : []).map((item) => (
                    <article key={item.category} className="esg-report-tile">
                      <strong>{item.category}</strong>
                      <p style={{ margin: "6px 0 0" }}>
                        Required: {item.requiredAnswered}/{item.required}
                      </p>
                      <p style={{ margin: "4px 0 0" }}>Completeness: {item.completenessPercent}%</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="esg-card" style={{ padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>Missing required fields</h3>
                {Array.isArray(report.missingRequired) && report.missingRequired.length > 0 ? (
                  <ul className="esg-missing-list">
                    {report.missingRequired.map((item) => (
                      <li key={item.key}>
                        <strong>{item.category}</strong> · {item.label}
                        {item.description ? ` - ${item.description}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="esg-status" style={{ marginBottom: 0 }}>
                    Tutti i campi obbligatori risultano compilati.
                  </p>
                )}
              </section>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
