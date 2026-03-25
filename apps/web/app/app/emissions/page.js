"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantSession } from "../_components/use-tenant-session";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const currentYear = new Date().getFullYear();

const buildApiError = (payload, response) => {
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
  return {
    message,
    requestId: typeof payload?.requestId === "string" ? payload.requestId : null,
  };
};

const describeScope = (value) => {
  if (value === "country_override") {
    return "country override";
  }
  if (value === "tenant_default") {
    return "tenant default";
  }
  if (value === "library_suggestion") {
    return "library suggestion";
  }
  if (value === "missing") {
    return "missing";
  }
  return value || "n/a";
};

const describeSupportStatus = (value) => {
  if (value === "supported") {
    return "Supported";
  }
  if (value === "partial") {
    return "Partial";
  }
  if (value === "not_enabled") {
    return "Not enabled";
  }
  return "Not ready";
};

const formatFactorValue = (factor) => {
  if (!factor || factor.value == null) {
    return "-";
  }
  return `${factor.value} ${factor.unit || ""}`.trim();
};

export default function EmissionsPage() {
  const tenant = useTenantSession();
  const [reportingYear, setReportingYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState("overview");
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
      if (!response.ok || body?.ok === false) {
        throw buildApiError(body, response);
      }
      setPayload(body);
    } catch (loadError) {
      const detail =
        loadError && typeof loadError === "object" && "message" in loadError
          ? loadError
          : { message: "Unable to load emissions", requestId: null };
      const requestIdLine = detail.requestId ? ` (requestId: ${detail.requestId})` : "";
      setError(`${detail.message}${requestIdLine}`);
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
  const issueSummary = useMemo(
    () => ({
      missingFactorsCount: payload?.summary?.missingFactorsCount ?? (payload?.missingFactors?.length || 0),
      unsupportedCategoriesCount: payload?.summary?.unsupportedCategoriesCount ?? 0,
      missingEvidenceCount: payload?.summary?.missingEvidenceCount ?? 0,
      nonComputableRecordCount: payload?.summary?.nonComputableRecordCount ?? 0,
    }),
    [payload],
  );

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Emissions</h2>
          <p className="enterprise-muted">Computed Scope 1/2/3 totals with factor resolution and coverage status.</p>
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
          <Link className="enterprise-button-secondary" href="/app/ghg">
            Open GHG Inventory
          </Link>
        </div>
      </div>

      <div className="enterprise-inline-actions">
        <button
          type="button"
          className={activeTab === "overview" ? "enterprise-button-primary" : "enterprise-button-secondary"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={activeTab === "scope3" ? "enterprise-button-primary" : "enterprise-button-secondary"}
          onClick={() => setActiveTab("scope3")}
        >
          Scope 3
        </button>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {loading ? <p className="enterprise-status">Loading emissions...</p> : null}

      <div className="enterprise-kpi-grid" style={{ position: "sticky", top: 12, zIndex: 2 }}>
        <article className="enterprise-kpi-card">
          <strong>
            <TooltipText text="Fattori da risolvere">Missing factors</TooltipText>
          </strong>
          <p>{issueSummary.missingFactorsCount}</p>
        </article>
        <article className="enterprise-kpi-card">
          <strong>Unsupported categories</strong>
          <p>{issueSummary.unsupportedCategoriesCount}</p>
        </article>
        <article className="enterprise-kpi-card">
          <strong>Missing evidence</strong>
          <p>{issueSummary.missingEvidenceCount}</p>
        </article>
      </div>

      {payload && payload.missingFactors?.length > 0 ? (
        <div className="enterprise-warning">
          Missing factors: {payload.missingFactors.join(", ")}.
          <span> </span>
          <Link href="/app/factors">Go to Factors</Link>
          <span> </span>
          Resolution order: country override, tenant default, library suggestion, missing.
        </div>
      ) : null}

      {payload?.warnings?.length > 0 ? (
        <div className="enterprise-warning">
          {payload.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {issueSummary.nonComputableRecordCount > 0 ? (
        <div className="enterprise-warning">
          Record present but not computable: {issueSummary.nonComputableRecordCount} record(s) are still excluded or unresolved. Open <Link href="/app/ghg">GHG Inventory</Link> to fix factors, evidence or unsupported categories.
        </div>
      ) : null}

      {issueSummary.unsupportedCategoriesCount > 0 ? (
        <div className="enterprise-warning">
          Category not enabled: the Scope 3 matrix still contains categories outside the pilot perimeter. Use the Scope 3 tab to show status explicitly before discussing totals.
        </div>
      ) : null}

      {issueSummary.missingEvidenceCount > 0 ? (
        <div className="enterprise-warning">
          Evidence missing: {issueSummary.missingEvidenceCount} GHG record(s) behind the totals still require evidence. <Link href="/app/evidence">Aggiungi evidenza</Link>
        </div>
      ) : null}

      {tenantTotals ? (
        <div className="enterprise-kpi-grid">
          <article className="enterprise-kpi-card">
            <strong>
              <TooltipText text="Totale Scope 1">Scope 1 tCO2e</TooltipText>
            </strong>
            <p>{tenantTotals.scope1Tco2e}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>
              <TooltipText text="Totale Scope 2">Scope 2 Location tCO2e</TooltipText>
            </strong>
            <p>{tenantTotals.scope2LocationTco2e}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>
              <TooltipText text="Totale Scope 2">Scope 2 Market tCO2e</TooltipText>
            </strong>
            <p>{tenantTotals.scope2MarketTco2e}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>
              <TooltipText text="Totale Scope 3">Scope 3 tCO2e</TooltipText>
            </strong>
            <p>{tenantTotals.scope3Tco2e ?? 0}</p>
          </article>
          <article className="enterprise-kpi-card">
            <strong>GHG coverage %</strong>
            <p>{tenantTotals.ghgCoveragePct ?? 0}</p>
          </article>
        </div>
      ) : null}

      {activeTab === "overview" && companies.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Scope 1</th>
                <th>Scope 2 location</th>
                <th>Scope 2 market</th>
                <th>Scope 3</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.companyId}>
                  <td>{company.name}</td>
                  <td>{company.scope1Tco2e}</td>
                  <td>{company.scope2LocationTco2e}</td>
                  <td>{company.scope2MarketTco2e}</td>
                  <td>{company.scope3Tco2e ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === "overview" && sites.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Country</th>
                <th>Scope 1</th>
                <th>Scope 2 location</th>
                <th>Scope 2 market</th>
                <th>Scope 3</th>
                <th>Resolved source per factor</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.siteId}>
                  <td>{site.name}</td>
                  <td>{site.country || "-"}</td>
                  <td>{site.scope1Tco2e}</td>
                  <td>{site.scope2LocationTco2e}</td>
                  <td>{site.scope2MarketTco2e}</td>
                  <td>{site.scope3Tco2e ?? 0}</td>
                  <td>
                    {Array.isArray(site.resolvedFactors) && site.resolvedFactors.length > 0 ? (
                      <div>
                        {site.resolvedFactors.map((factor) => (
                          <div key={`${site.siteId}:${factor.key}`}>
                            <strong>{factor.key}</strong>: {describeScope(factor.resolutionScope)} · {formatFactorValue(factor)}
                            {factor.fallbackFrom ? ` (fallback from ${factor.fallbackFrom})` : ""}
                            {factor.sourceUrl ? (
                              <>
                                {" "}
                                <a href={factor.sourceUrl} target="_blank" rel="noreferrer">
                                  {factor.sourceLabel || "source"}
                                </a>
                              </>
                            ) : factor.sourceLabel ? (
                              <span> {factor.sourceLabel}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === "scope3" ? (
        <div className="enterprise-card">
          <h3>
            <TooltipText text="Vedi il dettaglio">Scope 3 coverage & categories</TooltipText>
          </h3>
          <p className="enterprise-muted">
            Coverage {payload?.ghg?.coverage ?? 0}% · resolution order: country override, tenant default, library suggestion, missing.
          </p>
          {Array.isArray(payload?.ghg?.scope3Support) && payload.ghg.scope3Support.length > 0 ? (
            <div className="enterprise-table-wrap">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Methods</th>
                    <th>Coverage note</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.ghg.scope3Support.map((item) => (
                    <tr key={`support-${item.category}`}>
                      <td>Category {item.category} · {item.label}</td>
                      <td>{describeSupportStatus(item.status)}</td>
                      <td>{Array.isArray(item.methodSupport) ? item.methodSupport.join(", ") : "-"}</td>
                      <td>{item.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {Array.isArray(payload?.ghg?.scope3Breakdown) && payload.ghg.scope3Breakdown.length > 0 ? (
            <div className="enterprise-table-wrap">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Total tCO2e</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.ghg.scope3Breakdown.map((row) => (
                    <tr key={`s3-${row.category}`}>
                      <td>Category {row.category}</td>
                      <td>{row.totalTco2e}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="enterprise-muted">No Scope 3 records yet. Add activities in the GHG Inventory module.</p>
          )}

          {Array.isArray(payload?.missingFactors) && payload.missingFactors.length > 0 ? (
            <div className="enterprise-warning">
              Missing factors detected: {payload.missingFactors.join(", ")}. <Link href="/app/factors">Open Factors</Link> to add a tenant default or country override before treating the category as covered.
            </div>
          ) : null}

          {Array.isArray(payload?.ghg?.records) && payload.ghg.records.length > 0 ? (
            <div className="enterprise-table-wrap">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Scope</th>
                    <th>Category</th>
                    <th>tCO2e</th>
                    <th>Resolved factor</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.ghg.records.map((record) => (
                    <tr key={record.recordId}>
                      <td>{record.activityName}</td>
                      <td>{record.scope}</td>
                      <td>{record.scope3Category ?? "-"}</td>
                      <td>{record.tco2e ?? "-"}</td>
                      <td>
                        <div><strong>{record.factorUsed?.key || "-"}</strong></div>
                        <div>{describeScope(record.factorUsed?.resolution || "missing")}</div>
                        <div>{formatFactorValue(record.factorUsed)}</div>
                      </td>
                      <td>
                        {record.factorUsed?.sourceUrl ? (
                          <a href={record.factorUsed.sourceUrl} target="_blank" rel="noreferrer">
                            {record.factorUsed?.sourceLabel || "source"}
                          </a>
                        ) : (
                          record.factorUsed?.sourceLabel || "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
