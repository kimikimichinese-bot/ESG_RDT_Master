import { randomUUID } from "node:crypto";
import { cleanString, parseJsonColumn } from "./http.js";
import { roundNumber } from "./esg-domain.js";
import { getScope3SupportEntry } from "./ghg-catalog.js";

export const GHG_SCOPES = ["scope1", "scope2", "scope3"];
export const GHG_METHODS = ["activity", "spend", "supplier_specific", "direct_tco2e"];

export const SOCIAL_COMPUTED_FORMULA_KEYS = {
  HOURS_WORKED_TOTAL: "s_hs_hours_worked_total",
  TRIR: "s_hs_trir",
  LTIFR: "s_hs_ltifr",
  TRAINING_HOURS_PER_EMPLOYEE: "s_training_hours_per_employee",
  WOMEN_WORKFORCE_PCT: "s_dei_women_in_workforce_pct",
  WOMEN_MANAGEMENT_PCT: "s_dei_women_in_management_pct",
  TURNOVER_PCT: "s_turnover_pct",
  ABSENTEEISM_RATE: "s_absenteeism_rate",
};

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const toInteger = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const normalizeJsonObject = (value) => {
  const parsed = parseJsonColumn(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const normalizeJsonArray = (value) => {
  const parsed = parseJsonColumn(value);
  return Array.isArray(parsed) ? parsed : [];
};

export const parseScope = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return GHG_SCOPES.includes(normalized) ? normalized : null;
};

export const parseMethod = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return GHG_METHODS.includes(normalized) ? normalized : null;
};

export const parseScope3Category = (value) => {
  const parsed = toInteger(value);
  if (parsed == null) {
    return null;
  }
  return parsed >= 1 && parsed <= 15 ? parsed : null;
};

export const normalizeGhgDefinitionRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  scope: row.scope,
  scope3Category: row.scope3_category == null ? null : Number(row.scope3_category),
  key: row.key,
  name: row.name,
  groupKey: row.group_key,
  subGroup: row.sub_group || null,
  method: row.method,
  unit: row.unit,
  requiresFactor: Boolean(row.requires_factor),
  defaultFactorKey: row.default_factor_key || null,
  inputSchema: normalizeJsonObject(row.input_schema),
  sdgs: normalizeJsonArray(row.sdgs),
  evidenceRequired: Boolean(row.evidence_required),
  isSystem: row.is_system === true,
  isActive: Boolean(row.is_active),
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  sortOrder: Number(row.sort_order || 0),
  custom: row.is_system !== true,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const normalizeGhgRecordRow = (row, definition = null, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  siteId: row.site_id || null,
  reportingYear: Number(row.reporting_year),
  month: row.month == null ? null : Number(row.month),
  activityDefId: row.activity_def_id,
  quantity: row.quantity == null ? null : Number(row.quantity),
  amount: row.amount == null ? null : Number(row.amount),
  currency: row.currency || null,
  directTco2e: row.direct_tco2e == null ? null : Number(row.direct_tco2e),
  metadata: normalizeJsonObject(row.metadata),
  notes: row.notes || null,
  definition,
  evidenceIds,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

const normalizeMetadataToken = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const factorCandidatesForRecord = ({ definition, metadata }) => {
  const baseKey = cleanString(definition?.defaultFactorKey);
  if (!baseKey) {
    return [];
  }

  const candidates = [];
  const pushCandidate = (suffixRaw) => {
    const suffix = normalizeMetadataToken(suffixRaw);
    if (suffix) {
      candidates.push(`${baseKey}__${suffix}`);
    }
  };

  pushCandidate(metadata?.spend_category);
  pushCandidate(metadata?.transport_mode);
  pushCandidate(metadata?.refrigerant_type);
  pushCandidate(metadata?.region);
  candidates.push(baseKey);

  return [...new Set(candidates)];
};

const buildTenantFactorMap = (rows) => {
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.key, {
      key: row.key,
      value: row.value == null ? null : Number(row.value),
      unit: row.unit || null,
      sourceLabel: cleanString(row.source_label) || cleanString(row.source) || null,
      sourceUrl: cleanString(row.source_url) || null,
      resolution: "tenant_default",
      scope: null,
      scope3Category: null,
      method: null,
    });
  }
  return map;
};

const buildCountryOverrideMap = (rows) => {
  const map = new Map();
  for (const row of rows || []) {
    const country = cleanString(row.country).toUpperCase();
    if (!country) {
      continue;
    }
    map.set(`${country}:${row.key}`, {
      key: row.key,
      value: row.value == null ? null : Number(row.value),
      unit: row.unit || null,
      sourceLabel: cleanString(row.source_label) || null,
      sourceUrl: cleanString(row.source_url) || null,
      resolution: "country_override",
      scope: null,
      scope3Category: null,
      method: null,
    });
  }
  return map;
};

const chooseLibraryFactor = ({ rows, candidates, scope, scope3Category, method, country, year, metadata, library }) => {
  let best = null;

  for (const row of rows || []) {
    if (library && cleanString(row.library).toUpperCase() !== cleanString(library).toUpperCase()) {
      continue;
    }
    if (!candidates.includes(row.key)) {
      continue;
    }

    let score = 0;

    const rowCountry = cleanString(row.country).toUpperCase();
    if (rowCountry && country) {
      if (rowCountry === country) {
        score += 30;
      } else {
        continue;
      }
    } else if (!rowCountry) {
      score += 10;
    }

    const rowYear = row.reporting_year == null ? row.year : row.reporting_year;
    if (rowYear == null) {
      score += 5;
    } else if (Number(rowYear) === Number(year)) {
      score += 15;
    } else {
      continue;
    }

    const rowScope = cleanString(row.scope).toLowerCase();
    if (rowScope) {
      if (rowScope !== scope) {
        continue;
      }
      score += 8;
    }

    const rowScope3Category = row.scope3_category == null ? null : Number(row.scope3_category);
    if (rowScope3Category != null) {
      if (scope3Category == null || Number(scope3Category) !== rowScope3Category) {
        continue;
      }
      score += 8;
    }

    const rowMethod = cleanString(row.method).toLowerCase();
    if (rowMethod) {
      if (rowMethod !== method) {
        continue;
      }
      score += 5;
    }

    const spendCategory = normalizeMetadataToken(metadata?.spend_category);
    const rowSpendCategory = normalizeMetadataToken(row.spend_category);
    if (rowSpendCategory) {
      if (!spendCategory || spendCategory !== rowSpendCategory) {
        continue;
      }
      score += 4;
    }

    const transportMode = normalizeMetadataToken(metadata?.transport_mode);
    const rowTransportMode = normalizeMetadataToken(row.transport_mode);
    if (rowTransportMode) {
      if (!transportMode || transportMode !== rowTransportMode) {
        continue;
      }
      score += 4;
    }

    const refrigerantType = normalizeMetadataToken(metadata?.refrigerant_type);
    const rowRefrigerantType = normalizeMetadataToken(row.refrigerant_type);
    if (rowRefrigerantType) {
      if (!refrigerantType || refrigerantType !== rowRefrigerantType) {
        continue;
      }
      score += 4;
    }

    const region = normalizeMetadataToken(metadata?.region);
    const rowRegion = normalizeMetadataToken(row.region);
    if (rowRegion) {
      if (!region || region !== rowRegion) {
        continue;
      }
      score += 3;
    }

    if (!best || score > best.score) {
      best = {
        score,
        key: row.key,
        value: row.value == null ? null : Number(row.value),
        unit: row.unit || null,
        sourceLabel: cleanString(row.source_label) || `${row.library} library`,
        sourceUrl: cleanString(row.source_url) || null,
        resolution: "library_suggestion",
        library: row.library,
      };
    }
  }

  return best;
};

const validateRecordAgainstDefinition = ({ record, definition }) => {
  if (!definition) {
    return { code: "invalid_definition", message: "activityDefId is invalid for this tenant" };
  }

  if (definition.method === "activity") {
    const quantity = toNumber(record.quantity);
    if (quantity == null) {
      return { code: "missing_quantity", message: `quantity is required for method ${definition.method}` };
    }
  }

  if (definition.method === "spend") {
    const amount = toNumber(record.amount);
    if (amount == null || !cleanString(record.currency)) {
      return { code: "missing_spend_fields", message: "amount and currency are required for spend method" };
    }
  }

  if (definition.method === "direct_tco2e") {
    const direct = toNumber(record.direct_tco2e ?? record.directTco2e);
    if (direct == null) {
      return { code: "missing_direct_tco2e", message: "direct_tco2e is required for direct_tco2e method" };
    }
  }

  if (definition.method === "supplier_specific") {
    const direct = toNumber(record.direct_tco2e ?? record.directTco2e);
    const quantity = toNumber(record.quantity);
    if (direct == null && quantity == null) {
      return {
        code: "invalid_supplier_specific",
        message: "supplier_specific requires direct_tco2e or quantity with resolvable factor",
      };
    }
  }

  return null;
};

export const parseGhgRecordPayload = ({ payload, activityDefinitionsById }) => {
  const companyId = cleanString(payload?.companyId);
  const siteId = cleanString(payload?.siteId) || null;
  const reportingYear = toInteger(payload?.reportingYear);
  const monthRaw = payload?.month == null ? null : toInteger(payload?.month);

  if (!companyId) {
    return { error: { code: "missing_company_id", message: "companyId is required" } };
  }
  if (!reportingYear || reportingYear < 1900 || reportingYear > 2200) {
    return { error: { code: "invalid_reporting_year", message: "reportingYear must be a valid year" } };
  }
  if (monthRaw != null && (monthRaw < 1 || monthRaw > 12)) {
    return { error: { code: "invalid_month", message: "month must be between 1 and 12" } };
  }

  const activityDefId = cleanString(payload?.activityDefId);
  if (!activityDefId) {
    return { error: { code: "missing_activity_def_id", message: "activityDefId is required" } };
  }

  const definition = activityDefinitionsById.get(activityDefId);
  const validationError = validateRecordAgainstDefinition({ record: payload, definition });
  if (validationError) {
    return { error: validationError };
  }

  const metadata = normalizeJsonObject(payload?.metadata);

  return {
    record: {
      id: cleanString(payload?.id) || randomUUID(),
      companyId,
      siteId,
      reportingYear,
      month: monthRaw,
      activityDefId,
      quantity: toNumber(payload?.quantity),
      amount: toNumber(payload?.amount),
      currency: cleanString(payload?.currency) || null,
      directTco2e: toNumber(payload?.directTco2e ?? payload?.direct_tco2e),
      metadata,
      notes: cleanString(payload?.notes) || null,
    },
  };
};

const resolveFactorForRecord = ({
  definition,
  record,
  siteCountry,
  reportingYear,
  tenantFactorMap,
  countryOverrideMap,
  libraryRows,
  library,
}) => {
  const candidates = factorCandidatesForRecord({ definition, metadata: record.metadata || {} });
  for (const key of candidates) {
    const override = siteCountry ? countryOverrideMap.get(`${siteCountry}:${key}`) : null;
    if (override && override.value != null) {
      return { ...override, key };
    }
  }

  for (const key of candidates) {
    const tenant = tenantFactorMap.get(key);
    if (tenant && tenant.value != null) {
      return { ...tenant, key };
    }
  }

  const libraryMatch = chooseLibraryFactor({
    rows: libraryRows,
    candidates,
    scope: definition.scope,
    scope3Category: definition.scope3Category,
    method: definition.method,
    country: siteCountry,
    year: reportingYear,
    metadata: record.metadata || {},
    library,
  });

  if (libraryMatch && libraryMatch.value != null) {
    return libraryMatch;
  }

  return {
    key: candidates[0] || definition.defaultFactorKey || null,
    value: null,
    unit: null,
    sourceLabel: null,
    sourceUrl: null,
    resolution: "missing",
  };
};

export const computeGhgInventory = ({
  records = [],
  definitions = [],
  companies = [],
  sites = [],
  tenantFactorRows = [],
  countryOverrideRows = [],
  factorLibraryRows = [],
  library = null,
  defaultCountry = null,
}) => {
  const definitionById = new Map(definitions.map((item) => [item.id, item]));
  const siteById = new Map(sites.map((item) => [item.id, item]));
  const companyById = new Map(companies.map((item) => [item.id, item]));

  const tenantFactorMap = buildTenantFactorMap(tenantFactorRows);
  const countryOverrideMap = buildCountryOverrideMap(countryOverrideRows);

  const warnings = [];
  const missingFactors = new Set();

  const byScope = {
    scope1: 0,
    scope2: 0,
    scope3: 0,
  };

  const byScope3Category = new Map();
  const byCompany = new Map();
  const bySite = new Map();

  const computedRecords = [];

  for (const rawRecord of records) {
    const definition = definitionById.get(rawRecord.activityDefId || rawRecord.activity_def_id);
    if (!definition) {
      warnings.push(`Missing activity definition for record ${rawRecord.id || "unknown"}`);
      continue;
    }

    const siteId = rawRecord.siteId ?? rawRecord.site_id ?? null;
    const site = siteId ? siteById.get(siteId) : null;
    const companyId = rawRecord.companyId ?? rawRecord.company_id;
    const company = companyById.get(companyId);
    const supportEntry =
      definition.scope === "scope3" && definition.scope3Category != null ? getScope3SupportEntry(definition.scope3Category) : null;

    const country = cleanString(site?.country || company?.country || defaultCountry).toUpperCase() || null;
    const resolvedFactor = definition.requiresFactor
      ? resolveFactorForRecord({
          definition,
          record: rawRecord,
          siteCountry: country,
          reportingYear: rawRecord.reportingYear ?? rawRecord.reporting_year,
          tenantFactorMap,
          countryOverrideMap,
          libraryRows: factorLibraryRows,
          library,
        })
      : {
          key: definition.defaultFactorKey || null,
          value: null,
          unit: null,
          sourceLabel: null,
          sourceUrl: null,
          resolution: "direct",
        };

    let tco2e = null;

    if (definition.method === "direct_tco2e") {
      tco2e = toNumber(rawRecord.directTco2e ?? rawRecord.direct_tco2e);
    } else if (definition.method === "spend") {
      const amount = toNumber(rawRecord.amount);
      if (amount != null && resolvedFactor.value != null) {
        tco2e = (amount * resolvedFactor.value) / 1000;
      }
    } else if (definition.method === "supplier_specific") {
      const direct = toNumber(rawRecord.directTco2e ?? rawRecord.direct_tco2e);
      if (direct != null) {
        tco2e = direct;
      } else {
        const quantity = toNumber(rawRecord.quantity);
        if (quantity != null && resolvedFactor.value != null) {
          tco2e = (quantity * resolvedFactor.value) / 1000;
        }
      }
    } else {
      const quantity = toNumber(rawRecord.quantity);
      if (quantity != null && resolvedFactor.value != null) {
        tco2e = (quantity * resolvedFactor.value) / 1000;
      }
    }

    if (tco2e == null || !Number.isFinite(tco2e)) {
      if (resolvedFactor.key) {
        missingFactors.add(resolvedFactor.key);
      }
      warnings.push(`Unable to compute ${definition.key} for record ${rawRecord.id || "unknown"}`);
      tco2e = null;
    }

    const normalizedTco2e = tco2e == null ? null : roundNumber(tco2e, 6);

    if (normalizedTco2e != null) {
      byScope[definition.scope] = roundNumber(byScope[definition.scope] + normalizedTco2e, 6);

      if (definition.scope === "scope3" && definition.scope3Category != null) {
        const current = byScope3Category.get(definition.scope3Category) || 0;
        byScope3Category.set(definition.scope3Category, roundNumber(current + normalizedTco2e, 6));
      }

      if (!byCompany.has(companyId)) {
        byCompany.set(companyId, {
          companyId,
          name: company?.name || "Unknown company",
          scope1Tco2e: 0,
          scope2Tco2e: 0,
          scope3Tco2e: 0,
        });
      }
      const companyItem = byCompany.get(companyId);
      if (definition.scope === "scope1") {
        companyItem.scope1Tco2e = roundNumber(companyItem.scope1Tco2e + normalizedTco2e, 6);
      } else if (definition.scope === "scope2") {
        companyItem.scope2Tco2e = roundNumber(companyItem.scope2Tco2e + normalizedTco2e, 6);
      } else {
        companyItem.scope3Tco2e = roundNumber(companyItem.scope3Tco2e + normalizedTco2e, 6);
      }

      if (siteId) {
        if (!bySite.has(siteId)) {
          bySite.set(siteId, {
            siteId,
            companyId,
            name: site?.name || "Unknown site",
            country: country || null,
            scope1Tco2e: 0,
            scope2Tco2e: 0,
            scope3Tco2e: 0,
          });
        }
        const siteItem = bySite.get(siteId);
        if (definition.scope === "scope1") {
          siteItem.scope1Tco2e = roundNumber(siteItem.scope1Tco2e + normalizedTco2e, 6);
        } else if (definition.scope === "scope2") {
          siteItem.scope2Tco2e = roundNumber(siteItem.scope2Tco2e + normalizedTco2e, 6);
        } else {
          siteItem.scope3Tco2e = roundNumber(siteItem.scope3Tco2e + normalizedTco2e, 6);
        }
      }
    }

    if (supportEntry?.status === "partial") {
      warnings.push(`Scope 3 category ${supportEntry.category} (${supportEntry.label}) uses structured partial support. ${supportEntry.note}`);
    } else if (supportEntry?.status === "not_enabled") {
      warnings.push(`Scope 3 category ${supportEntry.category} (${supportEntry.label}) is not enabled. ${supportEntry.note}`);
    }

    computedRecords.push({
      recordId: rawRecord.id,
      activityDefId: definition.id,
      activityKey: definition.key,
      activityName: definition.name,
      scope: definition.scope,
      scope3Category: definition.scope3Category,
      quantity: rawRecord.quantity == null ? null : Number(rawRecord.quantity),
      amount: rawRecord.amount == null ? null : Number(rawRecord.amount),
      currency: rawRecord.currency || null,
      directTco2e: rawRecord.directTco2e == null ? null : Number(rawRecord.directTco2e),
      metadata: normalizeJsonObject(rawRecord.metadata),
      tco2e: normalizedTco2e,
      supportStatus: supportEntry?.status || (definition.scope === "scope3" ? "unknown" : "supported"),
      supportNote: supportEntry?.note || null,
      factorUsed: {
        key: resolvedFactor.key,
        value: resolvedFactor.value,
        unit: resolvedFactor.unit,
        sourceLabel: resolvedFactor.sourceLabel,
        sourceUrl: resolvedFactor.sourceUrl,
        resolution: resolvedFactor.resolution,
      },
    });
  }

  const scope3Breakdown = [...byScope3Category.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([category, total]) => ({ category, totalTco2e: roundNumber(total, 6) }));

  const coverage = computedRecords.length
    ? roundNumber(
        ((computedRecords.filter((item) => item.factorUsed?.resolution !== "missing" && item.tco2e != null).length /
          computedRecords.length) *
          100),
        2,
      )
    : 100;

  return {
    scopeTotals: {
      scope1Tco2e: roundNumber(byScope.scope1, 6),
      scope2Tco2e: roundNumber(byScope.scope2, 6),
      scope3Tco2e: roundNumber(byScope.scope3, 6),
      totalTco2e: roundNumber(byScope.scope1 + byScope.scope2 + byScope.scope3, 6),
    },
    scope3Breakdown,
    companies: [...byCompany.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sites: [...bySite.values()].sort((a, b) => a.name.localeCompare(b.name)),
    records: computedRecords,
    missingFactors: [...missingFactors].sort(),
    warnings: [...new Set(warnings)],
    coverage,
  };
};

const sumByGender = (rows, valueKey) => {
  let total = 0;
  let female = 0;
  for (const row of rows || []) {
    const value = Number(row[valueKey] || 0);
    total += value;
    if (row.gender === "F") {
      female += value;
    }
  }
  return { total, female };
};

const safePct = (numerator, denominator) => {
  if (!denominator) {
    return 0;
  }
  return roundNumber((Number(numerator) / Number(denominator)) * 100, 4);
};

const aggregateWorkforceTotals = ({ workforceRows, leaverRows, managementRows }) => {
  const yearEndTotals = (workforceRows || []).filter((row) => row.month === 12 && row.contract_type === "total");
  const workforceGender = sumByGender(yearEndTotals, "headcount");
  const managementGender = sumByGender(managementRows || [], "headcount");

  const monthlyTotals = new Map();
  let hoursWorkedTotal = 0;
  for (const row of workforceRows || []) {
    if (row.contract_type === "total") {
      monthlyTotals.set(row.month, Number(monthlyTotals.get(row.month) || 0) + Number(row.headcount || 0));
    }
    hoursWorkedTotal += Number(row.hours_worked || 0);
  }

  const avgHeadcount =
    monthlyTotals.size > 0
      ? [...monthlyTotals.values()].reduce((acc, value) => acc + Number(value || 0), 0) / monthlyTotals.size
      : 0;

  const leaversTotal = (leaverRows || []).reduce((acc, row) => acc + Number(row.leavers || 0), 0);

  return {
    totalEmployeesYearEnd: workforceGender.total,
    womenInWorkforcePct: safePct(workforceGender.female, workforceGender.total),
    womenInManagementPct: safePct(managementGender.female, managementGender.total),
    turnoverPct: safePct(leaversTotal, avgHeadcount),
    hoursWorkedTotal: roundNumber(hoursWorkedTotal, 4),
    avgHeadcount: roundNumber(avgHeadcount, 4),
    leaversTotal: roundNumber(leaversTotal, 4),
  };
};

export const computeSocialCatalogMetrics = ({
  metricDefinitions = [],
  socialRecords = [],
  workforceRows = [],
  leaverRows = [],
  managementRows = [],
}) => {
  const totals = aggregateWorkforceTotals({ workforceRows, leaverRows, managementRows });
  const manualByKey = new Map();

  for (const record of socialRecords || []) {
    const key = cleanString(record.metric_key || record.key);
    if (!key) {
      continue;
    }
    const current = Number(manualByKey.get(key) || 0);
    manualByKey.set(key, current + Number(record.value || 0));
  }

  const values = {};

  for (const definition of metricDefinitions || []) {
    const key = definition.key;
    if (definition.method === "manual") {
      values[key] = roundNumber(Number(manualByKey.get(key) || 0), 6);
      continue;
    }

    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.HOURS_WORKED_TOTAL) {
      values[key] = totals.hoursWorkedTotal;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.TRIR) {
      const incidents = Number(manualByKey.get("s_hs_total_recordable_incidents") || 0);
      values[key] = totals.hoursWorkedTotal > 0 ? roundNumber((incidents * 200000) / totals.hoursWorkedTotal, 6) : 0;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.LTIFR) {
      const incidents = Number(manualByKey.get("s_hs_lost_time_incidents") || 0);
      values[key] = totals.hoursWorkedTotal > 0 ? roundNumber((incidents * 1000000) / totals.hoursWorkedTotal, 6) : 0;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.TRAINING_HOURS_PER_EMPLOYEE) {
      const trainingHours = Number(manualByKey.get("s_training_hours_total") || 0);
      values[key] = totals.avgHeadcount > 0 ? roundNumber(trainingHours / totals.avgHeadcount, 6) : 0;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.WOMEN_WORKFORCE_PCT) {
      values[key] = totals.womenInWorkforcePct;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.WOMEN_MANAGEMENT_PCT) {
      values[key] = totals.womenInManagementPct;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.TURNOVER_PCT) {
      values[key] = totals.turnoverPct;
      continue;
    }
    if (key === SOCIAL_COMPUTED_FORMULA_KEYS.ABSENTEEISM_RATE) {
      const days = Number(manualByKey.get("s_absenteeism_days") || 0);
      const denominator = totals.avgHeadcount * 220;
      values[key] = denominator > 0 ? roundNumber((days / denominator) * 100, 6) : 0;
      continue;
    }

    values[key] = 0;
  }

  return {
    values,
    aggregates: totals,
  };
};
