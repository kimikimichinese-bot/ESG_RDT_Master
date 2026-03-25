"use client";

import { useCallback, useEffect, useState } from "react";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

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

const statusLabel = (value) => {
  if (value === "ok") {
    return "OK";
  }
  if (value === "warn") {
    return "Warn";
  }
  if (value === "down") {
    return "Down";
  }
  return value || "n/a";
};

const summarizeBenchmark = (entry) => {
  const results = Array.isArray(entry?.results) ? entry.results : [];
  const materiality = results.find((item) => item.label === "materiality_report");
  return materiality ? `materiality ${materiality.durationMs}ms` : "n/a";
};

export default function SystemCheckPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [progressRes, healthRes, readyRes] = await Promise.all([
        fetch("/api/v1/progress", { cache: "no-store" }),
        fetch("/api/health", { cache: "no-store" }),
        fetch("/api/ready", { cache: "no-store" }),
      ]);
      const [progress, health, ready] = await Promise.all([
        progressRes.json().catch(() => ({})),
        healthRes.json().catch(() => ({})),
        readyRes.json().catch(() => ({})),
      ]);
      if (!progressRes.ok || !healthRes.ok || !readyRes.ok) {
        throw new Error("Unable to load system checks");
      }
      setSnapshot({ progress, health, ready });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load system checks");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checks = Array.isArray(snapshot?.progress?.systemChecks) ? snapshot.progress.systemChecks : [];

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">System Check</h2>
          <p className="enterprise-muted">Pilot readiness, diagnostics status and latest smoke artifact.</p>
        </div>
        <button className="enterprise-button-secondary" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading system checks...</p> : null}

      {snapshot ? (
        <>
          <div className="enterprise-kpi-grid">
            <article className="enterprise-kpi-card">
              <strong>
                <TooltipText text="Stato applicazione">Health</TooltipText>
              </strong>
              <p>{snapshot.health?.status || "-"}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>
                <TooltipText text="Pronta all'uso">Ready</TooltipText>
              </strong>
              <p>{snapshot.ready?.status || "-"}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>
                <TooltipText text="Avanzamento sistema">Progress source</TooltipText>
              </strong>
              <p>{snapshot.progress?.progressSource?.status || "-"}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Last smoke</strong>
              <p>{snapshot.progress?.lastSmoke?.status || "missing"}</p>
            </article>
          </div>

          <div className="enterprise-card">
            <h3 style={{ marginTop: 0 }}>Core checks</h3>
            {checks.length === 0 ? (
              <div className="enterprise-empty">No system checks available.</div>
            ) : (
              <div className="enterprise-table-wrap">
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Status</th>
                      <th>Message</th>
                      <th>Remediation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((item) => (
                      <tr key={item.id}>
                        <td>{item.title}</td>
                        <td>{statusLabel(item.status)}</td>
                        <td>{item.message}</td>
                        <td>{item.remediation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="enterprise-card">
            <h3 style={{ marginTop: 0 }}>Latest smoke artifact</h3>
            <p className="enterprise-muted">
              Checked at {formatDateTime(snapshot.progress?.lastSmoke?.checkedAt)} · Request sample {snapshot.progress?.lastSmoke?.requestId || "-"}
            </p>
            <p className="enterprise-muted">
              Missing factors: {snapshot.progress?.lastSmoke?.missingFactorsCount ?? 0} · Missing evidence: {snapshot.progress?.lastSmoke?.evidenceCoverage?.missingCount ?? 0}
            </p>
          </div>

          <div className="enterprise-card">
            <h3 style={{ marginTop: 0 }}>
              <TooltipText text="Storico controlli">History</TooltipText>
            </h3>
            <div className="enterprise-table-wrap">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Run type</th>
                    <th>Checked at</th>
                    <th>
                      <TooltipText text="Stato operativo">Status</TooltipText>
                    </th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.progress?.smokeHistory || []).slice(0, 5).map((item, index) => (
                    <tr key={`smoke-${item.checkedAt || index}`}>
                      <td>
                        <TooltipText text="Test rapido">Smoke</TooltipText>
                      </td>
                      <td>{formatDateTime(item.checkedAt)}</td>
                      <td>{item.status || "-"}</td>
                      <td>{item.exportSmoke?.status || item.error || "-"}</td>
                    </tr>
                  ))}
                  {(snapshot.progress?.benchmarkHistory || []).slice(0, 5).map((item, index) => (
                    <tr key={`bench-${item.generatedAt || index}`}>
                      <td>
                        <TooltipText text="Misura performance">Benchmark</TooltipText>
                      </td>
                      <td>{formatDateTime(item.generatedAt)}</td>
                      <td>{item.status || "passed"}</td>
                      <td>{item.dataset || "small"} · {summarizeBenchmark(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
