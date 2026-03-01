"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export default function HomePage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/projects", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }
      setProjects(Array.isArray(payload.projects) ? payload.projects : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand">ESG RDT</h1>
            <p className="esg-subtitle">ESG Assessment Workspace</p>
          </div>
          <nav className="esg-link-row" aria-label="Quick links">
            <Link className="esg-link-chip" href="/help">
              Help
            </Link>
            <Link className="esg-link-chip" href="/tools/url-analyzer">
              URL Analyzer Tool
            </Link>
          </nav>
        </header>

        <section className="esg-card esg-home-grid">
          <div className="esg-toolbar">
            <div>
              <h2 style={{ margin: 0 }}>Assessments</h2>
              <p className="esg-subtitle" style={{ marginBottom: 0 }}>
                Crea un progetto, compila parametri ESG E/S/G e torna a modificarli in qualsiasi momento.
              </p>
            </div>
            <div className="esg-inline-actions">
              <button className="esg-button-secondary" type="button" onClick={() => void loadProjects()}>
                Refresh list
              </button>
              <Link className="esg-button-link" href="/projects/new">
                New assessment
              </Link>
            </div>
          </div>

          {loading ? <p className="esg-status">Loading projects...</p> : null}
          {error ? <p className="esg-status esg-status-error">{error}</p> : null}

          {!loading && !error && projects.length === 0 ? (
            <div className="esg-empty">
              Nessun assessment presente. Crea il primo progetto ESG per iniziare la compilazione completa.
            </div>
          ) : null}

          {!loading && !error && projects.length > 0 ? (
            <div className="esg-list">
              {projects.map((project) => (
                <article key={project.id} className="esg-project-item">
                  <div>
                    <h3 className="esg-project-title">{project.name}</h3>
                    <p className="esg-project-meta" style={{ margin: "4px 0 0" }}>
                      Updated: {formatDateTime(project.updatedAt)} · Answers saved: {project.answerCount ?? 0}
                    </p>
                  </div>
                  <div className="esg-inline-actions">
                    <Link className="esg-button-secondary" href={`/projects/${project.id}`}>
                      Open wizard
                    </Link>
                    <Link className="esg-button-secondary" href={`/projects/${project.id}/report`}>
                      View report
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
