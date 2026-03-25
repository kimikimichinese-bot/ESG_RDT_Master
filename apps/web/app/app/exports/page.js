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

const currentYear = Math.max(new Date().getFullYear(), 2027);

const formatDelta = (value, suffix = "") => {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}${suffix}`;
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

function ApprovalCard({ title, approval, onSetStatus, disabled }) {
  const status = approval?.status || "draft";
  return (
    <article className="enterprise-card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p className="enterprise-muted">
        Status: <strong>{status}</strong> · Approved by {approval?.approvedByName || "-"} · {formatDateTime(approval?.approvedAt)}
      </p>
      <div className="enterprise-inline-actions">
        {["draft", "in_review", "approved"].map((item) => (
          <button
            key={`${title}-${item}`}
            type="button"
            className={status === item ? "enterprise-button-primary" : "enterprise-button-secondary"}
            onClick={() => void onSetStatus(item)}
            disabled={disabled}
          >
            {item}
          </button>
        ))}
      </div>
      {approval?.notes ? <p className="enterprise-muted">Notes: {approval.notes}</p> : null}
    </article>
  );
}

export default function ExportsPage() {
  const tenant = useTenantSession();
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [boardPack, setBoardPack] = useState(null);
  const [actionMessage, setActionMessage] = useState("");

  const canWrite = tenant.role === "TenantAdmin" || tenant.role === "Manager" || tenant.platformRole === "superadmin";

  const load = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [readinessRes, approvalsRes, boardPackRes] = await Promise.all([
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/exports/readiness?year=${encodeURIComponent(year)}`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/approvals?reportingYear=${encodeURIComponent(year)}`, { cache: "no-store" }),
        fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/board-pack?year=${encodeURIComponent(year)}&years=3`, { cache: "no-store" }),
      ]);
      const [readiness, approvalsPayload, boardPackPayload] = await Promise.all([
        readinessRes.json().catch(() => ({})),
        approvalsRes.json().catch(() => ({})),
        boardPackRes.json().catch(() => ({})),
      ]);
      if (!readinessRes.ok || !approvalsRes.ok || !boardPackRes.ok) {
        throw new Error(readiness?.message || approvalsPayload?.message || boardPackPayload?.message || "Unable to load export center");
      }
      setSnapshot(readiness);
      setApprovals(Array.isArray(approvalsPayload.approvals) ? approvalsPayload.approvals : []);
      setBoardPack(boardPackPayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load export center");
      setSnapshot(null);
      setApprovals([]);
      setBoardPack(null);
    } finally {
      setLoading(false);
    }
  }, [tenant.tenantId, year]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      void load();
    }
  }, [tenant.loading, tenant.tenantId, load]);

  const approvalByType = useMemo(
    () => new Map(approvals.map((item) => [item.entityType, item])),
    [approvals],
  );

  const setApprovalStatus = useCallback(
    async (entityType, status) => {
      if (!canWrite || !tenant.tenantId) {
        return;
      }
      setActionMessage("");
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityType,
          reportingYear: year,
          status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setActionMessage(payload?.message || payload?.error || "Unable to update approval");
        return;
      }
      setActionMessage(`${entityType} -> ${status}`);
      await load();
    },
    [canWrite, load, tenant.tenantId, year],
  );

  const runAuditPack = useCallback(async () => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }
    setActionMessage("Generating audit pack...");
    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/exports/audit-pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        year,
        confirm: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setActionMessage(payload?.message || payload?.error || "Audit pack export failed");
      return;
    }
    setActionMessage(`Audit pack ready: ${payload.zipPath || payload.exportDir}`);
    await load();
  }, [canWrite, load, tenant.tenantId, year]);

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Export Center</h2>
          <p className="enterprise-muted">Readiness, approvals and local-first export operations for pilot delivery.</p>
        </div>
        <div className="enterprise-inline-actions">
          <label className="enterprise-inline-field" htmlFor="exports-year">
            <TooltipText text="Seleziona anno">Year</TooltipText>
          </label>
          <input
            id="exports-year"
            className="enterprise-input"
            type="number"
            min="2000"
            max="2200"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
          <button className="enterprise-button-secondary" type="button" onClick={() => void load()}>
            Refresh
          </button>
          <button className="enterprise-button-primary" type="button" onClick={() => void runAuditPack()} disabled={!canWrite}>
            <TooltipText text="Genera il pacchetto">Generate Audit Pack</TooltipText>
          </button>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {actionMessage ? <p className="enterprise-status">{actionMessage}</p> : null}
      {loading ? <p className="enterprise-status">Loading export center...</p> : null}

      {snapshot ? (
        <>
          <div className="enterprise-kpi-grid">
            <article className="enterprise-kpi-card">
              <strong>Required evidence</strong>
              <p>{snapshot.evidenceCoverage?.requiredCoverage?.coveragePct ?? snapshot.evidenceCoverage?.coveragePct ?? 0}%</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Recommended evidence</strong>
              <p>{snapshot.evidenceCoverage?.recommendedCoverage?.coveragePct ?? 0}%</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Missing factors</strong>
              <p>{snapshot.missingFactorsCount ?? 0}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Unsupported categories</strong>
              <p>{snapshot.unsupportedCategoriesCount ?? 0}</p>
            </article>
            <article className="enterprise-kpi-card">
              <strong>Materiality completeness</strong>
              <p>{snapshot.materiality?.completenessPct ?? 0}%</p>
            </article>
          </div>

          <div className="enterprise-card">
            <h3 style={{ marginTop: 0 }}>Readiness summary</h3>
            <p className="enterprise-muted">
              Materiality companies with selected topics: {snapshot.materiality?.companiesWithSelectedTopics ?? 0}/{snapshot.materiality?.companyCount ?? 0}
            </p>
            {Array.isArray(snapshot.materiality?.missingCompanies) && snapshot.materiality.missingCompanies.length > 0 ? (
              <p className="enterprise-warning">Materiality missing for: {snapshot.materiality.missingCompanies.join(", ")}</p>
            ) : null}
            {snapshot.evidenceCoverage?.missingCount > 0 ? (
              <p className="enterprise-warning">
                Missing required evidence: {snapshot.evidenceCoverage.missingCount}. Review <Link href="/app/evidence">Evidence</Link> before sharing.
              </p>
            ) : null}
            {snapshot.missingFactorsCount > 0 ? (
              <p className="enterprise-warning">
                Missing factors detected. Open <Link href="/app/factors">Factors</Link> before committing totals.
              </p>
            ) : null}
          </div>

          <div className="enterprise-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <ApprovalCard
              title="Emissions Export"
              approval={approvalByType.get("emissions_export")}
              onSetStatus={(status) => setApprovalStatus("emissions_export", status)}
              disabled={!canWrite}
            />
            <ApprovalCard
              title="Audit Pack"
              approval={approvalByType.get("audit_pack")}
              onSetStatus={(status) => setApprovalStatus("audit_pack", status)}
              disabled={!canWrite}
            />
          </div>

          <div className="enterprise-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <article className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>
                <TooltipText text="Pacchetto audit">Audit Pack export</TooltipText>
              </h3>
              <p className="enterprise-muted">Local-first wrapper around the verified audit pack bundle.</p>
              <p className="enterprise-muted">
                Includes <TooltipText text="Dati e calcoli">snapshot JSON</TooltipText>,{" "}
                <TooltipText text="Mapping standards">standards mappings CSV</TooltipText>,{" "}
                <TooltipText text="Riferimenti documenti">evidence links CSV</TooltipText> and Scope 3 support CSV.
              </p>
            </article>
            <article className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>
                <TooltipText text="Mapping standards">Standards mappings export</TooltipText>
              </h3>
              <p className="enterprise-muted">Generated inside the audit pack as `standards-mappings.csv`.</p>
              <Link className="enterprise-button-secondary" href="/app/standards">
                Open Standards
              </Link>
            </article>
            <article className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>
                <TooltipText text="Riferimenti documenti">Evidence links export</TooltipText>
              </h3>
              <p className="enterprise-muted">Generated inside the audit pack as `evidence-links.csv` with entity linkage context.</p>
              <Link className="enterprise-button-secondary" href="/app/evidence">
                Open Evidence
              </Link>
            </article>
            <article className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>EcoVadis export</h3>
              <p className="enterprise-muted">Use the assessment export once answer coverage and evidence are complete.</p>
              <Link className="enterprise-button-secondary" href="/app/ecovadis">
                Open EcoVadis
              </Link>
            </article>
            <article className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>
                <TooltipText text="Sintesi per il BoD">Board pack multi-year</TooltipText>
              </h3>
              <p className="enterprise-muted">
                Last 3 years · latest Scope 3 {Array.isArray(boardPack?.trends) && boardPack.trends.length > 0 ? boardPack.trends[boardPack.trends.length - 1].scope3Tco2e : 0} tCO2e
              </p>
              <div className="enterprise-inline-actions">
                <a className="enterprise-button-secondary" href={`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/board-pack?year=${encodeURIComponent(year)}&years=3&format=json`}>
                  JSON
                </a>
                <a className="enterprise-button-secondary" href={`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/board-pack?year=${encodeURIComponent(year)}&years=3&format=csv`}>
                  CSV
                </a>
              </div>
            </article>
          </div>

          {boardPack?.comparison && Array.isArray(boardPack?.trends) && boardPack.trends.length > 0 ? (
            <div className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>
                <TooltipText text="Anteprima executive">Board Pack Preview</TooltipText>
              </h3>
              <p className="enterprise-muted">
                <TooltipText text="Confronto annuale">
                  Current year {boardPack.comparison.currentYear} vs previous year {boardPack.comparison.previousYear}.
                </TooltipText>
              </p>
              <div className="enterprise-kpi-grid">
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Differenza anno su anno">Scope 1 delta</TooltipText>
                  </strong>
                  <p>{formatDelta(boardPack.comparison.delta?.scope1Tco2e, " tCO2e")}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>
                    <TooltipText text="Differenza anno su anno">Scope 3 delta</TooltipText>
                  </strong>
                  <p>{formatDelta(boardPack.comparison.delta?.scope3Tco2e, " tCO2e")}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Women in management</strong>
                  <p>{formatDelta(boardPack.comparison.delta?.womenInManagementPct, " pp")}</p>
                </article>
                <article className="enterprise-kpi-card">
                  <strong>Required evidence</strong>
                  <p>{formatDelta(boardPack.comparison.delta?.evidenceRequiredPct, " pp")}</p>
                </article>
              </div>
              <div className="enterprise-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                <article className="enterprise-card">
                  <h4 style={{ marginTop: 0 }}>Current year highlights</h4>
                  <p className="enterprise-muted">
                    Scope 1: {boardPack.trends[boardPack.trends.length - 1]?.scope1Tco2e ?? 0} · Scope 2 L: {boardPack.trends[boardPack.trends.length - 1]?.scope2LocationTco2e ?? 0} · Scope 3: {boardPack.trends[boardPack.trends.length - 1]?.scope3Tco2e ?? 0}
                  </p>
                  <p className="enterprise-muted">
                    Material topics: {Array.isArray(boardPack.trends[boardPack.trends.length - 1]?.topMaterialTopics) ? boardPack.trends[boardPack.trends.length - 1].topMaterialTopics.join(", ") : "-"}
                  </p>
                  <p className="enterprise-muted">
                    Social: turnover {boardPack.trends[boardPack.trends.length - 1]?.turnoverPct ?? 0}% · women workforce {boardPack.trends[boardPack.trends.length - 1]?.womenInWorkforcePct ?? 0}% · training/employee {boardPack.trends[boardPack.trends.length - 1]?.trainingHoursPerEmployee ?? 0}
                  </p>
                  <p className="enterprise-muted">
                    Governance: women on board {boardPack.trends[boardPack.trends.length - 1]?.governance?.boardWomenPct ?? 0}% · independent {boardPack.trends[boardPack.trends.length - 1]?.governance?.independentPct ?? 0}% · meetings avg {boardPack.trends[boardPack.trends.length - 1]?.governance?.boardMeetingsAvg ?? 0}
                  </p>
                  <p className="enterprise-muted">
                    Evidence coverage: required {boardPack.trends[boardPack.trends.length - 1]?.evidenceCoverage?.requiredPct ?? 0}% · recommended {boardPack.trends[boardPack.trends.length - 1]?.evidenceCoverage?.recommendedPct ?? 0}%
                  </p>
                </article>
                <article className="enterprise-card">
                  <h4 style={{ marginTop: 0 }}>Previous year baseline</h4>
                  <p className="enterprise-muted">
                    Scope 1: {boardPack.trends[boardPack.trends.length - 2]?.scope1Tco2e ?? 0} · Scope 2 L: {boardPack.trends[boardPack.trends.length - 2]?.scope2LocationTco2e ?? 0} · Scope 3: {boardPack.trends[boardPack.trends.length - 2]?.scope3Tco2e ?? 0}
                  </p>
                  <p className="enterprise-muted">
                    Material topics: {Array.isArray(boardPack.trends[boardPack.trends.length - 2]?.topMaterialTopics) ? boardPack.trends[boardPack.trends.length - 2].topMaterialTopics.join(", ") : "-"}
                  </p>
                  <p className="enterprise-muted">
                    Social: turnover {boardPack.trends[boardPack.trends.length - 2]?.turnoverPct ?? 0}% · women workforce {boardPack.trends[boardPack.trends.length - 2]?.womenInWorkforcePct ?? 0}% · training/employee {boardPack.trends[boardPack.trends.length - 2]?.trainingHoursPerEmployee ?? 0}
                  </p>
                  <p className="enterprise-muted">
                    Governance: women on board {boardPack.trends[boardPack.trends.length - 2]?.governance?.boardWomenPct ?? 0}% · independent {boardPack.trends[boardPack.trends.length - 2]?.governance?.independentPct ?? 0}% · meetings avg {boardPack.trends[boardPack.trends.length - 2]?.governance?.boardMeetingsAvg ?? 0}
                  </p>
                  <p className="enterprise-muted">
                    Evidence coverage: required {boardPack.trends[boardPack.trends.length - 2]?.evidenceCoverage?.requiredPct ?? 0}% · recommended {boardPack.trends[boardPack.trends.length - 2]?.evidenceCoverage?.recommendedPct ?? 0}%
                  </p>
                </article>
              </div>
            </div>
          ) : null}

          {Array.isArray(boardPack?.trends) && boardPack.trends.length > 0 ? (
            <div className="enterprise-card">
              <h3 style={{ marginTop: 0 }}>Year-over-year highlights</h3>
              <div className="enterprise-table-wrap">
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Scope 1</th>
                      <th>Scope 2 L</th>
                      <th>Scope 3</th>
                      <th>Women workforce %</th>
                      <th>Women management %</th>
                      <th>Training / employee</th>
                      <th>Material topics</th>
                      <th>Evidence req %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardPack.trends.map((row) => (
                      <tr key={`trend-${row.year}`}>
                        <td>{row.year}</td>
                        <td>{row.scope1Tco2e}</td>
                        <td>{row.scope2LocationTco2e}</td>
                        <td>{row.scope3Tco2e}</td>
                        <td>{row.womenInWorkforcePct}</td>
                        <td>{row.womenInManagementPct}</td>
                        <td>{row.trainingHoursPerEmployee}</td>
                        <td>{row.materialTopicCount}</td>
                        <td>{row.evidenceCoverage?.requiredPct ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
