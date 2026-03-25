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

const toInteger = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const uniqueList = (items) => [...new Set(items)];

const normalizeTopicGroup = (value) => {
  const normalized = cleanString(value).toUpperCase();
  if (["E", "S", "G", "GEN", "CUSTOM"].includes(normalized)) {
    return normalized;
  }
  return null;
};

const inferGroupKey = ({ groupKey, code, category }) => {
  const normalizedGroup = normalizeTopicGroup(groupKey);
  if (normalizedGroup) {
    return normalizedGroup;
  }

  const normalizedCode = cleanString(code).toUpperCase();
  if (normalizedCode.startsWith("E")) {
    return "E";
  }
  if (normalizedCode.startsWith("S")) {
    return "S";
  }
  if (normalizedCode.startsWith("G") && !normalizedCode.startsWith("GEN")) {
    return "G";
  }
  if (normalizedCode.startsWith("GEN")) {
    return "GEN";
  }

  const normalizedCategory = cleanString(category).toLowerCase();
  if (normalizedCategory.includes("environment")) {
    return "E";
  }
  if (normalizedCategory.includes("social")) {
    return "S";
  }
  if (normalizedCategory.includes("governance")) {
    return "G";
  }
  if (normalizedCategory.includes("general")) {
    return "GEN";
  }
  return "CUSTOM";
};

const defaultCategoryForGroup = (groupKey) => {
  switch (groupKey) {
    case "E":
      return "Environment";
    case "S":
      return "Social";
    case "G":
      return "Governance";
    case "GEN":
      return "General";
    default:
      return "Custom";
  }
};

const normalizeSdgs = (value) => {
  const list = Array.isArray(value) ? value : [];
  const normalized = [];

  for (const item of list) {
    const parsed = toInteger(item);
    if (parsed == null) {
      return { error: "sdgs must contain only integers" };
    }
    if (parsed < 1 || parsed > 17) {
      return { error: "sdgs values must be between 1 and 17" };
    }
    normalized.push(parsed);
  }

  return {
    sdgs: uniqueList(normalized).sort((a, b) => a - b),
  };
};

const normalizeRowSdgs = (value) => {
  if (Array.isArray(value)) {
    const parsed = normalizeSdgs(value);
    if (!parsed.error) {
      return parsed.sdgs;
    }
  }

  if (typeof value === "string") {
    try {
      const parsedJson = JSON.parse(value);
      if (Array.isArray(parsedJson)) {
        const parsed = normalizeSdgs(parsedJson);
        if (!parsed.error) {
          return parsed.sdgs;
        }
      }
    } catch (_error) {
      return [];
    }
  }

  return [];
};

export const MATERIALITY_DEFAULT_THRESHOLDS = {
  impact: 9.0,
  financial: 9.0,
};

export const MATERIALITY_MATERIAL_SET_CODES = ["E1", "E2", "E3", "E4", "E5", "GEN1", "GEN2", "GEN3", "G1", "S1", "S2", "S3", "S4"];

export const MATERIALITY_DEFAULT_TOPICS = [
  {
    code: "E1",
    name: "Climate change",
    category: "Environment",
    groupKey: "E",
    sdgs: [13, 7, 12],
    description: "Climate mitigation, adaptation and resilience transition planning.",
  },
  {
    code: "E2",
    name: "Pollution",
    category: "Environment",
    groupKey: "E",
    sdgs: [3, 6, 12],
    description: "Air, soil and water pollution prevention and controls.",
  },
  {
    code: "E3",
    name: "Water and marine resources",
    category: "Environment",
    groupKey: "E",
    sdgs: [6, 14],
    description: "Freshwater withdrawals, discharges, marine impact and stewardship.",
  },
  {
    code: "E4",
    name: "Biodiversity and ecosystems",
    category: "Environment",
    groupKey: "E",
    sdgs: [14, 15],
    description: "Nature impacts, dependencies, restoration and no-deforestation commitments.",
  },
  {
    code: "E5",
    name: "Resource use and circular economy",
    category: "Environment",
    groupKey: "E",
    sdgs: [12, 9],
    description: "Materials circularity, waste prevention and recovery performance.",
  },
  {
    code: "S1",
    name: "Own workforce",
    category: "Social",
    groupKey: "S",
    sdgs: [8, 5],
    description: "Working conditions, equal treatment and workforce wellbeing outcomes.",
  },
  {
    code: "S2",
    name: "Workers in the value chain",
    category: "Social",
    groupKey: "S",
    sdgs: [8, 10],
    description: "Labour rights due diligence across suppliers and contractors.",
  },
  {
    code: "S3",
    name: "Affected communities",
    category: "Social",
    groupKey: "S",
    sdgs: [11, 16],
    description: "Community impacts, grievance mechanisms and social license.",
  },
  {
    code: "S4",
    name: "Consumers and end-users",
    category: "Social",
    groupKey: "S",
    sdgs: [3, 12],
    description: "Product safety, accessibility and customer impact management.",
  },
  {
    code: "G1",
    name: "Business conduct",
    category: "Governance",
    groupKey: "G",
    sdgs: [16],
    description: "Anti-corruption, ethics, governance controls and compliance culture.",
  },
  {
    code: "GEN1",
    name: "Data quality and controls",
    category: "General",
    groupKey: "GEN",
    sdgs: [9, 12, 16],
    description: "Data governance, controls and reporting process maturity.",
  },
  {
    code: "GEN2",
    name: "Regulatory readiness",
    category: "General",
    groupKey: "GEN",
    sdgs: [16, 17],
    description: "Readiness for CSRD/ESRS, taxonomy and jurisdictional obligations.",
  },
  {
    code: "GEN3",
    name: "Value chain resilience",
    category: "General",
    groupKey: "GEN",
    sdgs: [8, 9, 12],
    description: "Resilience and continuity risks across critical dependencies.",
  },
];

export const normalizeMaterialityTopic = (row, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  category: row.category,
  groupKey: inferGroupKey({
    groupKey: row.group_key,
    code: row.code,
    category: row.category,
  }),
  sdgs: normalizeRowSdgs(row.sdgs),
  parentTopicId: row.parent_topic_id || null,
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

  const topicSdgs = normalizeRowSdgs(topic?.sdgs);

  return {
    tenantId: row.tenant_id,
    companyId: row.company_id,
    reportingYear: Number(row.reporting_year),
    topicId: row.topic_id,
    topicCode: topic?.code || "",
    topicName: topic?.name || "",
    topicCategory: topic?.category || "",
    topicGroupKey: inferGroupKey({
      groupKey: topic?.group_key,
      code: topic?.code,
      category: topic?.category,
    }),
    topicSdgs,
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
    const existingRows = await sql`
      SELECT id
      FROM materiality_topics
      WHERE tenant_id = ${tenantId}
        AND code = ${topic.code}
        AND name = ${topic.name}
        AND COALESCE(parent_topic_id::text, '') = ''
      ORDER BY created_at ASC
      LIMIT 1
    `;

    if (existingRows?.[0]?.id) {
      await sql`
        UPDATE materiality_topics
        SET
          name = ${topic.name},
          category = ${topic.category},
          group_key = ${topic.groupKey},
          sdgs = ${JSON.stringify(topic.sdgs)}::jsonb,
          description = ${topic.description},
          updated_at = NOW()
        WHERE id = ${existingRows[0].id}
      `;
      continue;
    }

    await sql`
      INSERT INTO materiality_topics (id, tenant_id, code, name, category, group_key, sdgs, description, parent_topic_id)
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${topic.code},
        ${topic.name},
        ${topic.category},
        ${topic.groupKey},
        ${JSON.stringify(topic.sdgs)}::jsonb,
        ${topic.description},
        NULL
      )
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

export const parseSelectionPayload = (payload) => {
  const rawTopicIds = Array.isArray(payload?.topicIds)
    ? payload.topicIds
    : Array.isArray(payload?.topic_ids)
      ? payload.topic_ids
      : null;

  if (!rawTopicIds) {
    return { error: "topicIds must be an array" };
  }

  const topicIds = uniqueList(rawTopicIds.map((item) => cleanString(item)).filter(Boolean));
  return { topicIds };
};

export const parseCustomTopicPayload = (payload) => {
  const name = cleanString(payload?.name);
  if (!name) {
    return { error: "name is required" };
  }

  const code = cleanString(payload?.code).toUpperCase() || null;
  const groupKey = inferGroupKey({
    groupKey: payload?.groupKey ?? payload?.group_key,
    code,
    category: payload?.category,
  });
  const category = cleanString(payload?.category) || defaultCategoryForGroup(groupKey);
  const parentTopicId = cleanString(payload?.parentTopicId ?? payload?.parent_topic_id) || null;

  const parsedSdgs = normalizeSdgs(payload?.sdgs);
  if (parsedSdgs.error) {
    return { error: parsedSdgs.error };
  }

  return {
    topic: {
      code,
      name,
      category,
      groupKey,
      sdgs: parsedSdgs.sdgs,
      parentTopicId,
      description: cleanString(payload?.description) || null,
    },
  };
};

export const buildMaterialityReport = ({ scores, thresholds }) => {
  const matrixPoints = scores.map((score) => ({
    topicId: score.topicId,
    topicCode: score.topicCode,
    topicName: score.topicName,
    topicCategory: score.topicCategory,
    topicGroupKey: score.topicGroupKey,
    sdgs: score.topicSdgs,
    x: score.financialScore,
    y: score.impactScore,
    material: score.material,
    materialImpact: score.materialImpact,
    materialFinancial: score.materialFinancial,
  }));

  const materialTopics = scores
    .filter((score) => score.material)
    .sort((a, b) => {
      const scoreA = Math.max(a.impactScore, a.financialScore);
      const scoreB = Math.max(b.impactScore, b.financialScore);
      return scoreB - scoreA;
    });
  const topImpactTopics = [...scores].sort((a, b) => b.impactScore - a.impactScore).slice(0, 5);
  const topFinancialTopics = [...scores].sort((a, b) => b.financialScore - a.financialScore).slice(0, 5);

  return {
    matrixPoints,
    materialTopics,
    thresholds,
    topImpactTopics,
    topFinancialTopics,
    topImpacts: topImpactTopics,
    topFinancial: topFinancialTopics,
    generatedAt: new Date().toISOString(),
  };
};

const MATERIALITY_REPORT_CACHE_KEY = "__esg_rdt_materiality_report_cache__";
const MATERIALITY_REPORT_CACHE_TTL_MS = 15000;

const getReportCache = () => {
  if (!globalThis[MATERIALITY_REPORT_CACHE_KEY]) {
    globalThis[MATERIALITY_REPORT_CACHE_KEY] = new Map();
  }
  return globalThis[MATERIALITY_REPORT_CACHE_KEY];
};

export const getCachedMaterialityReport = (cacheKey) => {
  if (!cacheKey) {
    return null;
  }
  const cache = getReportCache();
  const entry = cache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAt > MATERIALITY_REPORT_CACHE_TTL_MS) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.value;
};

export const setCachedMaterialityReport = (cacheKey, value) => {
  if (!cacheKey || !value) {
    return value;
  }
  const cache = getReportCache();
  cache.set(cacheKey, {
    cachedAt: Date.now(),
    value,
  });
  if (cache.size > 50) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
  return value;
};

export const parseYearValue = toYear;
export const parseSdgsPayload = normalizeSdgs;
