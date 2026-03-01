"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../_components/modal";
import { useCompanyScope } from "../_components/use-company-scope";
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

const currentYear = new Date().getFullYear();

export default function AssessmentsPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [projects, setProjects] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [baseYear, setBaseYear] = useState(currentYear - 1);
  const [reportingYear, setReportingYear] = useState(currentYear);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [environmentSummary, setEnvironmentSummary] = useState(null);
  const [socialSummary, setSocialSummary] = useState(null);
  const [emissionsSummary, setEmissionsSummary] = useState(null);
  const [flags, setFlags] = useState({
    genderPayGapReported: false,
    scope3ScreeningPerformed: false,
  });
  const [flagsSaving, setFlagsSaving] = useState(false);
  const [flagsMessage, setFlagsMessage] = useState("");

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const baseYearValidationError = useMemo(
    () => (baseYear > reportingYear ? "base_year must be less than or equal to reporting_year" : ""),
    [baseYear, reportingYear],
  );

  const loadData = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [projectsRes, sitesRes, envRes, socialRes, emissionsRes] = await Promise.all([
        fetch("/api/v1/projects", { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
        fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/summary/environment?year=${encodeURIComponent(reportingYear)}`,
          { cache: "no-store" },
        ),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/summary/social?year=${encodeURIComponent(reportingYear)}`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/emissions?year=${encodeURIComponent(reportingYear)}`, {
          cache: "no-store",
        }),
      ]);

      const [projectsPayload, sitesPayload, envPayload, socialPayload, emissionsPayload] = await Promise.all([
        projectsRes.json().catch(() => ({})),
        sitesRes.json().catch(() => ({})),
        envRes.json().catch(() => ({})),
        socialRes.json().catch(() => ({})),
        emissionsRes.json().catch(() => ({})),
      ]);

      if (!projectsRes.ok || !sitesRes.ok || !envRes.ok || !socialRes.ok || !emissionsRes.ok) {
        throw new Error("Failed to load assessment dashboard data");
      }

      setProjects(Array.isArray(projectsPayload.projects) ? projectsPayload.projects : []);
      setSites(Array.isArray(sitesPayload.sites) ? sitesPayload.sites : []);
      setEnvironmentSummary(envPayload);
      setSocialSummary(socialPayload);
      setEmissionsSummary(emissionsPayload);

      if (selectedCompanyId) {
        const flagsRes = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/company-flags?companyId=${encodeURIComponent(selectedCompanyId)}&year=${encodeURIComponent(reportingYear)}`,
          {
            cache: "no-store",
          },
        );
        const flagsPayload = await flagsRes.json().catch(() => ({}));
        if (flagsRes.ok) {
          setFlags({
            genderPayGapReported: Boolean(flagsPayload.genderPayGapReported),
            scope3ScreeningPerformed: Boolean(flagsPayload.scope3ScreeningPerformed),
          });
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assessments");
      setProjects([]);
      setSites([]);
      setEnvironmentSummary(null);
      setSocialSummary(null);
      setEmissionsSummary(null);
    } finally {
      setLoading(false);
    }
  }, [reportingYear, selectedCompanyId, tenant.tenantId]);

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

  const saveFlags = useCallback(async () => {
    if (!tenant.tenantId || !selectedCompanyId || !reportingYear || baseYearValidationError) {
      return;
    }

    setFlagsSaving(true);
    setFlagsMessage("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/social/company-flags`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          reportingYear,
          genderPayGapReported: flags.genderPayGapReported,
          scope3ScreeningPerformed: flags.scope3ScreeningPerformed,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setFlagsMessage("Company-year flags updated");
      await loadData();
    } catch (flagsError) {
      setFlagsMessage(flagsError instanceof Error ? flagsError.message : "Unable to save flags");
    } finally {
      setFlagsSaving(false);
    }
  }, [baseYearValidationError, flags, loadData, reportingYear, selectedCompanyId, tenant.tenantId]);

  const companyEnvironment = useMemo(() => {
    if (!environmentSummary || !selectedCompanyId) {
      return null;
    }
    return (environmentSummary.companies || []).find((item) => item.companyId === selectedCompanyId) || null;
  }, [environmentSummary, selectedCompanyId]);

  const companySocial = useMemo(() => {
    if (!socialSummary || !selectedCompanyId) {
      return null;
    }
    return (socialSummary.companies || []).find((item) => item.companyId === selectedCompanyId) || null;
  }, [socialSummary, selectedCompanyId]);

  const companyEmissions = useMemo(() => {
    if (!emissionsSummary || !selectedCompanyId) {
      return null;
    }
    return (emissionsSummary.companies || []).find((item) => item.companyId === selectedCompanyId) || null;
  }, [emissionsSummary, selectedCompanyId]);

  const totalOperationalSites = useMemo(() => {
    if (!selectedCompanyId) {
      return sites.length;
    }
    return sites.filter((site) => site.companyId === selectedCompanyId).length;
  }, [selectedCompanyId, sites]);

  const countriesInScope = useMemo(() => {
    const values = new Set();
    for (const site of sites) {
      if (selectedCompanyId && site.companyId !== selectedCompanyId) {
        continue;
      }
      if (site.country) {
        values.add(site.country);
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [selectedCompanyId, sites]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Assessments ESG</h2>
          <p className="enterprise-muted">Computed Environment, Social and Emissions aggregates with company-year controls.</p>
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

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="assessment-base-year">
            Base year
          </label>
          <input
            id="assessment-base-year"
            className="enterprise-input"
            type="number"
            min="1900"
            max="2200"
            value={baseYear}
            onChange={(event) => setBaseYear(Number(event.target.value))}
          />

          <label className="enterprise-label" htmlFor="assessment-reporting-year">
            Reporting year
          </label>
          <input
            id="assessment-reporting-year"
            className="enterprise-input"
            type="number"
            min="1900"
            max="2200"
            value={reportingYear}
            onChange={(event) => setReportingYear(Number(event.target.value))}
          />

          <label className="enterprise-label" htmlFor="assessment-company-filter">
            Company
          </label>
          <select
            id="assessment-company-filter"
            className="enterprise-input"
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              companyScope.setActiveCompanyId(event.target.value);
            }}
          >
            <option value="">Tenant view</option>
            {companyScope.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
                {company.isHolding ? " (Holding)" : ""}
              </option>
            ))}
          </select>
        </div>

        {baseYearValidationError ? <p className="enterprise-status enterprise-status-error">{baseYearValidationError}</p> : null}
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {flagsMessage ? <p className="enterprise-status">{flagsMessage}</p> : null}
      {loading ? <p className="enterprise-status">Loading assessments...</p> : null}

      {!loading ? (
        <div className="enterprise-kpi-grid">
          <article className="enterprise-kpi-card">
            <strong>Total operational sites</strong>
            <p>{totalOperationalSites}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Countries in scope</strong>
            <p>{countriesInScope.length > 0 ? countriesInScope.join(", ") : "-"}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Scope 1 tCO2e</strong>
            <p>
              {selectedCompanyId
                ? companyEmissions?.scope1Tco2e ?? "0"
                : emissionsSummary?.tenantTotals?.scope1Tco2e ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Scope 2 location tCO2e</strong>
            <p>
              {selectedCompanyId
                ? companyEmissions?.scope2LocationTco2e ?? "0"
                : emissionsSummary?.tenantTotals?.scope2LocationTco2e ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Scope 2 market tCO2e</strong>
            <p>
              {selectedCompanyId
                ? companyEmissions?.scope2MarketTco2e ?? "0"
                : emissionsSummary?.tenantTotals?.scope2MarketTco2e ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Women in workforce %</strong>
            <p>
              {selectedCompanyId
                ? companySocial?.womenInWorkforcePct ?? "0"
                : socialSummary?.tenantTotals?.womenInWorkforcePct ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Women in management %</strong>
            <p>
              {selectedCompanyId
                ? companySocial?.womenInManagementPct ?? "0"
                : socialSummary?.tenantTotals?.womenInManagementPct ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Turnover %</strong>
            <p>
              {selectedCompanyId
                ? companySocial?.turnoverPct ?? "0"
                : socialSummary?.tenantTotals?.turnoverPct ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Hours worked total</strong>
            <p>
              {selectedCompanyId
                ? companySocial?.hoursWorkedTotal ?? "0"
                : socialSummary?.tenantTotals?.hoursWorkedTotal ?? "0"}
            </p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Water-stressed sites</strong>
            <p>
              {selectedCompanyId
                ? companyEnvironment?.sitesInWaterStressedAreas ?? "0"
                : environmentSummary?.tenantDerived?.sites_in_water_stressed_areas ?? "0"}
            </p>
          </article>
        </div>
      ) : null}

      <div className="enterprise-card">
        <h3>Company-year toggles</h3>
        <div className="enterprise-inline-actions">
          <label className="enterprise-checkbox-row" htmlFor="assessment-flag-pay-gap">
            <input
              id="assessment-flag-pay-gap"
              type="checkbox"
              checked={flags.genderPayGapReported}
              onChange={(event) => setFlags((current) => ({ ...current, genderPayGapReported: event.target.checked }))}
              disabled={!canWrite || !selectedCompanyId || Boolean(baseYearValidationError)}
            />
            <span>Gender pay gap reported</span>
          </label>
          <label className="enterprise-checkbox-row" htmlFor="assessment-flag-scope3">
            <input
              id="assessment-flag-scope3"
              type="checkbox"
              checked={flags.scope3ScreeningPerformed}
              onChange={(event) =>
                setFlags((current) => ({
                  ...current,
                  scope3ScreeningPerformed: event.target.checked,
                }))
              }
              disabled={!canWrite || !selectedCompanyId || Boolean(baseYearValidationError)}
            />
            <span>Scope 3 screening performed</span>
          </label>
          <button
            className="enterprise-button-primary"
            type="button"
            onClick={() => void saveFlags()}
            disabled={!canWrite || !selectedCompanyId || flagsSaving || Boolean(baseYearValidationError)}
          >
            {flagsSaving ? "Saving..." : "Save toggles"}
          </button>
        </div>
      </div>

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
              <button className="enterprise-button-primary" type="submit" disabled={saving || Boolean(baseYearValidationError)}>
                {saving ? "Creating..." : "Create assessment"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
