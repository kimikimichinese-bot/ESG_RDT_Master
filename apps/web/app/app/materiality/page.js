"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../_components/modal";
import { useCompanyScope } from "../_components/use-company-scope";
import { useTenantSession } from "../_components/use-tenant-session";

const currentYear = new Date().getFullYear();
const SCORE_MIN = 1;
const SCORE_MAX = 5;
const AXIS_MIN = 0;
const AXIS_MAX = 25;

const GROUPS = [
  { key: "E", label: "Environment (E1-E5)" },
  { key: "S", label: "Social (S1-S4)" },
  { key: "G", label: "Governance (G1)" },
  { key: "GEN", label: "General (GEN1-3)" },
  { key: "CUSTOM", label: "Custom" },
];

const MATERIAL_SET_CODES = ["E1", "E2", "E3", "E4", "E5", "GEN1", "GEN2", "GEN3", "G1", "S1", "S2", "S3", "S4"];
const TOP_PRESET_CODES = ["E1", "E2", "E3", "E4", "E5"];
const SDG_OPTIONS = Array.from({ length: 17 }, (_, index) => index + 1);
const DATA_ENTRY_HREF = "/app/environment";

const TOOLTIP_COPY = {
  materialityMenu: "Definisci i topic materiali (impact + financial) prima di inserire dati.",
  topicSelector: "Seleziona i topic da valutare: la tabella appare dopo la selezione.",
  loadMaterialSet: "Carica set consigliato",
  impactThreshold: "Soglia sopra cui un topic è materiale per impatto (y).",
  financialThreshold: "Soglia sopra cui un topic è materiale per impatto finanziario (x).",
  severity: "Quanto è grave l’impatto se accade (1 basso → 5 alto).",
  scope: "Quanto è esteso l’impatto (persone/ambiente/attività coinvolte).",
  irremediability: "Quanto è irreversibile/difficile da riparare l’impatto.",
  likelihood: "Quanto è probabile che l’impatto accada (1 raro → 5 probabile).",
  magnitude: "Quanto è grande l’effetto economico (1 minimo → 5 elevato).",
  financialLikelihood: "Quanto è probabile l’effetto economico (1 raro → 5 probabile).",
  sdgBadge: "Goal collegati",
  factors: "Imposta fattori con fonte e paese: senza fattori Emissions può risultare incompleto.",
  evidence: "Collega PDF e pagine ai dati: rende il report verificabile e audit-ready.",
  auditPack: "Esporta snapshot + mapping + evidence links per assurance e consegna cliente.",
};

const KICKOFF_STEPS = [
  {
    title: "Step 0 — Preparazione (Company + Year)",
    why: "Perché serve: tutte le metriche, evidenze e calcoli sono tracciati per Company/Site e per anno di reporting.",
  },
  {
    title: "Step 1 — Materiality: Seleziona i topic",
    why: "Perché serve: definisci cosa è “materiale” prima di raccogliere dati, così misuri solo ciò che conta.",
  },
  {
    title: "Step 2 — Materiality: Inserisci punteggi (Impact/Financial)",
    why: "Perché serve: trasformi i topic in priorità misurabili (impact + financial) usando scale 1–5 e soglie.",
  },
  {
    title: "Step 3 — Materiality: Verifica matrice e temi materiali",
    why: "Perché serve: la matrice conferma cosa è materiale e cosa no; evita raccolta dati inutile.",
  },
  {
    title: "Step 4 — KPI Monitoring: Raccogli dati + assegna evidenze (Environment/GHG/Social/Governance)",
    why: "Perché serve: i KPI “dimostrano” i topic materiali e le evidenze rendono il report verificabile.",
  },
  {
    title: "Step 5 — Review & Export: Emissions + Audit pack + Content index",
    why: "Perché serve: controlli scope 1/2/3, fonti/fattori, completezza e produci un pack pronto per assurance.",
  },
];

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

const normalizeGroupKey = (topic) => {
  const group = String(topic?.groupKey || "").toUpperCase();
  if (["E", "S", "G", "GEN", "CUSTOM"].includes(group)) {
    return group;
  }

  const code = String(topic?.code || "").toUpperCase();
  if (code.startsWith("GEN")) {
    return "GEN";
  }
  if (code.startsWith("E")) {
    return "E";
  }
  if (code.startsWith("S")) {
    return "S";
  }
  if (code.startsWith("G")) {
    return "G";
  }
  return "CUSTOM";
};

const defaultCustomTopic = () => ({
  name: "",
  code: "",
  category: "Custom",
  groupKey: "CUSTOM",
  sdgs: [],
  parentTopicId: "",
  description: "",
});

function SdgBadges({ sdgs }) {
  if (!Array.isArray(sdgs) || sdgs.length === 0) {
    return null;
  }

  return (
    <div className="materiality-sdg-row">
      {sdgs.map((sdg) => (
        <span key={sdg} className="enterprise-pill materiality-sdg-pill">
          SDG {sdg}
        </span>
      ))}
    </div>
  );
}

function TooltipText({ text, children, className = "" }) {
  return (
    <span className={`enterprise-tooltip ${className}`.trim()} data-tooltip={text} aria-label={text}>
      {children}
    </span>
  );
}

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

      {rows.length === 0 ? (
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="14" fill="#5b7280">
          No selected topics
        </text>
      ) : null}

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

function ReportList({ title, items, scoreKey }) {
  return (
    <div className="enterprise-subcard">
      <strong>{title}</strong>
      {Array.isArray(items) && items.length > 0 ? (
        <ul className="materiality-report-list">
          {items.map((item) => (
            <li key={`${title}-${item.topicId}`}>
              <div className="materiality-report-topic-line">
                <span>
                  <strong>{item.topicCode || "-"}</strong> {item.topicName}
                </span>
                {scoreKey ? <span>{item[scoreKey]}</span> : null}
              </div>
              <SdgBadges sdgs={Array.isArray(item.topicSdgs) ? item.topicSdgs : item.sdgs} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="enterprise-muted">No topics yet.</p>
      )}
    </div>
  );
}

export default function MaterialityPage() {
  const router = useRouter();
  const tenant = useTenantSession();
  const companyScope = useCompanyScope(tenant.tenantId);

  const [reportingYear, setReportingYear] = useState(String(currentYear));
  const [companyId, setCompanyId] = useState("");
  const [topics, setTopics] = useState([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState([]);
  const [rows, setRows] = useState({});
  const [evidence, setEvidence] = useState([]);
  const [topicEvidence, setTopicEvidence] = useState({});
  const [thresholds, setThresholds] = useState({ impactThreshold: 9, financialThreshold: 9 });
  const [report, setReport] = useState(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [topicSearch, setTopicSearch] = useState("");
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const [customTopic, setCustomTopic] = useState(defaultCustomTopic());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [kickoffState, setKickoffState] = useState(null);
  const [kickoffOpen, setKickoffOpen] = useState(false);
  const [kickoffDoNotShow, setKickoffDoNotShow] = useState(false);
  const [showTopicEditCallout, setShowTopicEditCallout] = useState(false);
  const [approval, setApproval] = useState(null);
  const selectorRef = useRef(null);

  useEffect(() => {
    if (companyScope.activeCompanyId) {
      setCompanyId(companyScope.activeCompanyId);
    }
  }, [companyScope.activeCompanyId]);

  const canWrite = useMemo(() => tenant.role !== "Auditor", [tenant.role]);
  const reportingYearInt = useMemo(() => Number.parseInt(reportingYear, 10) || 0, [reportingYear]);

  const loadKickoffState = useCallback(async () => {
    if (!tenant.tenantId || !companyId || !reportingYearInt) {
      setKickoffState(null);
      setKickoffOpen(false);
      return;
    }

    const query = new URLSearchParams({
      companyId,
      year: String(reportingYearInt),
    }).toString();

    const response = await fetch(
      `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/year-kickoff?${query}`,
      {
        cache: "no-store",
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }
    const nextState = payload?.state || {
      companyId,
      reportingYear: reportingYearInt,
      kickoffDismissed: false,
      definitionCompleted: false,
      lastStep: "define",
      updatedAt: null,
    };
    setKickoffState(nextState);
    setKickoffDoNotShow(nextState.kickoffDismissed === true);

    const shouldOpen = nextState.definitionCompleted !== true && nextState.kickoffDismissed !== true;
    setKickoffOpen(shouldOpen);
  }, [companyId, reportingYearInt, tenant.tenantId]);

  const loadApproval = useCallback(async () => {
    if (!tenant.tenantId || !companyId || !reportingYearInt) {
      setApproval(null);
      return;
    }

    const query = new URLSearchParams({
      entityType: "materiality_set",
      companyId,
      reportingYear: String(reportingYearInt),
    }).toString();
    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/approvals?${query}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }
    setApproval(Array.isArray(payload.approvals) && payload.approvals.length > 0 ? payload.approvals[0] : null);
  }, [companyId, reportingYearInt, tenant.tenantId]);

  const updateApproval = useCallback(
    async (status) => {
      if (!tenant.tenantId || !companyId || !reportingYearInt || !canWrite) {
        return;
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/approvals`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entityType: "materiality_set",
          companyId,
          reportingYear: reportingYearInt,
          status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }
      setApproval(payload.approval || null);
      setMessage(`Materiality set status: ${status}`);
    },
    [canWrite, companyId, reportingYearInt, tenant.tenantId],
  );

  const updateKickoffState = useCallback(
    async (patch, { silent = false } = {}) => {
      if (!tenant.tenantId || !companyId || !reportingYearInt || !canWrite) {
        return;
      }

      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/onboarding/year-kickoff`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          reportingYear: reportingYearInt,
          ...patch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }
      if (payload?.state) {
        setKickoffState(payload.state);
      }
      if (!silent) {
        setMessage("Year Kickoff aggiornato.");
      }
    },
    [canWrite, companyId, reportingYearInt, tenant.tenantId],
  );

  const topicById = useMemo(() => {
    return new Map(topics.map((topic) => [topic.id, topic]));
  }, [topics]);

  const selectedTopics = useMemo(() => {
    return selectedTopicIds.map((topicId) => topicById.get(topicId)).filter(Boolean);
  }, [selectedTopicIds, topicById]);

  const scoreRows = useMemo(() => {
    return selectedTopics.map((topic) => {
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
        topicGroupKey: normalizeGroupKey(topic),
        topicSdgs: Array.isArray(topic.sdgs) ? topic.sdgs : [],
        ...row,
        impactScore,
        financialScore,
        materialImpact,
        materialFinancial,
        material: materialImpact || materialFinancial,
      };
    });
  }, [rows, selectedTopics, thresholds.financialThreshold, thresholds.impactThreshold]);

  const matrixRows = useMemo(() => scoreRows, [scoreRows]);

  const filteredTopics = useMemo(() => {
    const normalizedSearch = topicSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return topics;
    }

    return topics.filter((topic) => {
      const code = String(topic.code || "").toLowerCase();
      const name = String(topic.name || "").toLowerCase();
      const category = String(topic.category || "").toLowerCase();
      const groupKey = String(normalizeGroupKey(topic) || "").toLowerCase();
      const sdgText = Array.isArray(topic.sdgs) ? topic.sdgs.map((sdg) => `sdg ${sdg}`).join(" ") : "";

      return (
        code.includes(normalizedSearch) ||
        name.includes(normalizedSearch) ||
        category.includes(normalizedSearch) ||
        groupKey.includes(normalizedSearch) ||
        sdgText.includes(normalizedSearch)
      );
    });
  }, [topicSearch, topics]);

  const groupedTopics = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      topics: filteredTopics.filter((topic) => normalizeGroupKey(topic) === group.key),
    })).filter((group) => group.topics.length > 0 || group.key !== "CUSTOM");
  }, [filteredTopics]);

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

  const loadSelection = useCallback(async () => {
    if (!tenant.tenantId || !companyId || !reportingYear) {
      return;
    }

    const query = new URLSearchParams({
      companyId,
      year: reportingYear,
    }).toString();

    const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/selection?${query}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractError(payload, `HTTP ${response.status}`));
    }

    setSelectedTopicIds(Array.isArray(payload.topicIds) ? payload.topicIds : []);
  }, [companyId, reportingYear, tenant.tenantId]);

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

    if (Array.isArray(payload.selectedTopicIds)) {
      setSelectedTopicIds(payload.selectedTopicIds);
    }

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
      loadSelection()
        .then(() => Promise.all([loadScores(), loadReport()]))
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Unable to load materiality scores");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [tenant.loading, tenant.tenantId, companyId, reportingYear, loadSelection, loadScores, loadReport]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && companyId && reportingYearInt) {
      loadKickoffState().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load Year Kickoff state");
      });
    } else {
      setKickoffOpen(false);
      setKickoffState(null);
    }
  }, [tenant.loading, tenant.tenantId, companyId, reportingYearInt, loadKickoffState]);

  useEffect(() => {
    if (!tenant.loading && tenant.tenantId && companyId && reportingYearInt) {
      loadApproval().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load materiality approval");
      });
    } else {
      setApproval(null);
    }
  }, [tenant.loading, tenant.tenantId, companyId, reportingYearInt, loadApproval]);

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

  const persistSelection = useCallback(
    async (nextTopicIds, successMessage = "Topic selection updated.") => {
      if (!tenant.tenantId || !companyId || !reportingYear || !canWrite) {
        return;
      }

      setSavingSelection(true);
      setError("");

      try {
        const query = new URLSearchParams({
          companyId,
          year: reportingYear,
        }).toString();

        const response = await fetch(
          `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/selection?${query}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              topicIds: nextTopicIds,
            }),
          },
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(extractError(payload, `HTTP ${response.status}`));
        }

        const savedTopicIds = Array.isArray(payload.topicIds) ? payload.topicIds : [];
        setSelectedTopicIds(savedTopicIds);
        setMessage(successMessage);

        await Promise.all([loadScores(), loadReport()]);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Unable to persist topic selection");
      } finally {
        setSavingSelection(false);
      }
    },
    [canWrite, companyId, loadReport, loadScores, reportingYear, tenant.tenantId],
  );

  const toggleTopicSelection = async (topicId, checked) => {
    if (kickoffState?.definitionCompleted) {
      setShowTopicEditCallout(true);
    }
    const existing = new Set(selectedTopicIds);
    if (checked) {
      existing.add(topicId);
    } else {
      existing.delete(topicId);
    }
    await persistSelection(Array.from(existing));
  };

  const loadPreset = async (codes, label) => {
    if (!canWrite) {
      return;
    }
    if (kickoffState?.definitionCompleted) {
      setShowTopicEditCallout(true);
    }

    const codeSet = new Set(codes);
    const presetTopicIds = topics.filter((topic) => codeSet.has(String(topic.code || "").toUpperCase())).map((topic) => topic.id);
    await persistSelection(presetTopicIds, `${label} loaded.`);
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

      if (Array.isArray(payload.selectedTopicIds)) {
        setSelectedTopicIds(payload.selectedTopicIds);
      }

      setMessage("Materiality scores saved.");
      const completedTopicIds = Array.isArray(payload.selectedTopicIds) ? payload.selectedTopicIds : selectedTopicIds;
      if (scoreRows.length > 0 && completedTopicIds.length > 0 && canWrite) {
        await updateKickoffState(
          {
            definitionCompleted: true,
            kickoffDismissed: true,
            lastStep: "kpi",
          },
          { silent: true },
        );
        setKickoffOpen(false);
      }
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

  const toggleCustomTopicSdg = (sdg) => {
    setCustomTopic((current) => {
      const hasValue = current.sdgs.includes(sdg);
      const nextValues = hasValue ? current.sdgs.filter((item) => item !== sdg) : [...current.sdgs, sdg];
      return {
        ...current,
        sdgs: nextValues.sort((a, b) => a - b),
      };
    });
  };

  const createCustomTopic = async () => {
    if (!tenant.tenantId || !canWrite) {
      return;
    }

    setCreatingTopic(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/materiality/topics`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: customTopic.name,
          code: customTopic.code,
          category: customTopic.category,
          groupKey: customTopic.groupKey,
          sdgs: customTopic.sdgs,
          parentTopicId: customTopic.parentTopicId || null,
          description: customTopic.description,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractError(payload, `HTTP ${response.status}`));
      }

      const nextTopics = Array.isArray(payload.topics) ? payload.topics : [];
      if (nextTopics.length > 0) {
        setTopics(nextTopics);

        const evidenceByTopic = {};
        for (const topic of nextTopics) {
          evidenceByTopic[topic.id] = Array.isArray(topic.evidenceIds) ? topic.evidenceIds : [];
        }
        setTopicEvidence(evidenceByTopic);
      }

      const createdTopicId = Array.isArray(payload.createdTopicIds) ? payload.createdTopicIds[0] : null;
      setCustomTopic(defaultCustomTopic());
      setShowAddTopicModal(false);

      if (createdTopicId && companyId && reportingYear) {
        const nextSet = new Set(selectedTopicIds);
        nextSet.add(createdTopicId);
        await persistSelection(Array.from(nextSet), "Custom topic created and selected.");
      } else {
        setMessage("Custom topic created.");
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create topic");
    } finally {
      setCreatingTopic(false);
    }
  };

  const exportJson = () => {
    const payload = {
      companyId,
      reportingYear: Number.parseInt(reportingYear, 10),
      selectedTopicIds,
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
      "sdgs",
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
          `"${(row.topicSdgs || []).join("|")}"`,
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

  const openTopicSelectorFromKickoff = async () => {
    setSelectorOpen(true);
    setKickoffOpen(false);
    setShowTopicEditCallout(false);
    selectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (!canWrite) {
      return;
    }

    if (kickoffDoNotShow) {
      try {
        await updateKickoffState({
          kickoffDismissed: true,
          lastStep: "define",
        }, { silent: true });
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : "Unable to update Year Kickoff state");
      }
    }
  };

  const closeKickoff = async () => {
    setKickoffOpen(false);
    if (!canWrite || !kickoffDoNotShow) {
      return;
    }
    try {
      await updateKickoffState({
        kickoffDismissed: true,
        lastStep: "define",
      }, { silent: true });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update Year Kickoff state");
    }
  };

  const onEditTopicsClick = () => {
    setSelectorOpen(true);
    selectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (kickoffState?.definitionCompleted) {
      setShowTopicEditCallout(true);
    }
  };

  const goToDataEntry = async () => {
    if (canWrite && kickoffDoNotShow) {
      try {
        await updateKickoffState({
          kickoffDismissed: true,
          lastStep: "kpi",
        }, { silent: true });
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : "Unable to update Year Kickoff state");
      }
    }
    setKickoffOpen(false);
    router.push(DATA_ENTRY_HREF);
  };

  return (
    <section className="enterprise-grid">
      <div className="enterprise-toolbar">
        <div>
          <h2 className="enterprise-section-title">
            <TooltipText text={TOOLTIP_COPY.materialityMenu}>Materiality &amp; Double Materiality</TooltipText>
          </h2>
          <p className="enterprise-muted">
            Select the ESG topics to score, then run impact and financial materiality analysis with SDG-aware reporting.
          </p>
        </div>
        <div className="enterprise-inline-actions">
          <Link className="enterprise-button-secondary" href="/app/help/year-kickoff">
            Apri manuale
          </Link>
          <Link className="enterprise-button-secondary" href="/app/factors">
            <TooltipText text={TOOLTIP_COPY.factors}>Factors</TooltipText>
          </Link>
          <Link className="enterprise-button-secondary" href="/app/evidence">
            <TooltipText text={TOOLTIP_COPY.evidence}>Evidence</TooltipText>
          </Link>
          <Link className="enterprise-button-secondary" href="/app/audit">
            <TooltipText text={TOOLTIP_COPY.auditPack}>Audit pack export</TooltipText>
          </Link>
        </div>
      </div>

      {tenant.error ? <p className="enterprise-status enterprise-status-error">{tenant.error}</p> : null}
      {error ? <p className="enterprise-status enterprise-status-error">{error}</p> : null}
      {message ? <p className="enterprise-status">{message}</p> : null}
      {loading ? <p className="enterprise-status">Loading materiality module...</p> : null}
      {showTopicEditCallout ? (
        <p className="enterprise-warning">
          Hai aperto “Aggiungi/Modifica topic”. Torna a Materiality solo per aggiornare topic o soglie; poi continua su Data Entry, Evidence, Factors, Emissions ed Exports.
        </p>
      ) : null}

      {kickoffOpen ? (
        <Modal title="Year Kickoff — Imposta il reporting ESG (Company + Year)" onClose={() => void closeKickoff()}>
          <div className="enterprise-grid">
            <p className="enterprise-muted">
              Questa sequenza ti guida dalla definizione di materialità fino a un output audit-ready (dati + evidenze + calcoli + export).
            </p>
            <div className="year-kickoff-steps">
              {KICKOFF_STEPS.map((step) => (
                <label key={step.title} className="year-kickoff-step">
                  <input type="checkbox" checked={false} readOnly />
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.why}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="button" onClick={() => void openTopicSelectorFromKickoff()}>
                Inizia da Materiality → Topic Selector
              </button>
              <button className="enterprise-button-secondary" type="button" onClick={() => void goToDataEntry()}>
                Vai direttamente a Data Entry (se hai già definito i topic per questo anno)
              </button>
              <Link className="enterprise-button-secondary" href="/app/help/year-kickoff">
                Apri manuale completo
              </Link>
            </div>

            <label className="enterprise-checkbox-row">
              <input
                type="checkbox"
                checked={kickoffDoNotShow}
                onChange={(event) => setKickoffDoNotShow(event.target.checked)}
              />
              Non mostrarmelo più per questa Company/Year
            </label>

            <div className="enterprise-subcard year-kickoff-whatif">
              <strong>Cosa fare se…</strong>
              <ul className="year-kickoff-list">
                <li>Se vedi Missing factors: vai su Factors, applica i suggerimenti per Country/Site e riprova Emissions.</li>
                <li>Se non trovi Company/Site: crea o completa Company/Sites (Country) prima di inserire dati.</li>
                <li>Se vuoi aggiungere un topic: usa “Aggiungi/Modifica topic” (non serve rifare tutto).</li>
              </ul>
            </div>
          </div>
        </Modal>
      ) : null}

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
              onChange={(event) => {
                setCompanyId(event.target.value);
                companyScope.setActiveCompanyId(event.target.value);
              }}
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
              <TooltipText text={TOOLTIP_COPY.impactThreshold}>Impact threshold</TooltipText>
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
              <TooltipText text={TOOLTIP_COPY.financialThreshold}>Financial threshold</TooltipText>
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

        <div className="enterprise-subcard" style={{ marginTop: 16 }}>
          <strong>Approval workflow</strong>
          <p className="enterprise-muted">
            Status: <strong>{approval?.status || "draft"}</strong> · Approved by {approval?.approvedByName || "-"} ·{" "}
            {approval?.approvedAt
              ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(approval.approvedAt))
              : "-"}
          </p>
          <div className="enterprise-inline-actions">
            {["draft", "in_review", "approved"].map((status) => (
              <button
                key={`materiality-approval-${status}`}
                className={(approval?.status || "draft") === status ? "enterprise-button-primary" : "enterprise-button-secondary"}
                type="button"
                onClick={() => void updateApproval(status)}
                disabled={!canWrite}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="enterprise-card">
        <h3>Report Highlights</h3>
        <div className="enterprise-card-grid">
          <ReportList title="Top impact topics" items={report?.topImpactTopics || report?.topImpacts || []} scoreKey="impactScore" />
          <ReportList
            title="Top financial topics"
            items={report?.topFinancialTopics || report?.topFinancial || []}
            scoreKey="financialScore"
          />
          <ReportList title="Material topics" items={report?.materialTopics || []} scoreKey={null} />
        </div>
      </div>

      <div className="enterprise-card">
        <div ref={selectorRef} />
        <div className="enterprise-toolbar">
          <div>
            <h3>
              <TooltipText text={TOOLTIP_COPY.topicSelector}>Topic Selector</TooltipText>
            </h3>
            <p className="enterprise-muted">Choose topics to score. The scoring table only appears after selecting at least one topic.</p>
          </div>
          <div className="enterprise-inline-actions">
            <button
              className="enterprise-button-secondary"
              type="button"
              onClick={onEditTopicsClick}
            >
              Aggiungi/Modifica topic ({selectedTopicIds.length})
            </button>
            <button className="enterprise-button-secondary" type="button" onClick={() => setSelectorOpen((current) => !current)}>
              {selectorOpen ? "Chiudi selector" : "Apri selector"}
            </button>
            {canWrite ? (
              <button className="enterprise-button-secondary" type="button" onClick={() => void loadPreset(MATERIAL_SET_CODES, "Material set")}> 
                <TooltipText text={TOOLTIP_COPY.loadMaterialSet}>Load Material Set</TooltipText>
              </button>
            ) : null}
            {canWrite ? (
              <button className="enterprise-button-secondary" type="button" onClick={() => void loadPreset(TOP_PRESET_CODES, "Top impact topics preset")}>
                Top impact topics
              </button>
            ) : null}
            {canWrite ? (
              <button className="enterprise-button-secondary" type="button" onClick={() => void loadPreset(TOP_PRESET_CODES, "Top financial topics preset")}>
                Top financial topics
              </button>
            ) : null}
            {canWrite ? (
              <button
                className="enterprise-button-primary"
                type="button"
                onClick={() => {
                  if (kickoffState?.definitionCompleted) {
                    setShowTopicEditCallout(true);
                  }
                  setShowAddTopicModal(true);
                }}
              >
                + Add topic
              </button>
            ) : null}
          </div>
        </div>

        <p className="enterprise-muted">Selected: {selectedTopics.length}</p>

        {selectorOpen ? (
          <div className="materiality-selector-panel">
            <input
              className="enterprise-input"
              placeholder="Search topic by code, name, group, or SDG..."
              value={topicSearch}
              onChange={(event) => setTopicSearch(event.target.value)}
            />

            <div className="materiality-selector-groups">
              {groupedTopics.map((group) => (
                <section key={group.key} className="materiality-selector-group">
                  <h4>{group.label}</h4>
                  {group.topics.length === 0 ? (
                    <p className="enterprise-muted">No topics in this group.</p>
                  ) : (
                    <div className="materiality-selector-options">
                      {group.topics.map((topic) => {
                        const checked = selectedTopicIds.includes(topic.id);
                        return (
                          <label key={topic.id} className="materiality-selector-option">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => void toggleTopicSelection(topic.id, event.target.checked)}
                              disabled={!canWrite || savingSelection}
                            />
                            <div>
                              <div className="materiality-selector-title">
                                <strong>{topic.code}</strong>
                                <span>{topic.name}</span>
                              </div>
                              <SdgBadges sdgs={topic.sdgs} />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {scoreRows.length > 0 ? (
        <div className="enterprise-card">
          <h3>Topic Scoring</h3>
          <div className="enterprise-table-wrap">
            <table className="enterprise-table enterprise-table-wide">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>
                    <TooltipText text={TOOLTIP_COPY.severity}>Impact Severity</TooltipText>
                  </th>
                  <th>
                    <TooltipText text={TOOLTIP_COPY.scope}>Impact Scope</TooltipText>
                  </th>
                  <th>
                    <TooltipText text={TOOLTIP_COPY.irremediability}>Impact Irremediability</TooltipText>
                  </th>
                  <th>
                    <TooltipText text={TOOLTIP_COPY.likelihood}>Impact Likelihood</TooltipText>
                  </th>
                  <th>
                    <TooltipText text={TOOLTIP_COPY.magnitude}>Financial Magnitude</TooltipText>
                  </th>
                  <th>
                    <TooltipText text={TOOLTIP_COPY.financialLikelihood}>Financial Likelihood</TooltipText>
                  </th>
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
                      <SdgBadges sdgs={row.topicSdgs} />
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
                        <span className="enterprise-muted">{(topicEvidence[row.topicId] || []).length} linked</span>
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
      ) : (
        <div className="enterprise-card enterprise-empty">
          Select one or more topics from Topic Selector to start scoring.
        </div>
      )}

      <div className="enterprise-card">
        <h3>Double Materiality Matrix</h3>
        <MaterialityMatrix
          rows={matrixRows}
          impactThreshold={Number(thresholds.impactThreshold || 0)}
          financialThreshold={Number(thresholds.financialThreshold || 0)}
        />
        {matrixRows.length === 0 ? <p className="enterprise-muted">No selected topics.</p> : null}
      </div>

      {showAddTopicModal ? (
        <Modal title="Add custom topic" onClose={() => setShowAddTopicModal(false)}>
          <div className="enterprise-form-grid">
            <div>
              <label className="enterprise-label" htmlFor="custom-topic-name">
                Name
              </label>
              <input
                id="custom-topic-name"
                className="enterprise-input"
                value={customTopic.name}
                onChange={(event) => setCustomTopic((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div>
              <label className="enterprise-label" htmlFor="custom-topic-code">
                Code (optional)
              </label>
              <input
                id="custom-topic-code"
                className="enterprise-input"
                value={customTopic.code}
                onChange={(event) => setCustomTopic((current) => ({ ...current, code: event.target.value }))}
              />
            </div>

            <div>
              <label className="enterprise-label" htmlFor="custom-topic-group">
                Group
              </label>
              <select
                id="custom-topic-group"
                className="enterprise-input"
                value={customTopic.groupKey}
                onChange={(event) => setCustomTopic((current) => ({ ...current, groupKey: event.target.value }))}
              >
                {GROUPS.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="enterprise-label" htmlFor="custom-topic-category">
                Category / label
              </label>
              <input
                id="custom-topic-category"
                className="enterprise-input"
                value={customTopic.category}
                onChange={(event) => setCustomTopic((current) => ({ ...current, category: event.target.value }))}
              />
            </div>

            <div>
              <label className="enterprise-label" htmlFor="custom-topic-parent">
                Parent topic (optional)
              </label>
              <select
                id="custom-topic-parent"
                className="enterprise-input"
                value={customTopic.parentTopicId}
                onChange={(event) => setCustomTopic((current) => ({ ...current, parentTopicId: event.target.value }))}
              >
                <option value="">None</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.code} - {topic.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="enterprise-label" htmlFor="custom-topic-description">
                Description (optional)
              </label>
              <textarea
                id="custom-topic-description"
                className="enterprise-input"
                value={customTopic.description}
                onChange={(event) => setCustomTopic((current) => ({ ...current, description: event.target.value }))}
              />
            </div>

            <div>
              <label className="enterprise-label">SDGs</label>
              <div className="materiality-sdg-selector-grid">
                {SDG_OPTIONS.map((sdg) => (
                  <label key={sdg} className="materiality-sdg-selector-item">
                    <input
                      type="checkbox"
                      checked={customTopic.sdgs.includes(sdg)}
                      onChange={() => toggleCustomTopicSdg(sdg)}
                    />
                    <span>SDG {sdg}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="enterprise-inline-actions">
              <button className="enterprise-button-primary" type="button" onClick={() => void createCustomTopic()} disabled={creatingTopic}>
                {creatingTopic ? "Creating..." : "Create topic"}
              </button>
              <button
                className="enterprise-button-secondary"
                type="button"
                onClick={() => setShowAddTopicModal(false)}
                disabled={creatingTopic}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
