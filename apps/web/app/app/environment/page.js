"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();

const initialState = {
  loading: true,
  error: "",
  definitions: [],
  metrics: [],
  warnings: [],
};

const toNumber = (value) => {
  if (value === "" || value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function EnvironmentPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [reportingYear, setReportingYear] = useState(currentYear);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [sites, setSites] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [state, setState] = useState(initialState);
  const [values, setValues] = useState({});
  const [evidenceByMetricKey, setEvidenceByMetricKey] = useState({});
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const groupedDefinitions = useMemo(() => {
    const groups = new Map();
    for (const definition of state.definitions) {
      if (definition.validation?.derived) {
        continue;
      }
      if (!groups.has(definition.category)) {
        groups.set(definition.category, []);
      }
      groups.get(definition.category).push(definition);
    }
    return [...groups.entries()];
  }, [state.definitions]);

  const siteMap = useMemo(() => {
    const map = new Map();
    for (const site of sites) {
      map.set(site.id, site);
    }
    return map;
  }, [sites]);

  const loadSites = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const query = selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : "";
    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/sites${query}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    const nextSites = Array.isArray(payload.sites) ? payload.sites : [];
    setSites(nextSites);

    if (selectedSiteId && !nextSites.some((item) => item.id === selectedSiteId)) {
      setSelectedSiteId("");
    }
  }, [selectedCompanyId, selectedSiteId, tenant.tenantId]);

  const loadEvidence = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    setEvidence(Array.isArray(payload.evidence) ? payload.evidence : []);
  }, [tenant.tenantId]);

  const loadMetrics = useCallback(async () => {
    if (!tenant.tenantId || !selectedSiteId || !reportingYear) {
      setState((current) => ({ ...current, loading: false }));
      return;
    }

    setState((current) => ({ ...current, loading: true, error: "" }));
    setSaveMessage("");

    try {
      const query = new URLSearchParams({
        siteId: selectedSiteId,
        year: String(reportingYear),
      });
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/metrics?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const definitions = Array.isArray(payload.definitions) ? payload.definitions : [];
      const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];

      const nextValues = {};
      const nextEvidence = {};
      for (const definition of definitions) {
        if (definition.validation?.derived) {
          continue;
        }
        nextValues[definition.key] = "";
        nextEvidence[definition.key] = [];
      }

      for (const metric of metrics) {
        nextValues[metric.metricKey] = Number.isFinite(metric.value) ? String(metric.value) : "";
        nextEvidence[metric.metricKey] = Array.isArray(metric.evidenceIds) ? metric.evidenceIds : [];
      }

      setValues(nextValues);
      setEvidenceByMetricKey(nextEvidence);
      setState({
        loading: false,
        error: "",
        definitions,
        metrics,
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load metrics",
      }));
    }
  }, [reportingYear, selectedSiteId, tenant.tenantId]);

  const loadSummary = useCallback(async () => {
    if (!tenant.tenantId || !reportingYear) {
      return;
    }

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/summary/environment?year=${encodeURIComponent(reportingYear)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      setSummary(payload);
    } catch (_error) {
      setSummary(null);
    }
  }, [reportingYear, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void Promise.all([loadSites(), loadEvidence()]).catch((error) => {
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load scope data",
        }));
      });
    }
  }, [tenant.loading, tenant.tenantId, loadSites, loadEvidence]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && selectedSiteId && reportingYear) {
      void loadMetrics();
    }
  }, [tenant.loading, tenant.tenantId, selectedSiteId, reportingYear, loadMetrics]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && reportingYear) {
      void loadSummary();
    }
  }, [tenant.loading, tenant.tenantId, reportingYear, loadSummary]);

  const clientValidationErrors = useMemo(() => {
    const errors = [];
    const electricity = toNumber(values.electricity_kwh);
    const renewable = toNumber(values.renewable_electricity_kwh);
    const wasteGenerated = toNumber(values.waste_generated_tons);
    const wasteRecycled = toNumber(values.waste_recycled_tons);

    if (renewable != null && electricity != null && renewable > electricity) {
      errors.push("renewable_electricity_kwh cannot exceed electricity_kwh");
    }

    if (wasteRecycled != null && wasteGenerated != null && wasteRecycled > wasteGenerated) {
      errors.push("waste_recycled_tons cannot exceed waste_generated_tons");
    }

    return errors;
  }, [values]);

  const waterDischargeWarning = useMemo(() => {
    const withdrawal = toNumber(values.water_withdrawal_m3);
    const discharge = toNumber(values.water_discharge_m3);
    if (withdrawal == null || discharge == null) {
      return "";
    }
    if (discharge > withdrawal) {
      return "water_discharge_m3 is higher than water_withdrawal_m3 (warning)";
    }
    return "";
  }, [values]);

  const save = async () => {
    if (!tenant.tenantId || !selectedSiteId || !reportingYear) {
      return;
    }

    setSaving(true);
    setSaveMessage("");

    try {
      const entries = state.definitions
        .filter((definition) => !definition.validation?.derived)
        .map((definition) => ({
          metricKey: definition.key,
          value: toNumber(values[definition.key]) ?? 0,
          evidenceIds: Array.isArray(evidenceByMetricKey[definition.key]) ? evidenceByMetricKey[definition.key] : [],
        }));

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/metrics/bulk`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          siteId: selectedSiteId,
          reportingYear,
          entries,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const validationErrors = Array.isArray(payload.errors) ? payload.errors.join("; ") : payload?.error;
        throw new Error(validationErrors || `HTTP ${response.status}`);
      }

      setSaveMessage(
        payload.warnings?.length
          ? `Saved with warnings: ${payload.warnings.join("; ")}`
          : "Environment metrics saved successfully",
      );
      await Promise.all([loadMetrics(), loadSummary()]);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to save metrics");
    } finally {
      setSaving(false);
    }
  };

  const onUploadEvidence = async (event) => {
    const file = event.target.files?.[0] || null;
    if (!file || !tenant.tenantId || !selectedSiteId) {
      return;
    }

    setUploading(true);
    setSaveMessage("");

    try {
      const formData = new FormData();
      formData.append("siteId", selectedSiteId);
      formData.append("file", file);

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence/upload`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      await loadEvidence();
      setSaveMessage("Evidence uploaded to vault");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to upload evidence");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const updateMetricEvidence = (metricKey, selectedEvidenceIds) => {
    setEvidenceByMetricKey((current) => ({
      ...current,
      [metricKey]: selectedEvidenceIds,
    }));
  };

  const selectedSite = selectedSiteId ? siteMap.get(selectedSiteId) : null;
  const companySummary = useMemo(() => {
    if (!summary || !selectedCompanyId) {
      return null;
    }
    return (summary.companies || []).find((item) => item.companyId === selectedCompanyId) || null;
  }, [selectedCompanyId, summary]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Environment Data</h2>
          <p className="enterprise-muted">Annual site metrics grouped by Energy, Fuels, Refrigerants, Waste and Water.</p>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="env-year">
            Reporting year
          </label>
          <input
            id="env-year"
            className="enterprise-input"
            type="number"
            min="1900"
            max="2200"
            value={reportingYear}
            onChange={(event) => setReportingYear(Number(event.target.value))}
          />

          <label className="enterprise-label" htmlFor="env-company">
            Company
          </label>
          <select
            id="env-company"
            className="enterprise-input"
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              companyScope.setActiveCompanyId(event.target.value);
              setSelectedSiteId("");
            }}
          >
            <option value="">Select company</option>
            {companyScope.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
                {company.isHolding ? " (Holding)" : ""}
              </option>
            ))}
          </select>

          <label className="enterprise-label" htmlFor="env-site">
            Site
          </label>
          <select
            id="env-site"
            className="enterprise-input"
            value={selectedSiteId}
            onChange={(event) => setSelectedSiteId(event.target.value)}
          >
            <option value="">Select site</option>
            {sites
              .filter((site) => !selectedCompanyId || site.companyId === selectedCompanyId)
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
          </select>

          <label className="enterprise-label" htmlFor="env-upload">
            Upload evidence
          </label>
          <input
            id="env-upload"
            className="enterprise-input"
            type="file"
            onChange={(event) => void onUploadEvidence(event)}
            disabled={!selectedSiteId || uploading}
          />
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {state.error ? <p className="enterprise-status enterprise-status-error">{state.error}</p> : null}
      {saveMessage ? <p className="enterprise-status">{saveMessage}</p> : null}

      {clientValidationErrors.length > 0 ? (
        <div className="enterprise-warning">
          {clientValidationErrors.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      ) : null}

      {waterDischargeWarning ? <div className="enterprise-warning">{waterDischargeWarning}</div> : null}

      {selectedSite ? (
        <div className="enterprise-card">
          <h3>
            Selected site: {selectedSite.name} {selectedSite.waterStressed ? "(Water-stressed)" : ""}
          </h3>
          <p className="enterprise-muted">
            Derived metric `sites_in_water_stressed_areas`: tenant {summary?.tenantDerived?.sites_in_water_stressed_areas ?? 0}
            {companySummary ? ` · company ${companySummary.sitesInWaterStressedAreas ?? 0}` : ""}
          </p>
        </div>
      ) : null}

      {state.loading ? <p className="enterprise-status">Loading environment metrics...</p> : null}

      {!state.loading && selectedSiteId && groupedDefinitions.length > 0
        ? groupedDefinitions.map(([category, definitions]) => (
            <div className="enterprise-table-wrap" key={category}>
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th colSpan={5}>{category}</th>
                  </tr>
                  <tr>
                    <th>Metric</th>
                    <th>Unit</th>
                    <th>Value</th>
                    <th>Evidence</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {definitions.map((definition) => (
                    <tr key={definition.key}>
                      <td>
                        {definition.label}
                        {definition.isRequired ? <span className="enterprise-required">*</span> : null}
                      </td>
                      <td>{definition.unit}</td>
                      <td>
                        <input
                          className="enterprise-input"
                          type="number"
                          step="any"
                          min="0"
                          value={values[definition.key] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [definition.key]: event.target.value,
                            }))
                          }
                          disabled={!canWrite}
                        />
                      </td>
                      <td>
                        <select
                          className="enterprise-input"
                          multiple
                          value={evidenceByMetricKey[definition.key] || []}
                          onChange={(event) =>
                            updateMetricEvidence(
                              definition.key,
                              [...event.target.selectedOptions].map((option) => option.value),
                            )
                          }
                          disabled={!canWrite}
                        >
                          {evidence.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.filename}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{definition.description || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        : null}

      <div className="enterprise-inline-actions">
        <button className="enterprise-button-secondary" type="button" onClick={() => void loadMetrics()}>
          Refresh
        </button>
        <button
          className="enterprise-button-primary"
          type="button"
          onClick={() => void save()}
          disabled={!canWrite || !selectedSiteId || saving || clientValidationErrors.length > 0}
        >
          {saving ? "Saving..." : "Save metrics"}
        </button>
      </div>
    </section>
  );
}
