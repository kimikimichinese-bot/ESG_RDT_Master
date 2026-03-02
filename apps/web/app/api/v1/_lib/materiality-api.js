import { randomUUID } from "node:crypto";

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const toIso = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const toRounded = (value) => Number(Number(value || 0).toFixed(2));

const toScoreValue = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 1 || parsed > 5) {
    return null;
  }
  return parsed;
};

const toYear = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2200) {
    return null;
  }
  return parsed;
};

export const MATERIALITY_DEFAULT_THRESHOLDS = {
  impact: 9.0,
  financial: 9.0,
};

export const MATERIALITY_DEFAULT_TOPICS = [
  {
    code: "E1",
    name: "Climate change",
    category: "Environment",
    description: "Climate mitigation, adaptation and resilience transition planning.",
  },
  {
    code: "E2",
    name: "Pollution",
    category: "Environment",
    description: "Air, soil and water pollution prevention and controls.",
  },
  {
    code: "E3",
    name: "Water and marine resources",
    category: "Environment",
    description: "Freshwater withdrawals, discharges, marine impact and stewardship.",
  },
  {
    code: "E4",
    name: "Biodiversity and ecosystems",
    category: "Environment",
    description: "Nature impacts, dependencies, restoration and no-deforestation commitments.",
  },
  {
    code: "E5",
    name: "Resource use and circular economy",
    category: "Environment",
    description: "Materials circularity, waste prevention and recovery performance.",
  },
  {
    code: "S1",
    name: "Own workforce",
    category: "Social",
    description: "Working conditions, equal treatment and workforce wellbeing outcomes.",
  },
  {
    code: "S2",
    name: "Workers in the value chain",
    category: "Social",
    description: "Labour rights due diligence across suppliers and contractors.",
  },
  {
    code: "S3",
    name: "Affected communities",
    category: "Social",
    description: "Community impacts, grievance mechanisms and social license.",
  },
  {
    code: "S4",
    name: "Consumers and end-users",
    category: "Social",
    description: "Product safety, accessibility and customer impact management.",
  },
  {
    code: "G1",
    name: "Business conduct",
    category: "Governance",
    description: "Anti-corruption, ethics, governance controls and compliance culture.",
  },
  {
    code: "GEN1",
    name: "Data quality and controls",
    category: "General",
    description: "Data governance, controls and reporting process maturity.",
  },
  {
    code: "GEN2",
    name: "Regulatory readiness",
    category: "General",
    description: "Readiness for CSRD/ESRS, taxonomy and jurisdictional obligations.",
  },
  {
    code: "GEN3",
    name: "Value chain resilience",
    category: "General",
    description: "Resilience and continuity risks across critical dependencies.",
  },
];

export const normalizeMaterialityTopic = (row, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  category: row.category,
  description: row.description || "",
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  evidenceIds,
});

export const normalizeMaterialityScore = ({ row, topic, thresholds }) => {
  const impactScore = computeImpactScore({
    severity: row.impact_severity,
    scope: row.impact_scope,
    irremediability: row.impact_irremediability,
    likelihood: row.impact_likelihood,
  });
  const financialScore = computeFinancialScore({
    magnitude: row.financial_magnitude,
    likelihood: row.financial_likelihood,
  });

  return {
    tenantId: row.tenant_id,
    companyId: row.company_id,
    reportingYear: Number(row.reporting_year),
    topicId: row.topic_id,
    topicCode: topic?.code || "",
    topicName: topic?.name || "",
    topicCategory: topic?.category || "",
    impactSeverity: Number(row.impact_severity),
    impactScope: Number(row.impact_scope),
    impactIrremediability: Number(row.impact_irremediability),
    impactLikelihood: Number(row.impact_likelihood),
    financialMagnitude: Number(row.financial_magnitude),
    financialLikelihood: Number(row.financial_likelihood),
    impactScore,
    financialScore,
    materialImpact: impactScore >= thresholds.impactThreshold,
    materialFinancial: financialScore >= thresholds.financialThreshold,
    material: impactScore >= thresholds.impactThreshold || financialScore >= thresholds.financialThreshold,
    notes: row.notes || "",
    updatedAt: toIso(row.updated_at),
  };
};

export const computeImpactScore = ({ severity, scope, irremediability, likelihood }) => {
  const numerator = Number(severity) + Number(scope) + Number(irremediability);
  return toRounded((numerator / 3) * Number(likelihood));
};

export const computeFinancialScore = ({ magnitude, likelihood }) => {
  return toRounded(Number(magnitude) * Number(likelihood));
};

export const ensureMaterialityDefaults = async ({ sql, tenantId }) => {
  for (const topic of MATERIALITY_DEFAULT_TOPICS) {
    await sql`
      INSERT INTO materiality_topics (id, tenant_id, code, name, category, description)
      VALUES (${randomUUID()}, ${tenantId}, ${topic.code}, ${topic.name}, ${topic.category}, ${topic.description})
      ON CONFLICT (tenant_id, code)
      DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        updated_at = NOW()
    `;
  }

  await sql`
    INSERT INTO materiality_thresholds (tenant_id, impact_threshold, financial_threshold, updated_at)
    VALUES (${tenantId}, ${MATERIALITY_DEFAULT_THRESHOLDS.impact}, ${MATERIALITY_DEFAULT_THRESHOLDS.financial}, NOW())
    ON CONFLICT (tenant_id)
    DO NOTHING
  `;
};

export const getMaterialityThresholds = async ({ sql, tenantId }) => {
  const rows = await sql`
    SELECT tenant_id, impact_threshold, financial_threshold, updated_at
    FROM materiality_thresholds
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `;

  const row = rows?.[0];
  if (!row) {
    return {
      tenantId,
      impactThreshold: MATERIALITY_DEFAULT_THRESHOLDS.impact,
      financialThreshold: MATERIALITY_DEFAULT_THRESHOLDS.financial,
      updatedAt: null,
    };
  }

  return {
    tenantId,
    impactThreshold: Number(row.impact_threshold),
    financialThreshold: Number(row.financial_threshold),
    updatedAt: toIso(row.updated_at),
  };
};

export const parseThresholdPayload = (payload) => {
  const impact = Number(payload?.impactThreshold);
  const financial = Number(payload?.financialThreshold);

  if (!Number.isFinite(impact) || impact <= 0) {
    return null;
  }
  if (!Number.isFinite(financial) || financial <= 0) {
    return null;
  }

  return {
    impactThreshold: toRounded(impact),
    financialThreshold: toRounded(financial),
  };
};

export const parseScoreRowsPayload = (rows) => {
  if (!Array.isArray(rows)) {
    return { error: "rows must be an array" };
  }

  const normalized = [];
  for (const row of rows) {
    const topicId = cleanString(row.topicId);
    if (!topicId) {
      return { error: "Each row requires topicId" };
    }

    const impactSeverity = toScoreValue(row.impactSeverity);
    const impactScope = toScoreValue(row.impactScope);
    const impactIrremediability = toScoreValue(row.impactIrremediability);
    const impactLikelihood = toScoreValue(row.impactLikelihood);
    const financialMagnitude = toScoreValue(row.financialMagnitude);
    const financialLikelihood = toScoreValue(row.financialLikelihood);

    if (
      impactSeverity == null ||
      impactScope == null ||
      impactIrremediability == null ||
      impactLikelihood == null ||
      financialMagnitude == null ||
      financialLikelihood == null
    ) {
      return { error: `Score values for topic ${topicId} must all be integers 1..5` };
    }

    normalized.push({
      topicId,
      impactSeverity,
      impactScope,
      impactIrremediability,
      impactLikelihood,
      financialMagnitude,
      financialLikelihood,
      notes: cleanString(row.notes) || null,
    });
  }

  return { rows: normalized };
};

export const parseReportQuery = (request) => {
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const year = toYear(url.searchParams.get("year"));

  if (!companyId) {
    return { error: "companyId is required" };
  }
  if (!year) {
    return { error: "Valid year is required" };
  }

  return {
    companyId,
    reportingYear: year,
  };
};

export const buildMaterialityReport = ({ scores, thresholds }) => {
  const matrixPoints = scores.map((score) => ({
    topicId: score.topicId,
    topicCode: score.topicCode,
    topicName: score.topicName,
    topicCategory: score.topicCategory,
    x: score.financialScore,
    y: score.impactScore,
    material: score.material,
    materialImpact: score.materialImpact,
    materialFinancial: score.materialFinancial,
  }));

  const materialTopics = scores.filter((score) => score.material);
  const topImpacts = [...scores].sort((a, b) => b.impactScore - a.impactScore).slice(0, 5);
  const topFinancial = [...scores].sort((a, b) => b.financialScore - a.financialScore).slice(0, 5);

  return {
    matrixPoints,
    materialTopics,
    thresholds,
    topImpacts,
    topFinancial,
    generatedAt: new Date().toISOString(),
  };
};

export const parseYearValue = toYear;
