"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

function TooltipText({ text, children }) {
  return (
    <span className="enterprise-tooltip" data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

const toApiError = (payload, status) => {
  const code = typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : `http_${status || 500}`;
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `HTTP ${status || 500}`;
  return `${message} [${code}]`;
};

export default function StandardsPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [framework, setFramework] = useState("GRI");
  const [industryCode, setIndustryCode] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [metrics, setMetrics] = useState([]);
  const [csv, setCsv] = useState("framework,industry_code,code,title,unit,sdgs,reference_url,internal_type,internal_key\nGRI,,GRI 305-1,Direct (Scope 1) GHG emissions,tCO2e,13,https://www.globalreporting.org/,ghg_activity,s1_stationary_natural_gas_mwh");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role === "TenantAdmin" || tenant.role === "Manager", [tenant.role]);

  const loadCatalog = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const query = new URLSearchParams({ framework });
      if (industryCode.trim()) {
        query.set("industryCode", industryCode.trim());
      }
      query.set("limit", "500");

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }

      setMetrics(Array.isArray(payload.metrics) ? payload.metrics : []);
    } catch (loadError) {
      setMetrics([]);
      setError(loadError instanceof Error ? loadError.message : "Unable to load standards catalog");
    } finally {
      setLoading(false);
    }
  }, [framework, industryCode, tenant.tenantId]);

  const applyRecommended = useCallback(async () => {
    if (!tenant.tenantId || !companyId) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards/company/${encodeURIComponent(companyId)}/recommended`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ framework, sasbIndustryCode: industryCode.trim() || null }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }
      setMessage(`Recommended set applied (${payload?.result?.enabledCount || 0} definitions).`);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Unable to apply recommended set");
    }
  }, [companyId, framework, industryCode, tenant.tenantId]);

  const importCsv = useCallback(async () => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }

    setImporting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/standards/import-csv`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(toApiError(payload, response.status));
      }

      setMessage(
        `Imported ${payload?.summary?.total || 0} rows (inserted ${payload?.summary?.inserted || 0}, updated ${payload?.summary?.updated || 0}, mapped ${payload?.summary?.mapped || 0}).`,
      );
      await loadCatalog();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import standards CSV");
    } finally {
      setImporting(false);
    }
  }, [canWrite, csv, loadCatalog, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadCatalog();
    }
  }, [tenant.loading, tenant.tenantId, loadCatalog]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Standards Catalog</h2>
          <p className="enterprise-muted">Import and map short-code metrics for GRI / SASB per tenant.</p>
        </div>
        <div className="enterprise-inline-actions">
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadCatalog()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <div>
            <label className="enterprise-label" htmlFor="standards-framework">
              <TooltipText text="Framework ESG">Framework</TooltipText>
            </label>
            <select
              id="standards-framework"
              className="enterprise-input"
              value={framework}
              onChange={(event) => setFramework(event.target.value)}
            >
              <option value="GRI">GRI</option>
              <option value="SASB">SASB</option>
            </select>
          </div>
          <div>
            <label className="enterprise-label" htmlFor="standards-industry">SASB industry code</label>
            <input
              id="standards-industry"
              className="enterprise-input"
              value={industryCode}
              onChange={(event) => setIndustryCode(event.target.value)}
              placeholder="e.g. IF-CM-000.A"
            />
          </div>
          <div>
            <label className="enterprise-label" htmlFor="standards-company">Company</label>
            <select
              id="standards-company"
              className="enterprise-input"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            >
              <option value="">Select company</option>
              {companyScope.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadCatalog()}>
            Load catalog
          </button>
          <button
            className="enterprise-button-primary"
            type="button"
            onClick={() => void applyRecommended()}
            disabled={!companyId || !canWrite}
          >
            <TooltipText text="Set consigliato">Apply recommended set</TooltipText>
          </button>
        </div>
      </div>

      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status enterprise-status-ok">{message}</p> : null}

      <div className="enterprise-card">
        <h3>
          <TooltipText text="Importa standard CSV">Import Standards CSV</TooltipText>
        </h3>
        <p className="enterprise-muted">
          Allowed columns: framework, industry_code, code, title, unit, method_hint, sdgs, reference_url, internal_type,
          internal_key, notes.
        </p>
        <textarea
          className="enterprise-input"
          rows={8}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          disabled={!canWrite}
        />
        <div className="enterprise-inline-actions" style={{ marginTop: 10 }}>
          <button className="enterprise-button-primary" type="button" onClick={() => void importCsv()} disabled={!canWrite || importing}>
            {importing ? "Importing..." : <TooltipText text="Importa standard CSV">Import CSV</TooltipText>}
          </button>
        </div>
      </div>

      <div className="enterprise-card">
        <h3>Catalog Preview</h3>
        {loading ? <p className="enterprise-status">Loading...</p> : null}
        {!loading && metrics.length === 0 ? <div className="enterprise-empty">No standards metrics found.</div> : null}
        {!loading && metrics.length > 0 ? (
          <div className="enterprise-table-wrap">
            <table className="enterprise-table enterprise-table-wide">
              <thead>
                <tr>
                  <th>
                    <TooltipText text="Framework ESG">Framework</TooltipText>
                  </th>
                  <th>Industry</th>
                  <th>
                    <TooltipText text="Codice disclosure">Code</TooltipText>
                  </th>
                  <th>Title</th>
                  <th>Unit</th>
                  <th>SDGs</th>
                  <th>Reference</th>
                  <th>
                    <TooltipText text="Mappa ai dati interni">Mappings</TooltipText>
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((item) => (
                  <tr key={item.id}>
                    <td>{item.framework}</td>
                    <td>{item.industryCode || "-"}</td>
                    <td>{item.code}</td>
                    <td>{item.title}</td>
                    <td>{item.unit || "-"}</td>
                    <td>{Array.isArray(item.sdgs) && item.sdgs.length > 0 ? item.sdgs.join(", ") : "-"}</td>
                    <td>
                      {item.referenceUrl ? (
                        <a href={item.referenceUrl} target="_blank" rel="noreferrer">
                          Source
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{item.mappingsCount || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
