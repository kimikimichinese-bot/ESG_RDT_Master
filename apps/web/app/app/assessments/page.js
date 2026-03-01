"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useTenantSession } from "../_components/use-tenant-session";

const emptyForm = {
  name: "",
  siteId: "",
};

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

export default function AssessmentsPage() {
  const tenant = useTenantSession();
  const [projects, setProjects] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const loadData = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [projectsRes, sitesRes] = await Promise.all([
        fetch("/api/v1/projects", { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
      ]);

      const [projectsPayload, sitesPayload] = await Promise.all([
        projectsRes.json().catch(() => ({})),
        sitesRes.json().catch(() => ({})),
      ]);

      if (!projectsRes.ok || !sitesRes.ok) {
        throw new Error("Failed to load assessments");
      }

      setProjects(Array.isArray(projectsPayload.projects) ? projectsPayload.projects : []);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assessments");
      setProjects([]);
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

  const onCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          siteId: form.siteId || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setModalOpen(false);
      setForm(emptyForm);
      await loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create assessment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Assessments ESG</h2>
          <p className="enterprise-muted">Tenant-scoped wizard E/S/G with optional site association.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          {canWrite ? (
            <button className="enterprise-button-primary" type="button" onClick={() => setModalOpen(true)}>
              New assessment
            </button>
          ) : null}
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading assessments...</p> : null}

      {!loading && projects.length === 0 ? (
        <div className="enterprise-empty">No assessments for this tenant. Create the first one to start the ESG wizard.</div>
      ) : null}

      {!loading && projects.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Site</th>
                <th>Answers</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>{project.name}</td>
                  <td>{project.siteId ? siteMap.get(project.siteId) || "Unknown site" : "-"}</td>
                  <td>{project.answerCount ?? 0}</td>
                  <td>{formatDateTime(project.updatedAt)}</td>
                  <td>
                    <div className="enterprise-inline-actions">
                      <Link className="enterprise-button-secondary" href={`/projects/${project.id}`}>
                        Open wizard
                      </Link>
                      <Link className="enterprise-button-secondary" href={`/projects/${project.id}/report`}>
                        Report
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {modalOpen ? (
        <Modal title="Create assessment" onClose={() => setModalOpen(false)}>
          <form className="enterprise-form-grid" onSubmit={onCreate}>
            <label className="enterprise-label" htmlFor="assessment-name">
              Assessment name
            </label>
            <input
              id="assessment-name"
              className="enterprise-input"
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="2026 ESG Baseline"
            />

            <label className="enterprise-label" htmlFor="assessment-site">
              Site (optional)
            </label>
            <select
              id="assessment-site"
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

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create assessment"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
