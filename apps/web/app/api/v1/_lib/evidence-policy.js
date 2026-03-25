const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const parseJsonColumn = (value) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  return null;
};

const buildCoverageStats = ({ items }) => {
  const requiredItems = items.filter((item) => item.requirementLevel === "required");
  const recommendedItems = items.filter((item) => item.requirementLevel === "recommended");
  const requiredCovered = requiredItems.filter((item) => item.covered).length;
  const recommendedCovered = recommendedItems.filter((item) => item.covered).length;
  const requiredCount = requiredItems.length;
  const recommendedCount = recommendedItems.length;
  const missingRequired = requiredItems.filter((item) => !item.covered);
  const missingRecommended = recommendedItems.filter((item) => !item.covered);

  return {
    requiredCount,
    coveredCount: requiredCovered,
    missingCount: missingRequired.length,
    coveragePct: requiredCount > 0 ? Number(((requiredCovered / requiredCount) * 100).toFixed(2)) : 100,
    missingEvidence: missingRequired,
    requiredCoverage: {
      requiredCount,
      coveredCount: requiredCovered,
      missingCount: missingRequired.length,
      coveragePct: requiredCount > 0 ? Number(((requiredCovered / requiredCount) * 100).toFixed(2)) : 100,
      missingEvidence: missingRequired,
    },
    recommendedCoverage: {
      requiredCount: recommendedCount,
      coveredCount: recommendedCovered,
      missingCount: missingRecommended.length,
      coveragePct: recommendedCount > 0 ? Number(((recommendedCovered / recommendedCount) * 100).toFixed(2)) : 100,
      missingEvidence: missingRecommended,
    },
  };
};

export const buildEvidenceCoverage = ({
  evidenceRows,
  metricRows,
  metricDefinitionRows,
  ghgDefinitionsRows,
  ghgRecordsRows,
  socialMetricRows,
  socialRecordRows,
  governanceRows,
  governanceFieldRows,
  materialityTopicChecks = [],
}) => {
  const evidenceMap = new Map();
  for (const row of evidenceRows || []) {
    const entityType = cleanString(row.entity_type);
    const entityId = cleanString(row.entity_id);
    if (!entityType || !entityId) {
      continue;
    }
    const key = `${entityType}:${entityId}`;
    if (!evidenceMap.has(key)) {
      evidenceMap.set(key, new Set());
    }
    if (cleanString(row.evidence_id)) {
      evidenceMap.get(key).add(cleanString(row.evidence_id));
    }
  }

  const metricDefinitionsByKey = new Map();
  for (const row of metricDefinitionRows || []) {
    const key = cleanString(row.key);
    if (!key || metricDefinitionsByKey.has(key)) {
      continue;
    }
    const validation = parseJsonColumn(row.validation) || {};
    metricDefinitionsByKey.set(key, {
      evidenceRequired: validation.evidenceRequired === true,
      label: row.label || key,
    });
  }

  const ghgDefinitionsById = new Map((ghgDefinitionsRows || []).map((row) => [row.id, row]));
  const socialDefinitionsByKey = new Map((socialMetricRows || []).map((row) => [row.key, row]));
  const governanceEvidenceRequired = (governanceFieldRows || []).some((row) => row.evidence_required === true);

  const items = [];
  const addItem = ({ entityType, entityId, label, reason, requirementLevel }) => {
    const key = `${entityType}:${entityId}`;
    items.push({
      entityType,
      entityId,
      label,
      reason,
      requirementLevel,
      covered: evidenceMap.has(key),
    });
  };

  for (const row of metricRows || []) {
    const definition = metricDefinitionsByKey.get(cleanString(row.metric_key));
    if (!definition?.evidenceRequired) {
      continue;
    }
    addItem({
      entityType: "metric",
      entityId: row.id,
      label: definition.label,
      reason: "Environment metric requires evidence",
      requirementLevel: "required",
    });
  }

  for (const row of ghgRecordsRows || []) {
    const definition = ghgDefinitionsById.get(row.activity_def_id);
    if (!definition || definition.evidence_required !== true) {
      continue;
    }
    addItem({
      entityType: "ghg_record",
      entityId: row.id,
      label: definition.name || definition.key || row.activity_def_id,
      reason: "GHG record requires evidence",
      requirementLevel: "required",
    });
  }

  for (const row of socialRecordRows || []) {
    const definition = socialDefinitionsByKey.get(cleanString(row.metric_key));
    if (!definition || definition.evidence_required !== true) {
      continue;
    }
    addItem({
      entityType: "social_record",
      entityId: row.id,
      label: definition.name || definition.key || row.metric_key,
      reason: "Social record should include evidence",
      requirementLevel: "recommended",
    });
  }

  for (const row of governanceRows || []) {
    if (!governanceEvidenceRequired) {
      continue;
    }
    addItem({
      entityType: "governance_yearly",
      entityId: row.id,
      label: row.company_id || row.id,
      reason: "Governance yearly record requires supporting evidence",
      requirementLevel: "required",
    });
  }

  for (const item of materialityTopicChecks || []) {
    if (!item?.topicId) {
      continue;
    }
    addItem({
      entityType: "materiality_topic",
      entityId: item.topicId,
      label: item.label || item.topicCode || item.topicId,
      reason: item.reason || "Materiality topic should include evidence",
      requirementLevel: item.requirementLevel === "required" ? "required" : "recommended",
    });
  }

  return buildCoverageStats({ items });
};

export const buildEcoVadisEvidenceCoverage = ({ answers = [] }) => {
  const items = (answers || []).map((answer) => ({
    entityType: "ecovadis_answer",
    entityId: answer.answerId,
    label: answer.label || answer.code || answer.answerId,
    reason: answer.reason || "EcoVadis answer requires evidence",
    requirementLevel: answer.requirementLevel === "recommended" ? "recommended" : "required",
    covered: Number(answer.evidenceCount || 0) > 0,
  }));
  return buildCoverageStats({ items });
};
