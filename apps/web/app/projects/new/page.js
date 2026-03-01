"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      const projectId = payload?.project?.id;
      if (!projectId) {
        throw new Error("Project created without id");
      }

      router.push(`/projects/${projectId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="esg-shell">
      <div className="esg-container">
        <header className="esg-topbar">
          <div>
            <h1 className="esg-brand">New Assessment</h1>
            <p className="esg-subtitle">Crea un nuovo progetto ESG RDT e avvia il wizard completo.</p>
          </div>
          <div className="esg-link-row">
            <Link className="esg-link-chip" href="/">
              Back to assessments
            </Link>
          </div>
        </header>

        <section className="esg-card" style={{ maxWidth: 720 }}>
          <form className="esg-grid" onSubmit={onSubmit}>
            <div>
              <label htmlFor="project-name" style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
                Project name
              </label>
              <input
                id="project-name"
                className="esg-input"
                type="text"
                placeholder="2026 ESG Baseline - Europe"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="esg-inline-actions">
              <button className="esg-button" type="submit" disabled={busy}>
                {busy ? "Creating..." : "Create assessment"}
              </button>
              <Link className="esg-button-secondary" href="/">
                Cancel
              </Link>
            </div>
          </form>

          {error ? <p className="esg-status esg-status-error">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
