"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasHealthContract, hasProgressContract, hasJobsContract, normalizeJobs, parseJsonResponse } from "@esg-rdt/ui/contracts.js";

const POLL_INTERVAL_MS = 6000;

const endpointCatalog = [
  { path: "/api/ready", href: "/api/ready", title: "Ready" },
  { path: "/api/v1/health", href: "/api/v1/health", title: "Health" },
  { path: "/api/v1/status", href: "/api/v1/status", title: "Status" },
  { path: "/api/v1/progress", href: "/api/v1/progress", title: "Progress" },
  { path: "/api/v1/jobs", href: "/api/v1/jobs", title: "Jobs" },
];

const statusToneFromSignal = (status) => {
  if (status === "ready" || status === "ok") {
    return "ok";
  }
  if (status === "warn" || status === "degraded") {
    return "warn";
  }
  return "error";
};

const jobTone = (status) => {
  if (status === "succeeded") {
    return "ok";
  }
  if (status === "running" || status === "queued") {
    return "warn";
  }
  return "error";
};

const meterPercent = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
};

export default function HomePage() {
  const [signals, setSignals] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [statusMessage, setStatusMessage] = useState("Refreshing status...");
  const [isWorking, setIsWorking] = useState(false);
  const [lastJobResult, setLastJobResult] = useState(null);

  const progressSignal = useMemo(() => {
    const match = signals.find((entry) => entry.path === "/api/v1/progress");
    if (!match || !match.payload || !match.contractOk) {
      return null;
    }

    return match.payload;
  }, [signals]);

  const overallProgress = useMemo(() => {
    if (!progressSignal || !Array.isArray(progressSignal.progress) || progressSignal.progress.length === 0) {
      return 0;
    }

    const total = progressSignal.progress.reduce((sum, area) => {
      const done = typeof area?.done === "number" ? area.done : 0;
      return sum + meterPercent(done);
    }, 0);

    return Math.round(total / progressSignal.progress.length);
  }, [progressSignal]);

  const refreshAll = useCallback(async () => {
    const results = [];

    for (const item of endpointCatalog) {
      try {
        const response = await parseJsonResponse(item.href);
        const payload = response.body;
        const contractOk =
          item.path === "/api/v1/progress"
            ? hasProgressContract(payload)
            : item.path === "/api/v1/jobs"
              ? hasJobsContract(payload)
              : hasHealthContract(payload);

        if (item.path === "/api/v1/jobs" && hasJobsContract(payload)) {
          setJobs(normalizeJobs(payload));
          setStatusMessage("Polling jobs from worker queue.");
        }

        results.push({
          path: item.path,
          title: item.title,
          status: response.status,
          ok: response.ok,
          timestamp: payload?.timestamp,
          contractOk,
          payload,
        });
      } catch (_error) {
        results.push({
          path: item.path,
          title: item.title,
          status: 0,
          ok: false,
          contractOk: false,
          payload: null,
        });
      }
    }

    setSignals(results);
  }, []);

  const triggerRefreshJob = async () => {
    setIsWorking(true);
    try {
      const payload = {
        jobType: "status",
        message: "Manual UI refresh job",
      };

      const response = await parseJsonResponse("/api/v1/jobs/trigger", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body || typeof response.body.id !== "string") {
        setLastJobResult("Failed to trigger job");
        return;
      }

      setLastJobResult(response.body.id);
      await refreshAll();
    } catch (_error) {
      setLastJobResult("Failed to trigger job");
    } finally {
      setIsWorking(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const timer = setInterval(refreshAll, POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [refreshAll]);

  return (
    <main style={{ padding: "1.5rem" }}>
      <section className="surface">
        <div className="toolbar">
          <div>
            <h1>ESG RDT Master</h1>
            <p style={{ marginTop: 8, color: "var(--muted)" }}>Production diagnostics with live worker jobs.</p>
          </div>
          <div className="toolbar-actions">
            <button
              className="refresh-button"
              type="button"
              onClick={() => void refreshAll()}
            >
              Refresh now
            </button>
            <button
              className="refresh-button"
              type="button"
              disabled={isWorking}
              onClick={() => void triggerRefreshJob()}
            >
              {isWorking ? "Submitting..." : "Trigger refresh job"}
            </button>
          </div>
        </div>
        {statusMessage ? <p style={{ marginTop: 8 }}>{statusMessage}</p> : null}
      </section>

      <section style={{ marginTop: 16 }} className="status-grid">
        {signals.map((signal) => {
          const tone =
            !signal.ok || !signal.contractOk
              ? "error"
              : statusToneFromSignal(signal.payload?.status || (signal.path === "/api/v1/jobs" ? "ok" : "ready"));

          return (
            <article key={signal.path} className="tile">
              <header className="tile-header">
                <strong>{signal.title}</strong>
                <span className={`status-pill status-${tone}`}>{tone}</span>
              </header>
              <p className="tile-detail">{signal.path}</p>
              <p className="tile-detail">HTTP {signal.status || "ERR"}</p>
              <p className="tile-detail">Contract: {signal.contractOk ? "valid" : "invalid"}</p>
              {signal.payload?.timestamp ? <p className="tile-detail">{signal.payload.timestamp}</p> : null}
            </article>
          );
        })}
      </section>

      <section className="surface" style={{ marginTop: 16 }}>
        <header className="module-meta">
          <h2 style={{ margin: 0 }}>Worker jobs</h2>
          <span>{jobs.length} jobs</span>
        </header>
        <div className="meter-wrap">
          <div className={`meter-fill meter-fill-${overallProgress > 85 ? "ok" : overallProgress > 45 ? "warn" : "error"}`} style={{ width: `${overallProgress}%` }} />
        </div>
        <p className="tile-detail">Live job progress: {overallProgress}%</p>

        {lastJobResult ? (
          <p className="tile-detail">Last trigger job id: <code>{lastJobResult}</code></p>
        ) : null}

        <ul style={{ paddingLeft: "1rem", marginTop: 8 }}>
          {jobs.slice(0, 8).map((job) => {
            const tone = jobTone(job.status);
            return (
              <li key={job.id} style={{ marginBottom: 10 }}>
                <div className="module-meta" style={{ alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className={`status-pill status-${tone}`}>{job.status}</span>
                    <strong>{job.jobType}</strong>
                  </div>
                  <span className="tile-detail">{meterPercent(job.progress)}%</span>
                </div>
                <div className="meter-wrap">
                  <div className={`meter-fill meter-fill-${tone === "ok" ? "ok" : tone === "warn" ? "warn" : "error"}`} style={{ width: `${meterPercent(job.progress)}%` }} />
                </div>
                <p className="tile-detail">{job.message || "No message"}</p>
                <p className="tile-detail">{job.updatedAt ? new Date(job.updatedAt).toLocaleTimeString() : ""}</p>
              </li>
            );
          })}
          {jobs.length === 0 ? <li className="tile-detail">No jobs in queue. Trigger one to create activity.</li> : null}
        </ul>
      </section>
    </main>
  );
}
