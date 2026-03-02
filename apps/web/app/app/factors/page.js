"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantSession } from "../_components/use-tenant-session";

const CUSTOM_REFERENCE_VALUE = "__custom__";
const PRESET_COUNTRIES = ["UK", "US", "IT"];
const PRESET_YEARS = [2026, 2025, 2024, 2023];

const formatReferenceSource = (option) => {
  if (!option || !option.url) {
    return "";
  }
  const meta = [option.jurisdiction, option.year].filter(Boolean).join(" · ");
  return meta ? `${option.label} (${meta}) - ${option.url}` : `${option.label} - ${option.url}`;
};

const getSelectedReferenceId = (factor) => {
  const source = typeof factor?.source === "string" ? factor.source : "";
  const options = Array.isArray(factor?.referenceOptions) ? factor.referenceOptions : [];
  for (const option of options) {
    if (option?.url && source.includes(option.url)) {
      return option.id;
    }
  }
  return CUSTOM_REFERENCE_VALUE;
};

const findSuggestedPreset = (factor, country, year) => {
  const selectedReferenceId = getSelectedReferenceId(factor);
  const options = Array.isArray(factor?.referenceOptions) ? factor.referenceOptions : [];
  const selectedOption =
    selectedReferenceId !== CUSTOM_REFERENCE_VALUE
      ? options.find((option) => option.id === selectedReferenceId) || null
      : null;
  const orderedOptions = selectedOption ? [selectedOption, ...options.filter((option) => option.id !== selectedOption.id)] : options;

  for (const option of orderedOptions) {
    const presets = Array.isArray(option?.presets) ? option.presets : [];
    const exact = presets.find((preset) => preset.country === country && Number(preset.year) === Number(year));
    if (exact) {
      return { option, preset: exact };
    }
    const byCountry = presets.filter((preset) => preset.country === country);
    if (byCountry.length > 0) {
      byCountry.sort((a, b) => Number(b.year) - Number(a.year));
      return { option, preset: byCountry[0] };
    }
  }

  return null;
};

export default function FactorsPage() {
  const tenant = useTenantSession();
  const [factors, setFactors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [presetCountry, setPresetCountry] = useState("IT");
  const [presetYear, setPresetYear] = useState(PRESET_YEARS[0]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const loadFactors = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/factors`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setFactors(Array.isArray(payload.factors) ? payload.factors : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load factors");
      setFactors([]);
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void loadFactors();
    }
  }, [tenant.loading, tenant.tenantId, loadFactors]);

  const missingRequired = useMemo(
    () => factors.filter((item) => item.required && (item.value == null || item.value === "")).map((item) => item.key),
    [factors],
  );

  const onSave = useCallback(async () => {
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
          factors: factors.map((item) => ({
            key: item.key,
            value: item.value === "" || item.value == null ? null : Number(item.value),
            source: item.source || null,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setFactors(Array.isArray(payload.factors) ? payload.factors : factors);
      setMessage("Emission factors saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save factors");
    } finally {
      setSaving(false);
    }
  }, [factors, tenant.tenantId]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Factors</h2>
          <p className="enterprise-muted">Tenant emission factors used for Scope 1 and Scope 2 calculations.</p>
        </div>
        <div className="enterprise-inline-actions">
          <label className="enterprise-muted" htmlFor="factor-country">
            Country
          </label>
          <select
            id="factor-country"
            className="enterprise-input"
            value={presetCountry}
            onChange={(event) => setPresetCountry(event.target.value)}
          >
            {PRESET_COUNTRIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <label className="enterprise-muted" htmlFor="factor-year">
            Year
          </label>
          <select
            id="factor-year"
            className="enterprise-input"
            value={presetYear}
            onChange={(event) => setPresetYear(Number(event.target.value))}
          >
            {PRESET_YEARS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button className="enterprise-button-secondary" type="button" onClick={() => void loadFactors()}>
            Refresh
          </button>
          <button className="enterprise-button-primary" type="button" onClick={() => void onSave()} disabled={!canWrite || saving}>
            {saving ? "Saving..." : "Save factors"}
          </button>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}
      {loading ? <p className="enterprise-status">Loading factors...</p> : null}

      {missingRequired.length > 0 ? (
        <div className="enterprise-warning">
          Missing required factors: {missingRequired.join(", ")}. Emissions output can be incomplete until these are set.
        </div>
      ) : null}

      {!loading ? (
        <div className="enterprise-table-wrap">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Unit</th>
                <th>Value</th>
                <th>Reference</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((factor) => (
                <tr key={factor.key}>
                  <td>{factor.key}</td>
                  <td>{factor.label}</td>
                  <td>{factor.unit}</td>
                  <td>
                    <input
                      className="enterprise-input"
                      type="number"
                      step="any"
                      value={factor.value ?? ""}
                      onChange={(event) =>
                        setFactors((current) =>
                          current.map((item) =>
                            item.key === factor.key ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    <select
                      className="enterprise-input"
                      value={getSelectedReferenceId(factor)}
                      onChange={(event) =>
                        setFactors((current) =>
                          current.map((item) => {
                            if (item.key !== factor.key) {
                              return item;
                            }
                            const options = Array.isArray(item.referenceOptions) ? item.referenceOptions : [];
                            const selected = options.find((option) => option.id === event.target.value) || null;
                            if (!selected) {
                              return item;
                            }
                            return {
                              ...item,
                              source: formatReferenceSource(selected),
                            };
                          }),
                        )
                      }
                      disabled={!canWrite}
                    >
                      <option value={CUSTOM_REFERENCE_VALUE}>Manual / custom source</option>
                      {(factor.referenceOptions || []).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {getSelectedReferenceId(factor) !== CUSTOM_REFERENCE_VALUE ? (
                      <a
                        className="enterprise-muted"
                        href={(factor.referenceOptions || []).find((option) => option.id === getSelectedReferenceId(factor))?.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open reference
                      </a>
                    ) : null}
                  </td>
                  <td>
                    {(() => {
                      const suggested = findSuggestedPreset(factor, presetCountry, presetYear);
                      if (!suggested) {
                        return <p className="enterprise-muted">No suggested preset for {presetCountry}/{presetYear}.</p>;
                      }
                      return (
                        <div>
                          <p className="enterprise-muted">
                            Suggested {presetCountry}/{presetYear}: <strong>{suggested.preset.value}</strong>
                            {Number(suggested.preset.year) !== Number(presetYear)
                              ? ` (from ${suggested.preset.year})`
                              : ""}
                            {suggested.preset.note ? ` · ${suggested.preset.note}` : ""}
                          </p>
                          <button
                            type="button"
                            className="enterprise-button-secondary"
                            disabled={!canWrite}
                            onClick={() =>
                              setFactors((current) =>
                                current.map((item) =>
                                  item.key === factor.key
                                    ? {
                                        ...item,
                                        value: suggested.preset.value,
                                        source: formatReferenceSource(suggested.option),
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            Apply suggested value
                          </button>
                        </div>
                      );
                    })()}
                    <input
                      className="enterprise-input"
                      type="text"
                      value={factor.source || ""}
                      onChange={(event) =>
                        setFactors((current) =>
                          current.map((item) =>
                            item.key === factor.key ? { ...item, source: event.target.value } : item,
                          ),
                        )
                      }
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    {factor.required && (factor.value == null || factor.value === "") ? (
                      <span className="enterprise-pill enterprise-pill-warning">Missing</span>
                    ) : (
                      <span className="enterprise-pill enterprise-pill-success">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="enterprise-muted">
        Need to verify factors in output? Open <Link href="/app/emissions">Emissions</Link> after updating values.
      </p>
    </section>
  );
}
