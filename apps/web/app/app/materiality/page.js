"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();
const SCORE_MIN = 1;
const SCORE_MAX = 5;
const AXIS_MIN = 0;
const AXIS_MAX = 25;

const toInt = (value, fallback = 3) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, parsed));
};

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const computeImpact = (row) => round2(((row.impactSeverity + row.impactScope + row.impactIrremediability) / 3) * row.impactLikelihood);
const computeFinancial = (row) => round2(row.financialMagnitude * row.financialLikelihood);

const extractError = (payload, fallback) => {
  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }
  return fallback;
};

const scoreInput = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    return "";
  }
  return String(parsed);
};

function MaterialityMatrix({ rows, impactThreshold, financialThreshold }) {
  const width = 560;
  const height = 420;
  const padding = 56;

  const toX = (value) => padding + ((value - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (width - padding * 2);
  const toY = (value) => height - padding - ((value - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (height - padding * 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Double materiality matrix" style={{ width: "100%" }}>
      <rect x="0" y="0" width={width} height={height} fill="#f7fcff" />
      <rect
        x={padding}
        y={padding}
        width={width - padding * 2}
        height={height - padding * 2}
        fill="#ffffff"
        stroke="#bfd2dc"
      />

      <line
        x1={toX(financialThreshold)}
        x2={toX(financialThreshold)}
        y1={padding}
        y2={height - padding}
        stroke="#e1795f"
        strokeDasharray="6 4"
      />
      <line
        x1={padding}
        x2={width - padding}
        y1={toY(impactThreshold)}
        y2={toY(impactThreshold)}
        stroke="#e1795f"
        strokeDasharray="6 4"
      />

      {rows.map((row) => (
        <g key={row.topicId}>
          <circle
            cx={toX(row.financialScore)}
            cy={toY(row.impactScore)}
            r={row.material ? 7 : 5}
            fill={row.material ? "#0f6f62" : "#3f88a8"}
          />
          <text x={toX(row.financialScore) + 8} y={toY(row.impactScore) - 8} fontSize="11" fill="#1a3f52">
            {row.topicCode}
          </text>
        </g>
      ))}

      <text x={width / 2} y={height - 14} textAnchor="middle" fontSize="13" fill="#234b5e">
        Financial materiality
      </text>
      <text
        x={20}
        y={height / 2}
        textAnchor="middle"
        fontSize="13"
        transform={`rotate(-90 20 ${height / 2})`}
        fill="#234b5e"
      >
        Impact materiality
      </text>
    </svg>
  );
}

export default function MaterialityPage() {
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [reportingYear, setReportingYear] = useState(String(currentYear));
  const [companyId, setCompanyId] = useState("");
  const [topics, setTopics] = useState([]);
  const [rows, setRows] = useState({});
  const [evidence, setEvidence] = useState([]);
  const [topicEvidence, setTopicEvidence] = useState({});
  const [thresholds, setThresholds] = useState({ impactThreshold: 9, financialThreshold: 9 });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);

  const scoreRows = useMemo(() => {
    return topics.map((topic) => {
      const row = rows[topic.id] || {
        impactSeverity: 3,
        impactScope: 3,
        impactIrremediability: 3,
        impactLikelihood: 3,
        financialMagnitude: 3,
        financialLikelihood: 3,
        notes: "",
      };

      const impactScore = computeImpact(row);
      const financialScore = computeFinancial(row);
      const materialImpact = impactScore >= Number(thresholds.impactThreshold || 0);
      const materialFinancial = financialScore >= Number(thresholds.financialThreshold || 0);

      return {
        topicId: topic.id,
        topicCode: topic.code,
        topicName: topic.name,
        topicCategory: topic.category,
        ...row,
        impactScore,
        financialScore,
        materialImpact,
        materialFinancial,
        material: materialImpact || materialFinancial,
      };
    });
  }, [rows, thresholds.financialThreshold, thresholds.impactThreshold, topics]);

  const matrixRows = useMemo(() => scoreRows, [scoreRows]);

  const loadTopics = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/topics`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    const nextTopics = Array.isArray(payload.topics) ? payload.topics : [];
    setTopics(nextTopics);

    const evidenceByTopic = {};
    for (const topic of nextTopics) {
      evidenceByTopic[topic.id] = Array.isArray(topic.evidenceIds) ? topic.evidenceIds : [];
    }
    setTopicEvidence(evidenceByTopic);

    if (payload.thresholds) {
      setThresholds({
        impactThreshold: Number(payload.thresholds.impactThreshold ?? 9),
        financialThreshold: Number(payload.thresholds.financialThreshold ?? 9),
      });
    }
  }, [tenant.tenantId]);

  const loadEvidence = useCallback(async () => {
    if (!tenant.tenantId) {
      return;
    }

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/evidence`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    setEvidence(Array.isArray(payload.evidence) ? payload.evidence : []);
  }, [tenant.tenantId]);

  const loadScores = useCallback(async () => {
    if (!tenant.tenantId || !companyId || !reportingYear) {
      return;
    }

    const query = new URLSearchParams({
      companyId,
      year: reportingYear,
    }).toString();

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/scores?${query}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    const nextRows = {};
    for (const row of payload.scores || []) {
      nextRows[row.topicId] = {
        impactSeverity: row.impactSeverity,
        impactScope: row.impactScope,
        impactIrremediability: row.impactIrremediability,
        impactLikelihood: row.impactLikelihood,
        financialMagnitude: row.financialMagnitude,
        financialLikelihood: row.financialLikelihood,
        notes: row.notes || "",
      };
    }

    setRows(nextRows);

    if (payload.thresholds) {
      setThresholds({
        impactThreshold: Number(payload.thresholds.impactThreshold ?? 9),
        financialThreshold: Number(payload.thresholds.financialThreshold ?? 9),
      });
    }
  }, [companyId, reportingYear, tenant.tenantId]);

  const loadReport = useCallback(async () => {
    if (!tenant.tenantId || !companyId || !reportingYear) {
      return;
    }

    const query = new URLSearchParams({
      companyId,
      year: reportingYear,
    }).toString();

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/report?${query}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    setReport(payload);
  }, [companyId, reportingYear, tenant.tenantId]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId) {
      setLoading(true);
      setError("");
      Promise.all([loadTopics(), loadEvidence()])
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Unable to load materiality setup");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [tenant.loading, tenant.tenantId, loadTopics, loadEvidence]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && companyId && reportingYear) {
      setLoading(true);
      setError("");
      Promise.all([loadScores(), loadReport()])
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Unable to load materiality scores");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [tenant.loading, tenant.tenantId, companyId, reportingYear, loadScores, loadReport]);

  const setRowValue = (topicId, key, rawValue) => {
    setRows((current) => ({
      ...current,
      [topicId]: {
        impactSeverity: 3,
        impactScope: 3,
        impactIrremediability: 3,
        impactLikelihood: 3,
        financialMagnitude: 3,
        financialLikelihood: 3,
        notes: "",
        ...(current[topicId] || {}),
        [key]: key === "notes" ? rawValue : toInt(rawValue),
      },
    }));
  };

  const saveScores = async () => {
    if (!tenant.tenantId || !companyId || !reportingYear || !canWrite) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/scores`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          reportingYear: Number.parseInt(reportingYear, 10),
          rows: scoreRows.map((row) => ({
            topicId: row.topicId,
            impactSeverity: row.impactSeverity,
            impactScope: row.impactScope,
            impactIrremediability: row.impactIrremediability,
            impactLikelihood: row.impactLikelihood,
            financialMagnitude: row.financialMagnitude,
            financialLikelihood: row.financialLikelihood,
            notes: row.notes || "",
          })),
          thresholds: {
            impactThreshold: Number(thresholds.impactThreshold),
            financialThreshold: Number(thresholds.financialThreshold),
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage("Materiality scores saved.");
      await Promise.all([loadScores(), loadReport()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save materiality scores");
    } finally {
      setSaving(false);
    }
  };

  const saveTopicEvidence = async (topicId) => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/topics/${encodeURIComponent(topicId)}/evidence`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            evidenceIds: topicEvidence[topicId] || [],
          }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      setMessage("Topic evidence links updated.");
      await loadTopics();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update topic evidence");
    }
  };

  const exportJson = () => {
    const payload = {
      companyId,
      reportingYear: Number.parseInt(reportingYear, 10),
      thresholds,
      scores: scoreRows,
      report,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `materiality-${companyId}-${reportingYear}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = [
      "topic_code",
      "topic_name",
      "category",
      "impact_severity",
      "impact_scope",
      "impact_irremediability",
      "impact_likelihood",
      "financial_magnitude",
      "financial_likelihood",
      "impact_score",
      "financial_score",
      "material",
      "notes",
    ];

    const lines = [header.join(",")];
    for (const row of scoreRows) {
      lines.push(
        [
          row.topicCode,
          row.topicName,
          row.topicCategory,
          row.impactSeverity,
          row.impactScope,
          row.impactIrremediability,
          row.impactLikelihood,
          row.financialMagnitude,
          row.financialLikelihood,
          row.impactScore,
          row.financialScore,
          row.material ? "yes" : "no",
          `"${String(row.notes || "").replace(/"/g, '""')}"`,
        ].join(","),
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `materiality-${companyId}-${reportingYear}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadMatrixPng = () => {
    const canvas = document.createElement("canvas");
    const width = 1200;
    const height = 860;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Unable to render matrix PNG.");
      return;
    }

    const padding = 100;
    const toX = (value) => padding + ((value - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (width - padding * 2);
    const toY = (value) => height - padding - ((value - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (height - padding * 2);

    ctx.fillStyle = "#f7fcff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#bfd2dc";
    ctx.lineWidth = 2;
    ctx.fillRect(padding, padding, width - padding * 2, height - padding * 2);
    ctx.strokeRect(padding, padding, width - padding * 2, height - padding * 2);

    ctx.strokeStyle = "#e1795f";
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(toX(Number(thresholds.financialThreshold)), padding);
    ctx.lineTo(toX(Number(thresholds.financialThreshold)), height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, toY(Number(thresholds.impactThreshold)));
    ctx.lineTo(width - padding, toY(Number(thresholds.impactThreshold)));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "24px Georgia";
    ctx.fillStyle = "#234b5e";
    ctx.textAlign = "center";
    ctx.fillText("Double Materiality Matrix", width / 2, 52);

    ctx.font = "22px Arial";
    ctx.fillText("Financial materiality", width / 2, height - 28);

    ctx.save();
    ctx.translate(34, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Impact materiality", 0, 0);
    ctx.restore();

    ctx.font = "18px Arial";
    for (const row of matrixRows) {
      const x = toX(row.financialScore);
      const y = toY(row.impactScore);
      ctx.beginPath();
      ctx.fillStyle = row.material ? "#0f6f62" : "#3f88a8";
      ctx.arc(x, y, row.material ? 11 : 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#1a3f52";
      ctx.fillText(row.topicCode, x + 28, y - 12);
    }

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `materiality-matrix-${companyId}-${reportingYear}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">Materiality &amp; Double Materiality</h2>
          <p className="enterprise-muted">
            CSRD/ESRS-style impact and financial materiality scoring with matrix visualization and evidence links.
          </p>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}
      {loading ? <p className="enterprise-status">Loading materiality module...</p> : null}

      <div className="enterprise-card">
        <div className="enterprise-filter-grid">
          <div>
            <label className="enterprise-label" htmlFor="materiality-company">
              Company
            </label>
            <select
              id="materiality-company"
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

          <div>
            <label className="enterprise-label" htmlFor="materiality-year">
              Reporting year
            </label>
            <input
              id="materiality-year"
              className="enterprise-input"
              type="number"
              value={reportingYear}
              onChange={(event) => setReportingYear(event.target.value)}
            />
          </div>

          <div>
            <label className="enterprise-label" htmlFor="impact-threshold">
              Impact threshold
            </label>
            <input
              id="impact-threshold"
              className="enterprise-input"
              type="number"
              step="0.1"
              value={thresholds.impactThreshold}
              onChange={(event) =>
                setThresholds((current) => ({ ...current, impactThreshold: Number(event.target.value || 0) }))
              }
              disabled={!canWrite}
            />
          </div>

          <div>
            <label className="enterprise-label" htmlFor="financial-threshold">
              Financial threshold
            </label>
            <input
              id="financial-threshold"
              className="enterprise-input"
              type="number"
              step="0.1"
              value={thresholds.financialThreshold}
              onChange={(event) =>
                setThresholds((current) => ({ ...current, financialThreshold: Number(event.target.value || 0) }))
              }
              disabled={!canWrite}
            />
          </div>

          <div className="enterprise-inline-actions">
            {canWrite ? (
              <button className="enterprise-button-primary" type="button" onClick={() => void saveScores()} disabled={saving}>
                {saving ? "Saving..." : "Save scores"}
              </button>
            ) : null}
            <button className="enterprise-button-secondary" type="button" onClick={exportCsv}>
              Export CSV
            </button>
            <button className="enterprise-button-secondary" type="button" onClick={exportJson}>
              Export JSON
            </button>
            <button className="enterprise-button-secondary" type="button" onClick={downloadMatrixPng}>
              Matrix PNG
            </button>
          </div>
        </div>
      </div>

      <div className="enterprise-card">
        <h3>Topic Scoring</h3>
        <div className="enterprise-table-wrap">
          <table className="enterprise-table enterprise-table-wide">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Impact Severity</th>
                <th>Impact Scope</th>
                <th>Impact Irremediability</th>
                <th>Impact Likelihood</th>
                <th>Financial Magnitude</th>
                <th>Financial Likelihood</th>
                <th>Impact Score</th>
                <th>Financial Score</th>
                <th>Material</th>
                <th>Evidence</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {scoreRows.map((row) => (
                <tr key={row.topicId}>
                  <td>
                    <strong>{row.topicCode}</strong>
                    <div>{row.topicName}</div>
                    <div className="enterprise-muted">{row.topicCategory}</div>
                  </td>
                  <td>
                    <input
                      className="enterprise-input"
                      value={scoreInput(row.impactSeverity)}
                      onChange={(event) => setRowValue(row.topicId, "impactSeverity", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    <input
                      className="enterprise-input"
                      value={scoreInput(row.impactScope)}
                      onChange={(event) => setRowValue(row.topicId, "impactScope", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    <input
                      className="enterprise-input"
                      value={scoreInput(row.impactIrremediability)}
                      onChange={(event) => setRowValue(row.topicId, "impactIrremediability", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    <input
                      className="enterprise-input"
                      value={scoreInput(row.impactLikelihood)}
                      onChange={(event) => setRowValue(row.topicId, "impactLikelihood", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    <input
                      className="enterprise-input"
                      value={scoreInput(row.financialMagnitude)}
                      onChange={(event) => setRowValue(row.topicId, "financialMagnitude", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td>
                    <input
                      className="enterprise-input"
                      value={scoreInput(row.financialLikelihood)}
                      onChange={(event) => setRowValue(row.topicId, "financialLikelihood", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td>{row.impactScore}</td>
                  <td>{row.financialScore}</td>
                  <td>
                    <span className={row.material ? "enterprise-pill enterprise-pill-success" : "enterprise-pill"}>
                      {row.material ? "Yes" : "No"}
                    </span>
                  </td>
                  <td>
                    <select
                      className="enterprise-input"
                      multiple
                      value={topicEvidence[row.topicId] || []}
                      onChange={(event) => {
                        const values = [...event.target.selectedOptions].map((option) => option.value);
                        setTopicEvidence((current) => ({ ...current, [row.topicId]: values }));
                      }}
                      disabled={!canWrite}
                    >
                      {evidence.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.filename}
                        </option>
                      ))}
                    </select>
                    <div className="enterprise-inline-actions">
                      {canWrite ? (
                        <button
                          className="enterprise-button-secondary"
                          type="button"
                          onClick={() => void saveTopicEvidence(row.topicId)}
                        >
                          Save evidence
                        </button>
                      ) : null}
                      <span className="enterprise-muted">
                        {(topicEvidence[row.topicId] || []).length} linked
                      </span>
                    </div>
                  </td>
                  <td>
                    <textarea
                      className="enterprise-input"
                      value={row.notes || ""}
                      onChange={(event) => setRowValue(row.topicId, "notes", event.target.value)}
                      disabled={!canWrite}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="enterprise-card-grid">
        <div className="enterprise-card">
          <h3>Double Materiality Matrix</h3>
          <MaterialityMatrix
            rows={matrixRows}
            impactThreshold={Number(thresholds.impactThreshold || 0)}
            financialThreshold={Number(thresholds.financialThreshold || 0)}
          />
        </div>

        <div className="enterprise-card">
          <h3>Report Highlights</h3>
          <div className="enterprise-stack">
            <div>
              <strong>Top impact topics</strong>
              <ul>
                {(report?.topImpacts || []).map((item) => (
                  <li key={`impact-${item.topicId}`}>
                    {item.topicCode} {item.topicName} ({item.impactScore})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Top financial topics</strong>
              <ul>
                {(report?.topFinancial || []).map((item) => (
                  <li key={`financial-${item.topicId}`}>
                    {item.topicCode} {item.topicName} ({item.financialScore})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Material topics</strong>
              <ul>
                {(report?.materialTopics || []).map((item) => (
                  <li key={`material-${item.topicId}`}>
                    {item.topicCode} {item.topicName}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
