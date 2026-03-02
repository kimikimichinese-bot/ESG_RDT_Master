"use client";

import { useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();

const parseNumber = (value) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

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

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Governance</h2>
          <p className="enterprise-muted">Board composition, policies, incidents and governance KPIs by company/year.</p>
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
                <label className="enterprise-label">Board total</label>
                <input className="enterprise-input" type="number" min="0" value={governance.boardTotal} onChange={(e) => setGovernance((c) => ({ ...c, boardTotal: e.target.value }))} />
                <label className="enterprise-label">Board women</label>
                <input className="enterprise-input" type="number" min="0" value={governance.boardWomen} onChange={(e) => setGovernance((c) => ({ ...c, boardWomen: e.target.value }))} />
                <label className="enterprise-label">Independent directors</label>
                <input className="enterprise-input" type="number" min="0" value={governance.boardIndependent} onChange={(e) => setGovernance((c) => ({ ...c, boardIndependent: e.target.value }))} />
                <label className="enterprise-label">Board meetings</label>
                <input className="enterprise-input" type="number" min="0" value={governance.boardMeetings} onChange={(e) => setGovernance((c) => ({ ...c, boardMeetings: e.target.value }))} />
              </div>
            </div>

            <div className="enterprise-card">
              <h3 className="enterprise-section-title">Incidents & compliance</h3>
              <div className="enterprise-filter-grid">
                <label className="enterprise-label">GDPR training</label>
                <select className="enterprise-input" value={governance.gdprTraining ? "yes" : "no"} onChange={(e) => setGovernance((c) => ({ ...c, gdprTraining: e.target.value === "yes" }))}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
                <label className="enterprise-label">Data breaches count</label>
                <input className="enterprise-input" type="number" min="0" value={governance.dataBreachesCount} onChange={(e) => setGovernance((c) => ({ ...c, dataBreachesCount: e.target.value }))} />
                <label className="enterprise-label">Corruption incidents count</label>
                <input className="enterprise-input" type="number" min="0" value={governance.corruptionIncidentsCount} onChange={(e) => setGovernance((c) => ({ ...c, corruptionIncidentsCount: e.target.value }))} />
                <label className="enterprise-label">Fines amount (EUR)</label>
                <input className="enterprise-input" type="number" min="0" step="0.01" value={governance.finesAmountEur} onChange={(e) => setGovernance((c) => ({ ...c, finesAmountEur: e.target.value }))} />
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
                {policies.map((row, idx) => (
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
                ))}
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
