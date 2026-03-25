"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();

const parseNumber = (value) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const SYSTEM_GOVERNANCE_KEYS = new Set([
  "board_total",
  "board_women",
  "board_independent",
  "board_meetings",
  "anti_corruption_policy",
  "whistleblowing_channel",
  "data_privacy_policy",
  "supplier_code_of_conduct",
  "gdpr_training",
  "data_breaches_count",
  "corruption_incidents_count",
  "fines_amount_eur",
  "policy_anti_corruption",
  "policy_whistleblowing",
  "policy_data_privacy",
  "policy_supplier_code",
  "policy_grievance_mechanism",
]);

export default function GovernancePage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [reportingYear, setReportingYear] = useState(currentYear);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [computed, setComputed] = useState({
    women_on_board_pct: 0,
    independent_pct: 0,
    governance_completeness: 0,
  });

  const [governance, setGovernance] = useState({
    boardTotal: "0",
    boardWomen: "0",
    boardIndependent: "0",
    boardMeetings: "0",
    gdprTraining: false,
    dataBreachesCount: "0",
    corruptionIncidentsCount: "0",
    finesAmountEur: "0",
    notes: "",
  });

  const [policies, setPolicies] = useState([
    { policyKey: "anti_corruption", status: "no", notes: "" },
    { policyKey: "whistleblowing", status: "no", notes: "" },
    { policyKey: "data_privacy", status: "no", notes: "" },
    { policyKey: "supplier_code", status: "no", notes: "" },
    { policyKey: "grievance_mechanism", status: "no", notes: "" },
  ]);
  const [governanceDefinitions, setGovernanceDefinitions] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [enabledGovernanceFields, setEnabledGovernanceFields] = useState(null);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setSelectedCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  useEffect(() => {
    if (!tenant.tenantId || !selectedCompanyId || !reportingYear) {
      return;
    }

    let active = true;
    setLoading(true);
    setError("");

    fetch(
      `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/governance?companyId=${encodeURIComponent(selectedCompanyId)}&year=${encodeURIComponent(reportingYear)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        return payload;
      })
      .then((payload) => {
        if (!active) {
          return;
        }

        const data = payload?.governance || {};
        setGovernance({
          boardTotal: String(data.boardTotal ?? 0),
          boardWomen: String(data.boardWomen ?? 0),
          boardIndependent: String(data.boardIndependent ?? 0),
          boardMeetings: String(data.boardMeetings ?? 0),
          gdprTraining: Boolean(data.gdprTraining),
          dataBreachesCount: String(data.dataBreachesCount ?? 0),
          corruptionIncidentsCount: String(data.corruptionIncidentsCount ?? 0),
          finesAmountEur: String(data.finesAmountEur ?? 0),
          notes: data.notes || "",
        });
        setCustomValues(
          data?.customValues && typeof data.customValues === "object" && !Array.isArray(data.customValues) ? data.customValues : {},
        );
        setGovernanceDefinitions(Array.isArray(payload?.definitions) ? payload.definitions : []);

        if (Array.isArray(payload?.policies) && payload.policies.length > 0) {
          setPolicies(
            payload.policies.map((item) => ({
              policyKey: item.policyKey,
              status: item.status || "no",
              notes: item.notes || "",
            })),
          );
        }

        setComputed({
          women_on_board_pct: Number(payload?.computed?.women_on_board_pct || 0),
          independent_pct: Number(payload?.computed?.independent_pct || 0),
          governance_completeness: Number(payload?.computed?.governance_completeness || 0),
        });
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load governance");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [tenant.tenantId, selectedCompanyId, reportingYear]);

  useEffect(() => {
    if (!Array.isArray(governanceDefinitions) || governanceDefinitions.length === 0) {
      setEnabledGovernanceFields(null);
      return;
    }
    const enabledKeys = governanceDefinitions.filter((item) => item?.enabled !== false).map((item) => item.key);
    setEnabledGovernanceFields(new Set(enabledKeys));
  }, [governanceDefinitions]);

  const isFieldEnabled = (key) => !enabledGovernanceFields || enabledGovernanceFields.has(key);
  const customDefinitions = useMemo(
    () =>
      (governanceDefinitions || []).filter((item) => {
        if (!item?.key || item.enabled === false) {
          return false;
        }
        if (item.isSystem === false || item.custom === true) {
          return true;
        }
        return !SYSTEM_GOVERNANCE_KEYS.has(item.key);
      }),
    [governanceDefinitions],
  );

  const onSave = async () => {
    if (!tenant.tenantId || !selectedCompanyId || !canWrite) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/governance`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          reportingYear,
          governance,
          customValues,
          policies,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setComputed({
        women_on_board_pct: Number(payload?.computed?.women_on_board_pct || 0),
        independent_pct: Number(payload?.computed?.independent_pct || 0),
        governance_completeness: Number(payload?.computed?.governance_completeness || 0),
      });
      setMessage("Governance saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save governance");
    } finally {
      setSaving(false);
    }
  };

  const renderCustomField = (definition) => {
    const key = definition.key;
    const type = String(definition.fieldType || "text").toLowerCase();
    const value = customValues?.[key];
    const disabled = !canWrite;

    if (type === "boolean") {
      return (
        <label className="enterprise-checkbox-row" htmlFor={`gov-custom-${key}`}>
          <input
            id={`gov-custom-${key}`}
            type="checkbox"
            checked={value === true}
            onChange={(event) =>
              setCustomValues((current) => ({
                ...current,
                [key]: event.target.checked,
              }))
            }
            disabled={disabled}
          />
          <span>{definition.label || definition.name || key}</span>
        </label>
      );
    }
    if (type === "select") {
      const options = Array.isArray(definition.options) ? definition.options : [];
      return (
        <>
          <label className="enterprise-label" htmlFor={`gov-custom-${key}`}>{definition.label || definition.name || key}</label>
          <select
            id={`gov-custom-${key}`}
            className="enterprise-input"
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setCustomValues((current) => ({
                ...current,
                [key]: event.target.value,
              }))
            }
            disabled={disabled}
          >
            <option value="">Select status</option>
            {options.map((item) => (
              <option key={`${key}:${item}`} value={item}>
                {item}
              </option>
            ))}
          </select>
        </>
      );
    }
    return (
      <>
        <label className="enterprise-label" htmlFor={`gov-custom-${key}`}>{definition.label || definition.name || key}</label>
        <input
          id={`gov-custom-${key}`}
          className="enterprise-input"
          type={type === "number" ? "number" : "text"}
          value={value == null ? "" : String(value)}
          onChange={(event) =>
            setCustomValues((current) => ({
              ...current,
              [key]: type === "number" ? parseNumber(event.target.value) : event.target.value,
            }))
          }
          disabled={disabled}
        />
      </>
    );
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Governance</h2>
          <p className="enterprise-muted">Board composition, policies, incidents and governance KPIs by company/year.</p>
        </div>
        <div className="enterprise-inline-actions">
          <Link className="enterprise-button-secondary" href="/app/definitions?type=governance">
            Manage fields
          </Link>
        </div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <label className="enterprise-label" htmlFor="gov-year">Reporting year</label>
          <input id="gov-year" className="enterprise-input" type="number" min="1900" max="2200" value={reportingYear} onChange={(event) => setReportingYear(Number(event.target.value))} />

          <label className="enterprise-label" htmlFor="gov-company">Company</label>
          <select
            id="gov-company"
            className="enterprise-input"
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              companyScope.setActiveCompanyId(event.target.value);
            }}
          >
            <option value="">Select company</option>
            {companyScope.companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.isHolding ? " (Holding)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {companyScope.error ? <p className="enterprise-status enterprise-status-error">{companyScope.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}

      {selectedCompanyId ? (
        <>
          {loading ? <p className="enterprise-status">Loading governance...</p> : null}
          <div className="enterprise-card-grid">
            <div className="enterprise-card">
              <h3 className="enterprise-section-title">Board</h3>
              <div className="enterprise-filter-grid">
                {isFieldEnabled("board_total") ? (
                  <>
                    <label className="enterprise-label">Board total</label>
                    <input className="enterprise-input" type="number" min="0" value={governance.boardTotal} onChange={(e) => setGovernance((c) => ({ ...c, boardTotal: e.target.value }))} />
                  </>
                ) : null}
                {isFieldEnabled("board_women") ? (
                  <>
                    <label className="enterprise-label">Board women</label>
                    <input className="enterprise-input" type="number" min="0" value={governance.boardWomen} onChange={(e) => setGovernance((c) => ({ ...c, boardWomen: e.target.value }))} />
                  </>
                ) : null}
                {isFieldEnabled("board_independent") ? (
                  <>
                    <label className="enterprise-label">Independent directors</label>
                    <input className="enterprise-input" type="number" min="0" value={governance.boardIndependent} onChange={(e) => setGovernance((c) => ({ ...c, boardIndependent: e.target.value }))} />
                  </>
                ) : null}
                {isFieldEnabled("board_meetings") ? (
                  <>
                    <label className="enterprise-label">Board meetings</label>
                    <input className="enterprise-input" type="number" min="0" value={governance.boardMeetings} onChange={(e) => setGovernance((c) => ({ ...c, boardMeetings: e.target.value }))} />
                  </>
                ) : null}
              </div>
            </div>

            {customDefinitions.length > 0 ? (
              <div className="enterprise-card">
                <h3 className="enterprise-section-title">Custom governance fields</h3>
                <div className="enterprise-filter-grid">
                  {customDefinitions.map((definition) => (
                    <div key={`custom:${definition.key}`}>{renderCustomField(definition)}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="enterprise-card">
              <h3 className="enterprise-section-title">Incidents & compliance</h3>
              <div className="enterprise-filter-grid">
                {isFieldEnabled("gdpr_training") ? (
                  <>
                    <label className="enterprise-label">GDPR training</label>
                    <select className="enterprise-input" value={governance.gdprTraining ? "yes" : "no"} onChange={(e) => setGovernance((c) => ({ ...c, gdprTraining: e.target.value === "yes" }))}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </>
                ) : null}
                {isFieldEnabled("data_breaches_count") ? (
                  <>
                    <label className="enterprise-label">Data breaches count</label>
                    <input className="enterprise-input" type="number" min="0" value={governance.dataBreachesCount} onChange={(e) => setGovernance((c) => ({ ...c, dataBreachesCount: e.target.value }))} />
                  </>
                ) : null}
                {isFieldEnabled("corruption_incidents_count") ? (
                  <>
                    <label className="enterprise-label">Corruption incidents count</label>
                    <input className="enterprise-input" type="number" min="0" value={governance.corruptionIncidentsCount} onChange={(e) => setGovernance((c) => ({ ...c, corruptionIncidentsCount: e.target.value }))} />
                  </>
                ) : null}
                {isFieldEnabled("fines_amount_eur") ? (
                  <>
                    <label className="enterprise-label">Fines amount (EUR)</label>
                    <input className="enterprise-input" type="number" min="0" step="0.01" value={governance.finesAmountEur} onChange={(e) => setGovernance((c) => ({ ...c, finesAmountEur: e.target.value }))} />
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="enterprise-table-wrap">
            <table className="enterprise-table">
              <thead>
                <tr><th colSpan={3}>Policies</th></tr>
                <tr><th>Policy</th><th>Status</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {policies.map((row, idx) =>
                  isFieldEnabled(`policy_${row.policyKey}`) ? (
                    <tr key={row.policyKey}>
                      <td>{row.policyKey}</td>
                      <td>
                        <select
                          className="enterprise-input"
                          value={row.status}
                          onChange={(event) => setPolicies((current) => current.map((item, itemIdx) => (itemIdx === idx ? { ...item, status: event.target.value } : item)))}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                          <option value="in_progress">In progress</option>
                        </select>
                      </td>
                      <td>
                        <input
                          className="enterprise-input"
                          type="text"
                          value={row.notes}
                          onChange={(event) => setPolicies((current) => current.map((item, itemIdx) => (itemIdx === idx ? { ...item, notes: event.target.value } : item)))}
                        />
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>

          <div className="enterprise-kpi-grid">
            <div className="enterprise-kpi-card"><span>Women on board</span><strong>{parseNumber(computed.women_on_board_pct).toFixed(2)}%</strong></div>
            <div className="enterprise-kpi-card"><span>Independent directors</span><strong>{parseNumber(computed.independent_pct).toFixed(2)}%</strong></div>
            <div className="enterprise-kpi-card"><span>Governance completeness</span><strong>{parseNumber(computed.governance_completeness).toFixed(2)}%</strong></div>
          </div>

          <div className="enterprise-inline-actions">
            <button className="enterprise-button-primary" type="button" onClick={() => void onSave()} disabled={!canWrite || saving}>
              {saving ? "Saving..." : "Save governance"}
            </button>
          </div>
        </>
      ) : (
        <div className="enterprise-empty">Select a company to load governance data.</div>
      )}
    </section>
  );
}
