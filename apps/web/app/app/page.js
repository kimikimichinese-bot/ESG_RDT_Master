"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantSession } from "./_components/use-tenant-session";

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

export default function DashboardPage() {
  const tenant = useTenantSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState({
    sites: 0,
    people: 0,
    activities: 0,
    evidence: 0,
    assessments: 0,
    lastActivity: null,
    completeness: null,
  });

  const loadSnapshot = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [sitesRes, peopleRes, activitiesRes, evidenceRes, projectsRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/people`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/activities`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, { cache: "no-store" }),
        fetch("/api/v1/projects", { cache: "no-store" }),
      ]);

      const [sitesPayload, peoplePayload, activitiesPayload, evidencePayload, projectsPayload] = await Promise.all([
        sitesRes.json().catch(() => ({})),
        peopleRes.json().catch(() => ({})),
        activitiesRes.json().catch(() => ({})),
        evidenceRes.json().catch(() => ({})),
        projectsRes.json().catch(() => ({})),
      ]);

      if (!sitesRes.ok || !peopleRes.ok || !activitiesRes.ok || !evidenceRes.ok || !projectsRes.ok) {
        throw new Error("Failed to load dashboard KPI data");
      }

      const activities = Array.isArray(activitiesPayload.activities) ? activitiesPayload.activities : [];
      const projects = Array.isArray(projectsPayload.projects) ? projectsPayload.projects : [];

      let completeness = null;
      if (projects.length > 0) {
        const latestProject = projects[0];
        const reportRes = await fetch(`/api/v1/projects/${encodeURIComponent(latestProject.id)}/report`, {
          cache: "no-store",
        });
        const reportPayload = await reportRes.json().catch(() => ({}));
        if (reportRes.ok && Number.isFinite(reportPayload.completenessPercent)) {
          completeness = {
            projectName: latestProject.name,
            percent: reportPayload.completenessPercent,
          };
        }
      }

      setSnapshot({
        sites: Array.isArray(sitesPayload.sites) ? sitesPayload.sites.length : 0,
        people: Array.isArray(peoplePayload.people) ? peoplePayload.people.length : 0,
        activities: activities.length,
        evidence: Array.isArray(evidencePayload.evidence) ? evidencePayload.evidence.length : 0,
        assessments: projects.length,
        lastActivity: activities[0] || null,
        completeness,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard data");
      setSnapshot({
        sites: 0,
        people: 0,
        activities: 0,
        evidence: 0,
        assessments: 0,
        lastActivity: null,
        completeness: null,
      });
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadSnapshot();
    }
  }, [tenant.loading, tenant.tenantId, loadSnapshot]);

  const completionText = useMemo(() => {
    if (!snapshot.completeness) {
      return "No assessment report available yet";
    }
    return `${snapshot.completeness.percent}% on ${snapshot.completeness.projectName}`;
  }, [snapshot.completeness]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Dashboard</h2>
          <p className="enterprise-muted">Enterprise overview and next actions for ESG operations.</p>
        </div>
        <button className="enterprise-button-secondary" type="button" onClick={() => void loadSnapshot()}>
          Refresh KPIs
        </button>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading KPI cards...</p> : null}

      {!loading ? (
        <div className="enterprise-kpi-grid">
          <article className="enterprise-kpi-card">
            <strong>Sites</strong>
            <p>{snapshot.sites}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Personnel</strong>
            <p>{snapshot.people}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Activities</strong>
            <p>{snapshot.activities}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Evidence docs</strong>
            <p>{snapshot.evidence}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Assessments</strong>
            <p>{snapshot.assessments}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Completeness</strong>
            <p>{completionText}</p>
          </article>
        </div>
      ) : null}

      <section className="enterprise-card">
        <h3>Quick actions</h3>
        <div className="enterprise-quick-actions">
          <Link className="enterprise-button-secondary" href="/app/sites">
            Create site
          </Link>
          <Link className="enterprise-button-secondary" href="/app/personnel">
            Add person
          </Link>
          <Link className="enterprise-button-secondary" href="/app/activities">
            Log activity
          </Link>
          <Link className="enterprise-button-secondary" href="/app/evidence">
            Add evidence
          </Link>
          <Link className="enterprise-button-secondary" href="/app/assessments">
            Open assessments
          </Link>
        </div>
      </section>

      <section className="enterprise-card">
        <h3>Latest activity</h3>
        {snapshot.lastActivity ? (
          <p className="enterprise-muted">
            {snapshot.lastActivity.activityType} · {snapshot.lastActivity.quantity} {snapshot.lastActivity.unit} ·{" "}
            {formatDateTime(snapshot.lastActivity.updatedAt)}
          </p>
        ) : (
          <div className="enterprise-empty">No activity records yet for this tenant.</div>
        )}
      </section>
    </section>
  );
}
