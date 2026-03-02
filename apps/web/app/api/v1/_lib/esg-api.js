import { randomUUID } from "node:crypto";
import {
  EMISSION_FACTOR_DEFINITIONS,
  FACTOR_REFERENCE_OPTIONS_BY_KEY,
  METRIC_DEFINITION_BY_KEY,
  METRIC_DEFINITIONS,
  parseInteger,
  parseNumber,
  parseYear,
  roundNumber,
  validateMetricMap,
} from "./esg-domain.js";
import { cleanString } from "./http.js";

export const parseBoolean = (value) => value === true || String(value).trim().toLowerCase() === "true";

export const resolveCompany = async (sql, tenantId, companyId) => {
  const cleaned = cleanString(companyId);
  if (!cleaned) {
    return null;
  }

  const rows = await sql`
    SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    FROM companies
    WHERE tenant_id = ${tenantId} AND id = ${cleaned}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export const resolveSite = async (sql, tenantId, siteId) => {
  const cleaned = cleanString(siteId);
  if (!cleaned) {
    return null;
  }

  const rows = await sql`
    SELECT id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
    FROM sites
    WHERE tenant_id = ${tenantId} AND id = ${cleaned}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export const ensureSiteAndCompanyScope = async ({ sql, tenantId, siteId, companyId = null }) => {
  const site = await resolveSite(sql, tenantId, siteId);
  if (!site) {
    return { error: "Valid siteId is required", status: 400 };
  }

  if (companyId && cleanString(companyId) !== site.company_id) {
    return { error: "siteId does not belong to companyId", status: 400 };
  }

  const company = await resolveCompany(sql, tenantId, site.company_id);
  if (!company) {
    return { error: "Linked company not found", status: 400 };
  }

  return {
    site,
    company,
  };
};

export const validateAndNormalizeMetricEntries = ({ entries, existingMap, strictWaterDischarge }) => {
  const errors = [];
  const warnings = [];
  const normalizedEntries = [];
  const metricMap = new Map(existingMap || []);

  for (const entry of entries || []) {
    const metricKey = cleanString(entry.metricKey);
    const definition = METRIC_DEFINITION_BY_KEY.get(metricKey);
    if (!definition) {
      errors.push(`Unknown metric key: ${metricKey || "<empty>"}`);
      continue;
    }
    if (definition.validation?.derived) {
      errors.push(`${metricKey} is derived and cannot be manually set`);
      continue;
    }

    const value = parseNumber(entry.value);
    if (value == null) {
      errors.push(`${metricKey} must be numeric`);
      continue;
    }
    if (value < 0) {
      errors.push(`${metricKey} must be >= 0`);
      continue;
    }

    const requestedUnit = cleanString(entry.unit);
    if (requestedUnit && requestedUnit !== definition.unit) {
      errors.push(`${metricKey} expects unit ${definition.unit}`);
      continue;
    }

    metricMap.set(metricKey, value);
    normalizedEntries.push({
      metricKey,
      value,
      unit: definition.unit,
      evidenceIds: Array.isArray(entry.evidenceIds)
        ? entry.evidenceIds.map((item) => cleanString(item)).filter((item) => item.length > 0)
        : [],
    });
  }

  const validation = validateMetricMap({
    metricMap,
    strictWaterDischarge,
    enforceRequired: false,
    ignoreDerived: true,
  });

  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  return {
    errors,
    warnings,
    normalizedEntries,
    metricMap,
  };
};

export const replaceEntityEvidence = async ({ sql, tenantId, entityType, entityId, evidenceIds }) => {
  const normalizedEvidenceIds = [...new Set((evidenceIds || []).map((item) => cleanString(item)).filter(Boolean))];

  await sql`
    DELETE FROM entity_evidence
    WHERE tenant_id = ${tenantId}
      AND entity_type = ${entityType}
      AND entity_id = ${entityId}
  `;

  for (const evidenceId of normalizedEvidenceIds) {
    await sql`
      INSERT INTO entity_evidence (tenant_id, entity_type, entity_id, evidence_id)
      SELECT ${tenantId}, ${entityType}, ${entityId}, ${evidenceId}
      WHERE EXISTS (
        SELECT 1
        FROM evidence
        WHERE tenant_id = ${tenantId}
          AND id = ${evidenceId}
      )
      ON CONFLICT (tenant_id, entity_type, entity_id, evidence_id) DO NOTHING
    `;
  }

  return normalizedEvidenceIds;
};

export const fetchEntityEvidenceMap = async ({ sql, tenantId, entityType, entityIds }) => {
  const map = new Map();
  const normalizedIds = (entityIds || []).map((item) => cleanString(item)).filter(Boolean);
  if (normalizedIds.length === 0) {
    return map;
  }

  const rows = await sql`
    SELECT entity_id, evidence_id
    FROM entity_evidence
    WHERE tenant_id = ${tenantId}
      AND entity_type = ${entityType}
      AND entity_id = ANY(${normalizedIds})
    ORDER BY created_at ASC
  `;

  for (const row of rows) {
    if (!map.has(row.entity_id)) {
      map.set(row.entity_id, []);
    }
    map.get(row.entity_id).push(row.evidence_id);
  }

  return map;
};

export const parseYearFromRequest = (request) => {
  const url = new URL(request.url);
  return parseYear(url.searchParams.get("year"));
};

export const parseSiteYearQuery = (request) => {
  const url = new URL(request.url);
  return {
    companyId: cleanString(url.searchParams.get("companyId")),
    siteId: cleanString(url.searchParams.get("siteId")),
    reportingYear: parseYear(url.searchParams.get("year")),
  };
};

export const normalizeMetricDefinition = (definition) => ({
  key: definition.key,
  category: definition.category,
  label: definition.label,
  unit: definition.unit,
  description: definition.description,
  isRequired: Boolean(definition.isRequired),
  validation: definition.validation || null,
});

export const normalizeMetricRow = (row, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  siteId: row.site_id,
  reportingYear: Number(row.reporting_year),
  metricKey: row.metric_key,
  value: Number(row.value),
  unit: row.unit,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  evidenceIds,
});

export const upsertMetricRow = async ({ sql, tenantId, companyId, siteId, reportingYear, metricKey, value, unit }) => {
  const rows = await sql`
    INSERT INTO site_metrics (id, tenant_id, company_id, site_id, reporting_year, metric_key, value, unit)
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      ${metricKey},
      ${value},
      ${unit}
    )
    ON CONFLICT (tenant_id, site_id, reporting_year, metric_key) DO UPDATE
      SET
        company_id = EXCLUDED.company_id,
        value = EXCLUDED.value,
        unit = EXCLUDED.unit,
        updated_at = NOW()
    RETURNING id, tenant_id, company_id, site_id, reporting_year, metric_key, value, unit, created_at, updated_at
  `;

  return rows?.[0] || null;
};

export const getMetricRowsForSiteYear = async ({ sql, tenantId, siteId, reportingYear }) => {
  return sql`
    SELECT id, tenant_id, company_id, site_id, reporting_year, metric_key, value, unit, created_at, updated_at
    FROM site_metrics
    WHERE tenant_id = ${tenantId}
      AND site_id = ${siteId}
      AND reporting_year = ${reportingYear}
    ORDER BY metric_key ASC
  `;
};

export const getStrictWaterDischargeConfig = () => {
  const value = cleanString(process.env.WATER_DISCHARGE_HARD_ERROR).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
};

export const getFactorDefaults = () =>
  EMISSION_FACTOR_DEFINITIONS.map((item) => ({
    key: item.key,
    label: item.label,
    unit: item.unit,
    required: Boolean(item.required),
  }));

export const normalizeFactorRow = (row, required = false) => ({
  key: row.key,
  label: row.label,
  unit: row.unit,
  value: row.value == null ? null : Number(row.value),
  source: row.source,
  required,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const getFactorReferenceOptions = (factorKey) => {
  if (!factorKey || typeof factorKey !== "string") {
    return [];
  }
  const options = FACTOR_REFERENCE_OPTIONS_BY_KEY[factorKey];
  if (!Array.isArray(options)) {
    return [];
  }
  return options.map((item) => ({
    id: item.id,
    label: item.label,
    jurisdiction: item.jurisdiction || null,
    year: item.year || null,
    url: item.url,
    suggestedValue:
      typeof item.suggestedValue === "number" && Number.isFinite(item.suggestedValue) ? item.suggestedValue : null,
  }));
};

export const parseWorkforceRow = (row) => {
  const month = parseInteger(row.month);
  const reportingYear = parseYear(row.reportingYear ?? row.reporting_year);
  const headcount = parseInteger(row.headcount);
  const hoursWorked = parseNumber(row.hoursWorked ?? row.hours_worked);
  const contractType = cleanString(row.contractType ?? row.contract_type).toLowerCase();
  const gender = cleanString(row.gender).toUpperCase();

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "month must be between 1 and 12" };
  }
  if (!reportingYear) {
    return { error: "reportingYear is required" };
  }
  if (!["total", "permanent", "temporary"].includes(contractType)) {
    return { error: "contractType must be total/permanent/temporary" };
  }
  if (!["M", "F", "D"].includes(gender)) {
    return { error: "gender must be M/F/D" };
  }
  if (headcount == null || headcount < 0) {
    return { error: "headcount must be a non-negative integer" };
  }
  if (hoursWorked == null || hoursWorked < 0) {
    return { error: "hoursWorked must be a non-negative number" };
  }

  return {
    month,
    reportingYear,
    contractType,
    gender,
    headcount,
    hoursWorked,
  };
};

export const parseLeaverRow = (row) => {
  const month = parseInteger(row.month);
  const reportingYear = parseYear(row.reportingYear ?? row.reporting_year);
  const leavers = parseInteger(row.leavers);
  const gender = cleanString(row.gender).toUpperCase();

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "month must be between 1 and 12" };
  }
  if (!reportingYear) {
    return { error: "reportingYear is required" };
  }
  if (!["M", "F", "D"].includes(gender)) {
    return { error: "gender must be M/F/D" };
  }
  if (leavers == null || leavers < 0) {
    return { error: "leavers must be a non-negative integer" };
  }

  return {
    month,
    reportingYear,
    gender,
    leavers,
  };
};

export const parseManagementRow = (row) => {
  const reportingYear = parseYear(row.reportingYear ?? row.reporting_year);
  const headcount = parseInteger(row.headcount);
  const gender = cleanString(row.gender).toUpperCase();

  if (!reportingYear) {
    return { error: "reportingYear is required" };
  }
  if (!["M", "F", "D"].includes(gender)) {
    return { error: "gender must be M/F/D" };
  }
  if (headcount == null || headcount < 0) {
    return { error: "headcount must be a non-negative integer" };
  }

  return {
    reportingYear,
    gender,
    headcount,
  };
};

export const normalizeWorkforceRow = (row, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  siteId: row.site_id,
  reportingYear: Number(row.reporting_year),
  month: Number(row.month),
  contractType: row.contract_type,
  gender: row.gender,
  headcount: Number(row.headcount),
  hoursWorked: Number(row.hours_worked),
  evidenceIds,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const normalizeLeaverRow = (row, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  siteId: row.site_id,
  reportingYear: Number(row.reporting_year),
  month: Number(row.month),
  gender: row.gender,
  leavers: Number(row.leavers),
  evidenceIds,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const normalizeManagementRow = (row, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  siteId: row.site_id,
  reportingYear: Number(row.reporting_year),
  gender: row.gender,
  headcount: Number(row.headcount),
  evidenceIds,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

const emptyEnvironmentTotals = () => {
  const totals = {};
  for (const metric of METRIC_DEFINITIONS) {
    if (!metric.validation?.derived) {
      totals[metric.key] = 0;
    }
  }
  return totals;
};

const addMetricToTotals = (totals, metricKey, value) => {
  if (typeof totals[metricKey] !== "number") {
    totals[metricKey] = 0;
  }
  totals[metricKey] += Number(value || 0);
};

export const computeEnvironmentSummary = ({ companies, sites, metricRows }) => {
  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const siteMap = new Map(sites.map((site) => [site.id, site]));

  const siteTotalsMap = new Map();
  for (const site of sites) {
    siteTotalsMap.set(site.id, {
      siteId: site.id,
      companyId: site.company_id,
      name: site.name,
      totals: emptyEnvironmentTotals(),
      waterStressed: Boolean(site.water_stressed),
    });
  }

  for (const row of metricRows) {
    const siteTotals = siteTotalsMap.get(row.site_id);
    if (!siteTotals) {
      continue;
    }
    addMetricToTotals(siteTotals.totals, row.metric_key, Number(row.value));
  }

  const companyTotalsMap = new Map();
  for (const company of companies) {
    companyTotalsMap.set(company.id, {
      companyId: company.id,
      name: company.name,
      totals: emptyEnvironmentTotals(),
      sitesInWaterStressedAreas: 0,
    });
  }

  const tenantTotals = emptyEnvironmentTotals();
  let tenantWaterStressedSites = 0;

  for (const siteTotals of siteTotalsMap.values()) {
    const companyTotals = companyTotalsMap.get(siteTotals.companyId);
    if (!companyTotals) {
      continue;
    }

    for (const [metricKey, metricValue] of Object.entries(siteTotals.totals)) {
      addMetricToTotals(companyTotals.totals, metricKey, metricValue);
      addMetricToTotals(tenantTotals, metricKey, metricValue);
    }

    if (siteTotals.waterStressed) {
      companyTotals.sitesInWaterStressedAreas += 1;
      tenantWaterStressedSites += 1;
    }
  }

  const companiesResult = [];
  for (const companyTotals of companyTotalsMap.values()) {
    const company = companyMap.get(companyTotals.companyId);
    companiesResult.push({
      ...companyTotals,
      isHolding: Boolean(company?.is_holding),
    });
  }

  const sitesResult = [...siteTotalsMap.values()];

  return {
    tenantTotals,
    tenantDerived: {
      sites_in_water_stressed_areas: tenantWaterStressedSites,
    },
    companies: companiesResult,
    sites: sitesResult,
  };
};

const sumByGender = (rows, valueKey) => {
  let total = 0;
  let female = 0;
  for (const row of rows) {
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
  return roundNumber((numerator / denominator) * 100, 4);
};

export const computeSocialSummary = ({ companies, sites, workforceRows, leaverRows, managementRows, flagRows }) => {
  const siteBase = new Map();
  for (const site of sites) {
    siteBase.set(site.id, {
      siteId: site.id,
      companyId: site.company_id,
      name: site.name,
      totalEmployeesYearEnd: 0,
      permanentEmployeesYearEnd: 0,
      temporaryEmployeesYearEnd: 0,
      womenInWorkforcePct: 0,
      womenInManagementPct: 0,
      turnoverPct: 0,
      hoursWorkedTotal: 0,
    });
  }

  const workforceBySite = new Map();
  for (const row of workforceRows) {
    if (!workforceBySite.has(row.site_id)) {
      workforceBySite.set(row.site_id, []);
    }
    workforceBySite.get(row.site_id).push(row);
  }

  const leaversBySite = new Map();
  for (const row of leaverRows) {
    if (!leaversBySite.has(row.site_id)) {
      leaversBySite.set(row.site_id, []);
    }
    leaversBySite.get(row.site_id).push(row);
  }

  const managementBySite = new Map();
  for (const row of managementRows) {
    if (!managementBySite.has(row.site_id)) {
      managementBySite.set(row.site_id, []);
    }
    managementBySite.get(row.site_id).push(row);
  }

  for (const [siteId, siteSummary] of siteBase.entries()) {
    const workforce = workforceBySite.get(siteId) || [];
    const yearEndTotal = workforce.filter((row) => row.month === 12 && row.contract_type === "total");
    const yearEndPermanent = workforce.filter((row) => row.month === 12 && row.contract_type === "permanent");
    const yearEndTemporary = workforce.filter((row) => row.month === 12 && row.contract_type === "temporary");

    siteSummary.totalEmployeesYearEnd = sumByGender(yearEndTotal, "headcount").total;
    siteSummary.permanentEmployeesYearEnd = sumByGender(yearEndPermanent, "headcount").total;
    siteSummary.temporaryEmployeesYearEnd = sumByGender(yearEndTemporary, "headcount").total;

    const workforceGender = sumByGender(yearEndTotal, "headcount");
    siteSummary.womenInWorkforcePct = safePct(workforceGender.female, workforceGender.total);

    const management = managementBySite.get(siteId) || [];
    const managementGender = sumByGender(management, "headcount");
    siteSummary.womenInManagementPct = safePct(managementGender.female, managementGender.total);

    const monthlyTotals = new Map();
    for (const row of workforce) {
      if (row.contract_type !== "total") {
        continue;
      }
      if (!monthlyTotals.has(row.month)) {
        monthlyTotals.set(row.month, 0);
      }
      monthlyTotals.set(row.month, monthlyTotals.get(row.month) + Number(row.headcount || 0));
      siteSummary.hoursWorkedTotal += Number(row.hours_worked || 0);
    }

    const leavers = leaversBySite.get(siteId) || [];
    let leaversTotal = 0;
    for (const row of leavers) {
      leaversTotal += Number(row.leavers || 0);
    }

    const avgHeadcount = monthlyTotals.size
      ? [...monthlyTotals.values()].reduce((acc, value) => acc + value, 0) / monthlyTotals.size
      : 0;
    siteSummary.turnoverPct = safePct(leaversTotal, avgHeadcount);
  }

  const flagsByCompany = new Map();
  for (const row of flagRows || []) {
    flagsByCompany.set(row.company_id, {
      companyId: row.company_id,
      genderPayGapReported: Boolean(row.gender_pay_gap_reported),
      scope3ScreeningPerformed: Boolean(row.scope3_screening_performed),
    });
  }

  const companyMap = new Map();
  for (const company of companies) {
    companyMap.set(company.id, {
      companyId: company.id,
      name: company.name,
      totalEmployeesYearEnd: 0,
      permanentEmployeesYearEnd: 0,
      temporaryEmployeesYearEnd: 0,
      womenInWorkforcePct: 0,
      womenInManagementPct: 0,
      turnoverPct: 0,
      hoursWorkedTotal: 0,
      _workforceFemale: 0,
      _workforceTotal: 0,
      _managementFemale: 0,
      _managementTotal: 0,
      _leaversTotal: 0,
      _avgHeadcountNumerator: 0,
      _avgHeadcountDenominator: 0,
      flags: flagsByCompany.get(company.id) || {
        companyId: company.id,
        genderPayGapReported: false,
        scope3ScreeningPerformed: false,
      },
    });
  }

  const sitesResult = [];
  for (const summary of siteBase.values()) {
    sitesResult.push(summary);
    const companySummary = companyMap.get(summary.companyId);
    if (!companySummary) {
      continue;
    }

    companySummary.totalEmployeesYearEnd += summary.totalEmployeesYearEnd;
    companySummary.permanentEmployeesYearEnd += summary.permanentEmployeesYearEnd;
    companySummary.temporaryEmployeesYearEnd += summary.temporaryEmployeesYearEnd;
    companySummary.hoursWorkedTotal += summary.hoursWorkedTotal;

    const yearEndWorkforceRows = (workforceBySite.get(summary.siteId) || []).filter(
      (row) => row.month === 12 && row.contract_type === "total",
    );
    const workforceGender = sumByGender(yearEndWorkforceRows, "headcount");
    companySummary._workforceFemale += workforceGender.female;
    companySummary._workforceTotal += workforceGender.total;

    const managementRowsBySite = managementBySite.get(summary.siteId) || [];
    const managementGender = sumByGender(managementRowsBySite, "headcount");
    companySummary._managementFemale += managementGender.female;
    companySummary._managementTotal += managementGender.total;

    const leaversRowsBySite = leaversBySite.get(summary.siteId) || [];
    companySummary._leaversTotal += leaversRowsBySite.reduce((acc, row) => acc + Number(row.leavers || 0), 0);

    const monthlyTotals = new Map();
    for (const row of workforceBySite.get(summary.siteId) || []) {
      if (row.contract_type !== "total") {
        continue;
      }
      if (!monthlyTotals.has(row.month)) {
        monthlyTotals.set(row.month, 0);
      }
      monthlyTotals.set(row.month, monthlyTotals.get(row.month) + Number(row.headcount || 0));
    }

    companySummary._avgHeadcountNumerator += [...monthlyTotals.values()].reduce((acc, value) => acc + value, 0);
    companySummary._avgHeadcountDenominator += monthlyTotals.size;
  }

  const companiesResult = [];
  for (const item of companyMap.values()) {
    item.womenInWorkforcePct = safePct(item._workforceFemale, item._workforceTotal);
    item.womenInManagementPct = safePct(item._managementFemale, item._managementTotal);
    const avgHeadcount = item._avgHeadcountDenominator
      ? item._avgHeadcountNumerator / item._avgHeadcountDenominator
      : 0;
    item.turnoverPct = safePct(item._leaversTotal, avgHeadcount);

    delete item._workforceFemale;
    delete item._workforceTotal;
    delete item._managementFemale;
    delete item._managementTotal;
    delete item._leaversTotal;
    delete item._avgHeadcountNumerator;
    delete item._avgHeadcountDenominator;

    companiesResult.push(item);
  }

  const tenantTotals = {
    totalEmployeesYearEnd: companiesResult.reduce((acc, item) => acc + item.totalEmployeesYearEnd, 0),
    permanentEmployeesYearEnd: companiesResult.reduce((acc, item) => acc + item.permanentEmployeesYearEnd, 0),
    temporaryEmployeesYearEnd: companiesResult.reduce((acc, item) => acc + item.temporaryEmployeesYearEnd, 0),
    womenInWorkforcePct: safePct(
      companiesResult.reduce((acc, item) => acc + item.totalEmployeesYearEnd * (item.womenInWorkforcePct / 100), 0),
      companiesResult.reduce((acc, item) => acc + item.totalEmployeesYearEnd, 0),
    ),
    womenInManagementPct: safePct(
      companiesResult.reduce((acc, item) => {
        const weight = item.totalEmployeesYearEnd || 0;
        return acc + weight * (item.womenInManagementPct / 100);
      }, 0),
      companiesResult.reduce((acc, item) => acc + (item.totalEmployeesYearEnd || 0), 0),
    ),
    turnoverPct: safePct(
      companiesResult.reduce((acc, item) => {
        const weight = item.totalEmployeesYearEnd || 0;
        return acc + weight * (item.turnoverPct / 100);
      }, 0),
      companiesResult.reduce((acc, item) => acc + (item.totalEmployeesYearEnd || 0), 0),
    ),
    hoursWorkedTotal: companiesResult.reduce((acc, item) => acc + item.hoursWorkedTotal, 0),
  };

  return {
    tenantTotals,
    companies: companiesResult,
    sites: sitesResult,
  };
};

export const computeEmissionSummary = ({ factorsByKey, metricRows, sites, companies }) => {
  const requiredKeys = EMISSION_FACTOR_DEFINITIONS.filter((item) => item.required).map((item) => item.key);
  const missingFactors = [];
  for (const factorKey of requiredKeys) {
    if (factorsByKey.get(factorKey) == null) {
      missingFactors.push(factorKey);
    }
  }

  const siteMetricMap = new Map();
  for (const site of sites) {
    siteMetricMap.set(site.id, {
      electricity_kwh: 0,
      renewable_electricity_kwh: 0,
      natural_gas_mwh: 0,
      diesel_liters: 0,
      gasoline_liters: 0,
      refrigerant_leakage_kg: 0,
    });
  }

  for (const row of metricRows) {
    if (!siteMetricMap.has(row.site_id)) {
      continue;
    }
    if (row.metric_key in siteMetricMap.get(row.site_id)) {
      siteMetricMap.get(row.site_id)[row.metric_key] = Number(row.value || 0);
    }
  }

  const locationFactor = factorsByKey.get("ef_scope2_location_kgco2e_per_kwh");
  const marketFactor = factorsByKey.get("ef_scope2_market_kgco2e_per_kwh");
  const marketFallbackToLocation = marketFactor == null && locationFactor != null;

  if (marketFactor == null) {
    missingFactors.push("ef_scope2_market_kgco2e_per_kwh");
  }

  const factorForMarket = marketFactor == null ? locationFactor : marketFactor;

  const companyMap = new Map();
  for (const company of companies) {
    companyMap.set(company.id, {
      companyId: company.id,
      name: company.name,
      scope1Tco2e: 0,
      scope2LocationTco2e: 0,
      scope2MarketTco2e: 0,
      breakdown: {
        naturalGasTco2e: 0,
        dieselTco2e: 0,
        gasolineTco2e: 0,
        refrigerantTco2e: 0,
        electricityLocationTco2e: 0,
        electricityMarketTco2e: 0,
      },
    });
  }

  const sitesResult = [];
  for (const site of sites) {
    const metrics = siteMetricMap.get(site.id) || {
      electricity_kwh: 0,
      renewable_electricity_kwh: 0,
      natural_gas_mwh: 0,
      diesel_liters: 0,
      gasoline_liters: 0,
      refrigerant_leakage_kg: 0,
    };

    const naturalGasKg = metrics.natural_gas_mwh * (factorsByKey.get("ef_natural_gas_kgco2e_per_mwh") || 0);
    const dieselKg = metrics.diesel_liters * (factorsByKey.get("ef_diesel_kgco2e_per_liter") || 0);
    const gasolineKg = metrics.gasoline_liters * (factorsByKey.get("ef_gasoline_kgco2e_per_liter") || 0);
    const refrigerantKg =
      metrics.refrigerant_leakage_kg * (factorsByKey.get("ef_refrigerant_kgco2e_per_kg") || 0);

    const scope1Tco2e = roundNumber((naturalGasKg + dieselKg + gasolineKg + refrigerantKg) / 1000, 6);
    const scope2LocationTco2e = roundNumber((metrics.electricity_kwh * (locationFactor || 0)) / 1000, 6);

    const marketElectricityKwh = Math.max(metrics.electricity_kwh - metrics.renewable_electricity_kwh, 0);
    const scope2MarketTco2e = roundNumber((marketElectricityKwh * (factorForMarket || 0)) / 1000, 6);

    const siteResult = {
      siteId: site.id,
      companyId: site.company_id,
      name: site.name,
      scope1Tco2e,
      scope2LocationTco2e,
      scope2MarketTco2e,
      breakdown: {
        naturalGasTco2e: roundNumber(naturalGasKg / 1000, 6),
        dieselTco2e: roundNumber(dieselKg / 1000, 6),
        gasolineTco2e: roundNumber(gasolineKg / 1000, 6),
        refrigerantTco2e: roundNumber(refrigerantKg / 1000, 6),
        electricityLocationTco2e: scope2LocationTco2e,
        electricityMarketTco2e: scope2MarketTco2e,
      },
    };

    sitesResult.push(siteResult);

    const companyResult = companyMap.get(site.company_id);
    if (companyResult) {
      companyResult.scope1Tco2e += scope1Tco2e;
      companyResult.scope2LocationTco2e += scope2LocationTco2e;
      companyResult.scope2MarketTco2e += scope2MarketTco2e;
      companyResult.breakdown.naturalGasTco2e += siteResult.breakdown.naturalGasTco2e;
      companyResult.breakdown.dieselTco2e += siteResult.breakdown.dieselTco2e;
      companyResult.breakdown.gasolineTco2e += siteResult.breakdown.gasolineTco2e;
      companyResult.breakdown.refrigerantTco2e += siteResult.breakdown.refrigerantTco2e;
      companyResult.breakdown.electricityLocationTco2e += siteResult.breakdown.electricityLocationTco2e;
      companyResult.breakdown.electricityMarketTco2e += siteResult.breakdown.electricityMarketTco2e;
    }
  }

  const companiesResult = [...companyMap.values()].map((item) => ({
    ...item,
    scope1Tco2e: roundNumber(item.scope1Tco2e, 6),
    scope2LocationTco2e: roundNumber(item.scope2LocationTco2e, 6),
    scope2MarketTco2e: roundNumber(item.scope2MarketTco2e, 6),
    breakdown: {
      naturalGasTco2e: roundNumber(item.breakdown.naturalGasTco2e, 6),
      dieselTco2e: roundNumber(item.breakdown.dieselTco2e, 6),
      gasolineTco2e: roundNumber(item.breakdown.gasolineTco2e, 6),
      refrigerantTco2e: roundNumber(item.breakdown.refrigerantTco2e, 6),
      electricityLocationTco2e: roundNumber(item.breakdown.electricityLocationTco2e, 6),
      electricityMarketTco2e: roundNumber(item.breakdown.electricityMarketTco2e, 6),
    },
  }));

  const tenantTotals = {
    scope1Tco2e: roundNumber(companiesResult.reduce((acc, item) => acc + item.scope1Tco2e, 0), 6),
    scope2LocationTco2e: roundNumber(companiesResult.reduce((acc, item) => acc + item.scope2LocationTco2e, 0), 6),
    scope2MarketTco2e: roundNumber(companiesResult.reduce((acc, item) => acc + item.scope2MarketTco2e, 0), 6),
    breakdown: {
      naturalGasTco2e: roundNumber(
        companiesResult.reduce((acc, item) => acc + item.breakdown.naturalGasTco2e, 0),
        6,
      ),
      dieselTco2e: roundNumber(companiesResult.reduce((acc, item) => acc + item.breakdown.dieselTco2e, 0), 6),
      gasolineTco2e: roundNumber(
        companiesResult.reduce((acc, item) => acc + item.breakdown.gasolineTco2e, 0),
        6,
      ),
      refrigerantTco2e: roundNumber(
        companiesResult.reduce((acc, item) => acc + item.breakdown.refrigerantTco2e, 0),
        6,
      ),
      electricityLocationTco2e: roundNumber(
        companiesResult.reduce((acc, item) => acc + item.breakdown.electricityLocationTco2e, 0),
        6,
      ),
      electricityMarketTco2e: roundNumber(
        companiesResult.reduce((acc, item) => acc + item.breakdown.electricityMarketTco2e, 0),
        6,
      ),
    },
  };

  return {
    ok: missingFactors.filter((item, index, source) => source.indexOf(item) === index).length === 0,
    missingFactors: missingFactors.filter((item, index, source) => source.indexOf(item) === index),
    warnings: marketFallbackToLocation
      ? ["ef_scope2_market_kgco2e_per_kwh missing: using location factor fallback"]
      : [],
    tenantTotals,
    companies: companiesResult,
    sites: sitesResult,
  };
};
