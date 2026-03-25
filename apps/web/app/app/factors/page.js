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

const DEFAULT_LIBRARY = "IPCC";
const FALLBACK_REFRIGERANTS = ["R134A", "R410A", "R32", "R22", "R407C", "R404A"];
const currentYear = new Date().getFullYear();

const buildApiError = (payload, response) => {
  const code = typeof payload?.code === "string" ? payload.code : "request_failed";
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
  return {
    code,
    message,
    requestId: typeof payload?.requestId === "string" ? payload.requestId : null,
  };
};

const normalizeCountry = (value) => String(value || "").trim().toUpperCase();

export default function FactorsPage() {
  const tenant = useTenantSession();

  const [reportingYear, setReportingYear] = useState(currentYear);
  const [library, setLibrary] = useState(DEFAULT_LIBRARY);
  const [country, setCountry] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [refrigerantType, setRefrigerantType] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [scope3Category, setScope3Category] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [spendCategory, setSpendCategory] = useState("");
  const [transportMode, setTransportMode] = useState("");
  const [region, setRegion] = useState("");

  const [companies, setCompanies] = useState([]);
  const [sites, setSites] = useState([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [payload, setPayload] = useState(null);
  const [csvText, setCsvText] = useState("");

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const siteOptions = useMemo(() => {
    if (!companyId) {
      return sites;
    }
    return sites.filter((item) => item.companyId === companyId);
  }, [companyId, sites]);

  const loadScopeOptions = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    try {
      const [companiesResponse, sitesResponse] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/companies`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites`, { cache: "no-store" }),
      ]);

      const [companiesBody, sitesBody] = await Promise.all([
        companiesResponse.json().catch(() => ({})),
        sitesResponse.json().catch(() => ({})),
      ]);

      if (!companiesResponse.ok) {
        throw buildApiError(companiesBody, companiesResponse);
      }
      if (!sitesResponse.ok) {
        throw buildApiError(sitesBody, sitesResponse);
      }

      setCompanies(Array.isArray(companiesBody?.companies) ? companiesBody.companies : []);
      setSites(Array.isArray(sitesBody?.sites) ? sitesBody.sites : []);
    } catch (loadError) {
      const detail =
        loadError && typeof loadError === "object" && "message" in loadError
          ? loadError
          : { message: "Unable to load company/site selectors", requestId: null };
      const detailsLine = detail.requestId ? ` (requestId: ${detail.requestId})` : "";
      setError(`${detail.message}${detailsLine}`);
    }
  }, [tenant.tenantId]);

  const loadFactors = useCallback(async () => {
    if (!tenant.tenantId || !reportingYear || !country) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const query = new URLSearchParams({
        year: String(reportingYear),
        country,
        library,
        includeAll: "true",
      });

      if (companyId) {
        query.set("companyId", companyId);
      }
      if (siteId) {
        query.set("siteId", siteId);
      }
      if (refrigerantType) {
        query.set("refrigerantType", refrigerantType);
      }
      if (scopeFilter) {
        query.set("scope", scopeFilter);
      }
      if (scope3Category) {
        query.set("scope3Category", scope3Category);
      }
      if (methodFilter) {
        query.set("method", methodFilter);
      }
      if (spendCategory) {
        query.set("spendCategory", spendCategory);
      }
      if (transportMode) {
        query.set("transportMode", transportMode);
      }
      if (region) {
        query.set("region", region);
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/factors?${query.toString()}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body?.ok === false) {
        throw buildApiError(body, response);
      }

      setPayload(body);
      if (typeof body?.settings?.refrigerantType === "string") {
        setRefrigerantType(body.settings.refrigerantType);
      }
    } catch (loadError) {
      const detail =
        loadError && typeof loadError === "object" && "message" in loadError
          ? loadError
          : { message: "Network error while loading factors", requestId: null };
      const detailsLine = detail.requestId ? ` (requestId: ${detail.requestId})` : "";
      setError(`${detail.message}${detailsLine}`);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [
    companyId,
    country,
    library,
    methodFilter,
    refrigerantType,
    region,
    reportingYear,
    scope3Category,
    scopeFilter,
    siteId,
    spendCategory,
    tenant.tenantId,
    transportMode,
  ]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadScopeOptions();
    }
  }, [tenant.loading, tenant.tenantId, loadScopeOptions]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && reportingYear && country) {
      void loadFactors();
    }
  }, [country, loadFactors, reportingYear, tenant.loading, tenant.tenantId]);

  useEffect(() => {
    if (!siteId) {
      return;
    }
    const selectedSite = sites.find((item) => item.id === siteId);
    if (!selectedSite) {
      return;
    }
    if (selectedSite.companyId && selectedSite.companyId !== companyId) {
      setCompanyId(selectedSite.companyId);
    }
    const siteCountry = normalizeCountry(selectedSite.country);
    if (siteCountry && siteCountry !== country) {
      setCountry(siteCountry);
    }
  }, [companyId, country, siteId, sites]);

  useEffect(() => {
    if (!siteId) {
      return;
    }
    if (!siteOptions.some((item) => item.id === siteId)) {
      setSiteId("");
    }
  }, [siteId, siteOptions]);

  useEffect(() => {
    if (scopeFilter !== "scope3" && scope3Category) {
      setScope3Category("");
    }
  }, [scope3Category, scopeFilter]);

  const refrigerantOptions = useMemo(() => {
    const apiOptions = Array.isArray(payload?.settings?.refrigerantOptions) ? payload.settings.refrigerantOptions : [];
    return apiOptions.length > 0 ? apiOptions : FALLBACK_REFRIGERANTS;
  }, [payload]);

  const tableRows = useMemo(() => {
    const tenantDefaults = Array.isArray(payload?.tenantDefaults) ? payload.tenantDefaults : [];
    const countryOverrides = Array.isArray(payload?.countryOverrides) ? payload.countryOverrides : [];
    const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];

    const tenantMap = new Map(tenantDefaults.map((item) => [item.key, item]));
    const countryMap = new Map(countryOverrides.map((item) => [item.key, item]));
    const suggestionMap = new Map(suggestions.map((item) => [item.key, item]));

    const keys = [...new Set([...tenantMap.keys(), ...countryMap.keys(), ...suggestionMap.keys()])];

    return keys.map((key) => {
      const tenantDefault = tenantMap.get(key) || null;
      const countryOverride = countryMap.get(key) || null;
      const suggestion = suggestionMap.get(key) || null;

      return {
        key,
        unit: suggestion?.unit || countryOverride?.unit || tenantDefault?.unit || "",
        tenantDefault,
        countryOverride,
        suggestion,
      };
    });
  }, [payload]);

  const issueSummary = useMemo(() => ({
    missingFactorsCount:
      payload?.summary?.missingFactorsCount ??
      tableRows.filter((row) => !row.tenantDefault?.value && !row.countryOverride?.value && row.suggestion?.value == null).length,
    unsupportedCategoriesCount: payload?.summary?.unsupportedCategoriesCount ?? 0,
    missingEvidenceCount: payload?.summary?.missingEvidenceCount ?? 0,
    nonComputableRecordCount: payload?.summary?.nonComputableRecordCount ?? 0,
  }), [payload, tableRows]);

  const persistUpdates = useCallback(
    async ({ scope, updates }) => {
      if (!tenant.tenantId) {
        return;
      }

      setSaving(true);
      setError("");
      setMessage("");

      try {
        const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/factors`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            scope,
            country,
            reportingYear,
            library,
            refrigerantType,
            updates,
          }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.ok === false) {
          throw buildApiError(body, response);
        }

        setMessage(
          scope === "country"
            ? `Applied ${updates.length} suggested value(s) for ${country}.`
            : `Applied ${updates.length} suggested value(s) to tenant default.`,
        );
        await loadFactors();
      } catch (saveError) {
        const detail =
          saveError && typeof saveError === "object" && "message" in saveError
            ? saveError
            : { message: "Network error while saving factors", requestId: null };
        const detailsLine = detail.requestId ? ` (requestId: ${detail.requestId})` : "";
        setError(`${detail.message}${detailsLine}`);
      } finally {
        setSaving(false);
      }
    },
    [country, library, loadFactors, refrigerantType, reportingYear, tenant.tenantId],
  );

  const onApplySuggested = useCallback(
    async (row, scope) => {
      if (!row?.suggestion || row.suggestion.value == null) {
        return;
      }
      await persistUpdates({
        scope,
        updates: [
          {
            key: row.key,
            value: row.suggestion.value,
            unit: row.unit,
            source_label: row.suggestion.source_label || null,
            source_url: row.suggestion.source_url || null,
          },
        ],
      });
    },
    [persistUpdates],
  );

  const onApplyAllCountry = useCallback(async () => {
    const updates = tableRows
      .filter((row) => row?.suggestion && row.suggestion.value != null)
      .map((row) => ({
        key: row.key,
        value: row.suggestion.value,
        unit: row.unit,
        source_label: row.suggestion.source_label || null,
        source_url: row.suggestion.source_url || null,
      }));

    if (updates.length === 0) {
      setError("No numeric suggested values available to apply for country scope.");
      return;
    }

    await persistUpdates({ scope: "country", updates });
  }, [persistUpdates, tableRows]);

  const onImportCsv = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }
    if (!csvText.trim()) {
      setError("CSV text is required for import.");
      return;
    }

    setImporting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/factors/import-csv`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ csvText }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body?.ok === false) {
        throw buildApiError(body, response);
      }

      setMessage(`Imported factor library CSV: ${body.inserted} inserted, ${body.updated} updated.`);
      await loadFactors();
    } catch (importError) {
      const detail =
        importError && typeof importError === "object" && "message" in importError
          ? importError
          : { message: "Network error while importing CSV", requestId: null };
      const detailsLine = detail.requestId ? ` (requestId: ${detail.requestId})` : "";
      setError(`${detail.message}${detailsLine}`);
    } finally {
      setImporting(false);
    }
  }, [csvText, loadFactors, tenant.tenantId]);

  const onCsvFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    setCsvText(text);
  }, []);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Factors</h2>
          <p className="enterprise-muted">Country/site-aware factor suggestions with source references.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadFactors()}>
            Refresh
          </button>
          <button
            className="enterprise-button-primary"
            type="button"
            onClick={() => void onApplyAllCountry()}
            disabled={!canWrite || saving || !country}
          >
            {saving ? "Applying..." : <TooltipText text="Applica tutti">Apply all suggested (country)</TooltipText>}
          </button>
        </div>
      </div>

      <div className="enterprise-warning">
        Suggested values must be verified against your preferred source. Resolution order is: country override, tenant default, library suggestion, missing.
      </div>

      <div className="enterprise-kpi-grid" style={{ position: "sticky", top: 12, zIndex: 2 }}>
        <article className="enterprise-kpi-card">
          <strong>
            <TooltipText text="Fattori mancanti">Missing factors</TooltipText>
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

      {issueSummary.missingFactorsCount > 0 ? (
        <div className="enterprise-warning">
          Factor missing: one or more records cannot resolve a factor with the current setup. <Link href="/app/factors">Go to Factors</Link> or use
          {" "}
          <button className="enterprise-button-secondary" type="button" onClick={() => void onApplyAllCountry()} disabled={!canWrite || saving || !country}>
            Apply suggested
          </button>
          {" "}
          when a numeric starter reference exists.
        </div>
      ) : null}

      {issueSummary.nonComputableRecordCount > 0 ? (
        <div className="enterprise-warning">
          Record present but not computable: {issueSummary.nonComputableRecordCount} record(s) still need a usable factor or a supported methodology before totals can be trusted.
        </div>
      ) : null}

      {issueSummary.missingEvidenceCount > 0 ? (
        <div className="enterprise-warning">
          Evidence missing: {issueSummary.missingEvidenceCount} GHG record(s) still require evidence before assurance-ready export.
          <span> </span>
          <Link href="/app/evidence">Aggiungi evidenza</Link>
        </div>
      ) : null}

      {Array.isArray(payload?.scope3Support) && payload.scope3Support.some((item) => item.status !== "supported") ? (
        <div className="enterprise-warning">
          Category not enabled or partial: some Scope 3 categories are intentionally outside the pilot perimeter and must not be presented as fully covered.
        </div>
      ) : null}

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}

      <div className="enterprise-table-wrap">
        <table className="enterprise-table">
          <tbody>
            <tr>
              <td>Reporting year</td>
              <td>
                <input
                  className="enterprise-input"
                  type="number"
                  min="1900"
                  max="2200"
                  value={reportingYear}
                  onChange={(event) => setReportingYear(Number(event.target.value) || currentYear)}
                />
              </td>
              <td>
                <TooltipText text="Libreria fattori">Source library</TooltipText>
              </td>
              <td>
                <select className="enterprise-input" value={library} onChange={(event) => setLibrary(event.target.value)}>
                  <option value="IPCC">IPCC default</option>
                  <option value="DEFRA">UK DEFRA</option>
                  <option value="EPA">EPA (US)</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </td>
            </tr>
            <tr>
              <td>Company</td>
              <td>
                <select
                  className="enterprise-input"
                  value={companyId}
                  onChange={(event) => setCompanyId(event.target.value)}
                >
                  <option value="">All companies</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>Site</td>
              <td>
                <select className="enterprise-input" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
                  <option value="">No site selected</option>
                  {siteOptions.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>Country</td>
              <td>
                <input
                  className="enterprise-input"
                  type="text"
                  placeholder="IT"
                  value={country}
                  onChange={(event) => setCountry(normalizeCountry(event.target.value))}
                />
              </td>
              <td>Refrigerant type</td>
              <td>
                <select
                  className="enterprise-input"
                  value={refrigerantType || ""}
                  onChange={(event) => setRefrigerantType(event.target.value)}
                >
                  {refrigerantOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>Scope</td>
              <td>
                <select className="enterprise-input" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)}>
                  <option value="">All scopes</option>
                  <option value="scope1">Scope 1</option>
                  <option value="scope2">Scope 2</option>
                  <option value="scope3">Scope 3</option>
                </select>
              </td>
              <td>Method</td>
              <td>
                <select className="enterprise-input" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
                  <option value="">All methods</option>
                  <option value="activity">activity</option>
                  <option value="spend">spend</option>
                  <option value="supplier_specific">supplier_specific</option>
                  <option value="direct_tco2e">direct_tco2e</option>
                </select>
              </td>
            </tr>
            <tr>
              <td>Scope 3 category</td>
              <td>
                <input
                  className="enterprise-input"
                  type="number"
                  min="1"
                  max="15"
                  value={scope3Category}
                  onChange={(event) => setScope3Category(event.target.value)}
                  disabled={scopeFilter !== "scope3"}
                />
              </td>
              <td>Spend category</td>
              <td>
                <input
                  className="enterprise-input"
                  type="text"
                  value={spendCategory}
                  onChange={(event) => setSpendCategory(event.target.value)}
                  placeholder="example: office_supplies"
                />
              </td>
            </tr>
            <tr>
              <td>Transport mode</td>
              <td>
                <input
                  className="enterprise-input"
                  type="text"
                  value={transportMode}
                  onChange={(event) => setTransportMode(event.target.value)}
                  placeholder="road/rail/sea/air"
                />
              </td>
              <td>Region</td>
              <td>
                <input className="enterprise-input" type="text" value={region} onChange={(event) => setRegion(event.target.value)} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {!country ? <p className="enterprise-status">Select a country (or pick a site with country) to load suggestions.</p> : null}
      {loading ? <p className="enterprise-status">Loading factors...</p> : null}

      {!loading && tableRows.length > 0 ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Unit</th>
                <th>Tenant default</th>
                <th>
                  <TooltipText text="Fattore per paese">Country override</TooltipText>
                </th>
                <th>Suggested</th>
                <th>Dimensions</th>
                <th>
                  <TooltipText text="Riferimento usato">Reference</TooltipText>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const suggestion = row.suggestion || null;
                const hasSuggestedValue = suggestion?.value != null;

                return (
                  <tr key={row.key}>
                    <td>{row.key}</td>
                    <td>{row.unit}</td>
                    <td>{row.tenantDefault?.value ?? "-"}</td>
                    <td>{row.countryOverride?.value ?? "-"}</td>
                    <td>
                      {hasSuggestedValue ? suggestion.value : "Suggested (no value)"}
                      {suggestion?.notes ? <div className="enterprise-muted">{suggestion.notes}</div> : null}
                    </td>
                    <td>
                      {suggestion?.scope || "-"}
                      {suggestion?.scope3_category ? ` · cat ${suggestion.scope3_category}` : ""}
                      {suggestion?.method ? ` · ${suggestion.method}` : ""}
                      {suggestion?.spend_category ? <div className="enterprise-muted">spend: {suggestion.spend_category}</div> : null}
                      {suggestion?.transport_mode ? <div className="enterprise-muted">mode: {suggestion.transport_mode}</div> : null}
                      {suggestion?.region ? <div className="enterprise-muted">region: {suggestion.region}</div> : null}
                      {suggestion?.refrigerant_type ? (
                        <div className="enterprise-muted">refrigerant: {suggestion.refrigerant_type}</div>
                      ) : null}
                    </td>
                    <td>
                      {suggestion?.source_url ? (
                        <a href={suggestion.source_url} target="_blank" rel="noreferrer">
                          {suggestion.source_label || suggestion.source_url}
                        </a>
                      ) : (
                        suggestion?.source_label || "-"
                      )}
                    </td>
                    <td>
                      <div className="enterprise-inline-actions">
                        <button
                          className="enterprise-button-secondary"
                          type="button"
                          disabled={!canWrite || saving || !country || !hasSuggestedValue}
                          onClick={() => void onApplySuggested(row, "country")}
                        >
                          <TooltipText text="Applica suggerito">Apply suggested (this country)</TooltipText>
                        </button>
                        <button
                          className="enterprise-button-secondary"
                          type="button"
                          disabled={!canWrite || saving || !hasSuggestedValue}
                          onClick={() => void onApplySuggested(row, "tenant")}
                        >
                          <TooltipText text="Default del tenant">Apply suggested (tenant default)</TooltipText>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="enterprise-grid">
        <h3 className="enterprise-section-title">Import library CSV</h3>
        <input className="enterprise-input" type="file" accept=".csv,text/csv" onChange={onCsvFileChange} />
        <textarea
          className="enterprise-input"
          rows={8}
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="library,country,reporting_year,key,unit,value,source_label,source_url,notes"
        />
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void onImportCsv()} disabled={!canWrite || importing}>
            {importing ? "Importing..." : "Upload CSV to library"}
          </button>
        </div>
      </div>

      <p className="enterprise-muted">
        Need to verify impact in output? Open <Link href="/app/emissions">Emissions</Link> after applying values.
      </p>
    </section>
  );
}
