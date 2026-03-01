"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();

export default function EmissionsPage() {
  const tenant = useTenantSession();
  const [reportingYear, setReportingYear] = useState(currentYear);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEmissions = useCallback(async () => {
    if (!tenant.tenantId || !reportingYear) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/emissions?year=${encodeURIComponent(reportingYear)}`,
        {
          cache: "no-store",
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      setPayload(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load emissions");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [reportingYear, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadEmissions();
    }
  }, [tenant.loading, tenant.tenantId, loadEmissions]);

  const tenantTotals = payload?.tenantTotals || null;
  const companies = useMemo(() => (Array.isArray(payload?.companies) ? payload.companies : []), [payload]);
  const sites = useMemo(() => (Array.isArray(payload?.sites) ? payload.sites : []), [payload]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Emissions</h2>
          <p className="enterprise-muted">Computed Scope 1 and Scope 2 totals by tenant, company and site.</p>
        </div>
        <div className="enterprise-inline-actions">
          <label className="enterprise-inline-field" htmlFor="emissions-year">
            Year
          </label>
          <input
            id="emissions-year"
            className="enterprise-input"
            type="number"
            min="1900"
            max="2200"
            value={reportingYear}
            onChange={(event) => setReportingYear(Number(event.target.value))}
          />
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadEmissions()}>
            Refresh
          </button>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading emissions...</p> : null}

      {payload && payload.missingFactors?.length > 0 ? (
        <div className="enterprise-warning">
          Missing factors: {payload.missingFactors.join(", ")}.
          <span> </span>
          <Link href="/app/factors">Go to Factors</Link>
        </div>
      ) : null}

      {payload?.warnings?.length > 0 ? (
        <div className="enterprise-warning">
          {payload.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {tenantTotals ? (
        <div className="enterprise-kpi-grid">
          <article className="enterprise-kpi-card">
            <strong>Scope 1 tCO2e</strong>
            <p>{tenantTotals.scope1Tco2e}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Scope 2 Location tCO2e</strong>
            <p>{tenantTotals.scope2LocationTco2e}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>Scope 2 Market tCO2e</strong>
            <p>{tenantTotals.scope2MarketTco2e}</p>
          </article>
        </div>
      ) : null}

      {companies.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Scope 1</th>
                <th>Scope 2 location</th>
                <th>Scope 2 market</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.companyId}>
                  <td>{company.name}</td>
                  <td>{company.scope1Tco2e}</td>
                  <td>{company.scope2LocationTco2e}</td>
                  <td>{company.scope2MarketTco2e}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {sites.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Company ID</th>
                <th>Scope 1</th>
                <th>Scope 2 location</th>
                <th>Scope 2 market</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.siteId}>
                  <td>{site.name}</td>
                  <td>{site.companyId}</td>
                  <td>{site.scope1Tco2e}</td>
                  <td>{site.scope2LocationTco2e}</td>
                  <td>{site.scope2MarketTco2e}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
