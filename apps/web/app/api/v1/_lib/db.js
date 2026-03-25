import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { EMISSION_FACTOR_DEFINITIONS, METRIC_DEFINITIONS } from "./esg-domain.js";
import { ESG_PARAMETER_DEFINITIONS } from "./esg-parameters.js";
import { GHG_ACTIVITY_BASELINE, GHG_FACTOR_LIBRARY_STARTER_ROWS, SOCIAL_METRIC_BASELINE } from "./ghg-catalog.js";

const SCHEMA_READY_KEY = "__esg_rdt_jobs_schema_ready__";
const SCHEMA_PROMISE_KEY = "__esg_rdt_jobs_schema_promise__";
const ENTERPRISE_SCHEMA_READY_KEY = "__esg_rdt_enterprise_schema_ready__";
const ENTERPRISE_SCHEMA_PROMISE_KEY = "__esg_rdt_enterprise_schema_promise__";
const SOCIAL_SCHEMA_READY_KEY = "__esg_rdt_social_schema_ready__";
const SOCIAL_SCHEMA_PROMISE_KEY = "__esg_rdt_social_schema_promise__";
const GOVERNANCE_SCHEMA_READY_KEY = "__esg_rdt_governance_schema_ready__";
const GOVERNANCE_SCHEMA_PROMISE_KEY = "__esg_rdt_governance_schema_promise__";
const ASSESSMENT_SCHEMA_READY_KEY = "__esg_rdt_assessment_schema_ready__";
const ASSESSMENT_SCHEMA_PROMISE_KEY = "__esg_rdt_assessment_schema_promise__";
const ECOVADIS_SCHEMA_READY_KEY = "__esg_rdt_ecovadis_schema_ready__";
const ECOVADIS_SCHEMA_PROMISE_KEY = "__esg_rdt_ecovadis_schema_promise__";
const MATERIALITY_SCHEMA_READY_KEY = "__esg_rdt_materiality_schema_ready__";
const MATERIALITY_SCHEMA_PROMISE_KEY = "__esg_rdt_materiality_schema_promise__";
const STANDARDS_SCHEMA_READY_KEY = "__esg_rdt_standards_schema_ready__";
const STANDARDS_SCHEMA_PROMISE_KEY = "__esg_rdt_standards_schema_promise__";
const PLATFORM_SCHEMA_READY_KEY = "__esg_rdt_platform_schema_ready__";
const PLATFORM_SCHEMA_PROMISE_KEY = "__esg_rdt_platform_schema_promise__";
const STORAGE_SCHEMA_READY_KEY = "__esg_rdt_storage_schema_ready__";
const STORAGE_SCHEMA_PROMISE_KEY = "__esg_rdt_storage_schema_promise__";
const METRICS_SCHEMA_PROMISE_KEY = "__esg_rdt_metrics_schema_promise__";
const GHG_SCHEMA_READY_KEY = "__esg_rdt_ghg_schema_ready__";
const GHG_SCHEMA_PROMISE_KEY = "__esg_rdt_ghg_schema_promise__";

const LEGACY_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_MODULES = {};
const FACTOR_LIBRARY_ROWS = [
  {
    library: "IPCC",
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "IEA / national inventory location-based electricity factor",
    sourceUrl: "https://www.iea.org/data-and-statistics/data-tools/emissions-factors",
    notes: "Use your national inventory or TSO publication for site-specific country values.",
  },
  {
    library: "IPCC",
    key: "ef_scope2_market_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "Supplier-specific residual mix or contractual instruments",
    sourceUrl: "https://www.iea.org/data-and-statistics/data-tools/emissions-factors",
    notes: "Manual verification required for market-based electricity reporting.",
  },
  {
    library: "IPCC",
    key: "ef_natural_gas_kgco2e_per_mwh",
    unit: "kgCO2e/MWh",
    value: 202.0,
    sourceLabel: "IPCC generic combustion default",
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
    notes: "Reference value for stationary combustion of natural gas.",
  },
  {
    library: "IPCC",
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.68,
    sourceLabel: "IPCC generic combustion default",
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
    notes: "Reference value for diesel fuel combustion.",
  },
  {
    library: "IPCC",
    key: "ef_gasoline_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.31,
    sourceLabel: "IPCC generic combustion default",
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
    notes: "Reference value for gasoline combustion.",
  },
  {
    library: "IPCC",
    key: "ef_refrigerant_kgco2e_per_kg",
    unit: "kgCO2e/kg",
    value: null,
    sourceLabel: "IPCC AR6 GWP100 table",
    sourceUrl: "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_AnnexVII.pdf",
    notes: "Select refrigerant type to derive factor from GWP100.",
  },
  {
    library: "DEFRA",
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "UK DEFRA electricity factors (location-based)",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
    notes: "Manual verification required for non-UK countries.",
  },
  {
    library: "DEFRA",
    key: "ef_scope2_market_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "UK DEFRA electricity factors (market-based)",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
    notes: "Manual verification required for market-based method.",
  },
  {
    library: "DEFRA",
    key: "ef_natural_gas_kgco2e_per_mwh",
    unit: "kgCO2e/MWh",
    value: 183.16,
    sourceLabel: "UK DEFRA conversion factors",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
    notes: "Natural gas combustion default derived from DEFRA company reporting factors.",
  },
  {
    library: "DEFRA",
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.68,
    sourceLabel: "UK DEFRA conversion factors",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
    notes: "Diesel combustion default derived from DEFRA company reporting factors.",
  },
  {
    library: "DEFRA",
    key: "ef_gasoline_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.31,
    sourceLabel: "UK DEFRA conversion factors",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
    notes: "Gasoline combustion default derived from DEFRA company reporting factors.",
  },
  {
    library: "DEFRA",
    key: "ef_refrigerant_kgco2e_per_kg",
    unit: "kgCO2e/kg",
    value: null,
    sourceLabel: "IPCC AR6 GWP100 table",
    sourceUrl: "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_AnnexVII.pdf",
    notes: "Select refrigerant type to derive factor from GWP100.",
  },
  {
    library: "EPA",
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "EPA eGRID electricity factors",
    sourceUrl: "https://www.epa.gov/egrid",
    notes: "Use region-specific eGRID or national inventory values.",
  },
  {
    library: "EPA",
    key: "ef_scope2_market_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "EPA market-based electricity guidance",
    sourceUrl: "https://www.epa.gov/egrid",
    notes: "Manual verification required for contractual instruments.",
  },
  {
    library: "EPA",
    key: "ef_natural_gas_kgco2e_per_mwh",
    unit: "kgCO2e/MWh",
    value: 181.7,
    sourceLabel: "EPA stationary combustion factors",
    sourceUrl: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
    notes: "US-oriented default value.",
  },
  {
    library: "EPA",
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.68,
    sourceLabel: "EPA stationary combustion factors",
    sourceUrl: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
    notes: "US-oriented default value.",
  },
  {
    library: "EPA",
    key: "ef_gasoline_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.31,
    sourceLabel: "EPA stationary combustion factors",
    sourceUrl: "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
    notes: "US-oriented default value.",
  },
  {
    library: "EPA",
    key: "ef_refrigerant_kgco2e_per_kg",
    unit: "kgCO2e/kg",
    value: null,
    sourceLabel: "IPCC AR6 GWP100 table",
    sourceUrl: "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_AnnexVII.pdf",
    notes: "Select refrigerant type to derive factor from GWP100.",
  },
  {
    library: "CUSTOM",
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "electricityMap country intensity reference",
    sourceUrl: "https://www.electricitymaps.com/data-portal",
    notes: "API key may be required. Manual entry/verification required.",
  },
  {
    library: "CUSTOM",
    key: "ef_scope2_market_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: null,
    sourceLabel: "Supplier-specific market-based reference",
    sourceUrl: "https://www.electricitymaps.com/data-portal",
    notes: "Manual verification required for contractual instruments.",
  },
  {
    library: "CUSTOM",
    key: "ef_natural_gas_kgco2e_per_mwh",
    unit: "kgCO2e/MWh",
    value: null,
    sourceLabel: "Custom source required",
    sourceUrl: "https://www.ghgprotocol.org/scope-2-guidance",
    notes: "Manual value required.",
  },
  {
    library: "CUSTOM",
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: null,
    sourceLabel: "Custom source required",
    sourceUrl: "https://www.ghgprotocol.org/scope-2-guidance",
    notes: "Manual value required.",
  },
  {
    library: "CUSTOM",
    key: "ef_gasoline_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: null,
    sourceLabel: "Custom source required",
    sourceUrl: "https://www.ghgprotocol.org/scope-2-guidance",
    notes: "Manual value required.",
  },
  {
    library: "CUSTOM",
    key: "ef_refrigerant_kgco2e_per_kg",
    unit: "kgCO2e/kg",
    value: null,
    sourceLabel: "IPCC AR6 GWP100 table",
    sourceUrl: "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_AnnexVII.pdf",
    notes: "Select refrigerant type to derive factor from GWP100.",
  },
  ...GHG_FACTOR_LIBRARY_STARTER_ROWS,
];

const GOVERNANCE_FIELD_BASELINE = [
  { key: "board_total", label: "Board total members", fieldType: "number", unit: "count" },
  { key: "board_women", label: "Women on board", fieldType: "number", unit: "count" },
  { key: "board_independent", label: "Independent board members", fieldType: "number", unit: "count" },
  { key: "board_meetings", label: "Board meetings", fieldType: "number", unit: "count" },
  { key: "anti_corruption_policy", label: "Anti-corruption policy", fieldType: "boolean", unit: "boolean" },
  { key: "whistleblowing_channel", label: "Whistleblowing channel", fieldType: "boolean", unit: "boolean" },
  { key: "data_privacy_policy", label: "Data privacy policy", fieldType: "boolean", unit: "boolean" },
  { key: "supplier_code_of_conduct", label: "Supplier code of conduct", fieldType: "boolean", unit: "boolean" },
  { key: "gdpr_training", label: "GDPR training", fieldType: "boolean", unit: "boolean" },
  { key: "data_breaches_count", label: "Data breaches", fieldType: "number", unit: "count" },
  { key: "corruption_incidents_count", label: "Corruption incidents", fieldType: "number", unit: "count" },
  { key: "fines_amount_eur", label: "Fines amount", fieldType: "number", unit: "EUR" },
  { key: "policy_anti_corruption", label: "Policy: anti-corruption", fieldType: "select", unit: "status" },
  { key: "policy_whistleblowing", label: "Policy: whistleblowing", fieldType: "select", unit: "status" },
  { key: "policy_data_privacy", label: "Policy: data privacy", fieldType: "select", unit: "status" },
  { key: "policy_supplier_code", label: "Policy: supplier code", fieldType: "select", unit: "status" },
  { key: "policy_grievance_mechanism", label: "Policy: grievance mechanism", fieldType: "select", unit: "status" },
];

let cachedSql = null;

const getDatabaseUrl = () => {
  const value = process.env.DATABASE_URL;
  if (!value || !value.trim()) {
    throw new Error("Missing DATABASE_URL");
  }
  return value.trim();
};

export const getSql = () => {
  if (!cachedSql) {
    cachedSql = neon(getDatabaseUrl());
  }
  return cachedSql;
};

const normalizeHoldingCompanyName = (value) => {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || "Holding";
};

export const ensureHoldingCompanyForTenant = async (sql, tenantId, tenantName = "Holding") => {
  const existingRows = await sql`
    SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    FROM companies
    WHERE tenant_id = ${tenantId} AND is_holding = TRUE
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (existingRows?.[0]) {
    return existingRows[0];
  }

  const preferredName = normalizeHoldingCompanyName(tenantName);
  const candidateNames = [...new Set([preferredName, "Holding", `${preferredName} Holding`])];

  for (const candidateName of candidateNames) {
    const rows = await sql`
      INSERT INTO companies (id, tenant_id, name, legal_name, country, is_holding)
      VALUES (${randomUUID()}, ${tenantId}, ${candidateName}, NULL, NULL, TRUE)
      ON CONFLICT (tenant_id, name) DO NOTHING
      RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    `;
    if (rows?.[0]) {
      return rows[0];
    }
  }

  const fallbackRows = await sql`
    UPDATE companies
    SET is_holding = TRUE, updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM companies
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
  `;
  if (fallbackRows?.[0]) {
    return fallbackRows[0];
  }

  const insertedRows = await sql`
    INSERT INTO companies (id, tenant_id, name, legal_name, country, is_holding)
    VALUES (${randomUUID()}, ${tenantId}, 'Holding', NULL, NULL, TRUE)
    RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
  `;
  return insertedRows?.[0] || null;
};

export const ensureDefaultEmissionFactorsForTenant = async (sql, tenantId) => {
  const base = EMISSION_FACTOR_DEFINITIONS.map((item) => ({ key: item.key, unit: item.unit }));
  const library = FACTOR_LIBRARY_ROWS.map((item) => ({ key: item.key, unit: item.unit }));
  await ensureFactorKeysForTenant(sql, tenantId, [...base, ...library]);
};

export const seedDefaultMetricDefinitions = async (sql) => {
  for (const definition of METRIC_DEFINITIONS) {
    await sql`
      INSERT INTO metric_definitions (
        key,
        tenant_id,
        category,
        label,
        unit,
        description,
        is_required,
        validation,
        is_system,
        is_active,
        deleted_at,
        updated_at
      )
      VALUES (
        ${definition.key},
        NULL,
        ${definition.category},
        ${definition.label},
        ${definition.unit},
        ${definition.description || null},
        ${Boolean(definition.isRequired)},
        ${JSON.stringify(definition.validation || null)},
        TRUE,
        TRUE,
        NULL,
        NOW()
      )
      ON CONFLICT (key) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        category = EXCLUDED.category,
        label = EXCLUDED.label,
        unit = EXCLUDED.unit,
        description = EXCLUDED.description,
        is_required = EXCLUDED.is_required,
        validation = EXCLUDED.validation,
        is_system = TRUE,
        is_active = TRUE,
        deleted_at = NULL,
        updated_at = NOW()
    `;
  }
};

const factorLabelFromKey = (key) => {
  const cleaned = String(key || "")
    .replace(/^ef_/, "")
    .replace(/_/g, " ")
    .trim();
  if (!cleaned) {
    return "Factor";
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const ensureFactorKeysForTenant = async (sql, tenantId, factorSeeds = []) => {
  for (const seed of factorSeeds) {
    const key = typeof seed?.key === "string" ? seed.key.trim() : "";
    const unit = typeof seed?.unit === "string" ? seed.unit.trim() : "";
    if (!key || !unit) {
      continue;
    }

    await sql`
      INSERT INTO emission_factors (tenant_id, key, label, unit, value, source, source_label, source_url)
      VALUES (${tenantId}, ${key}, ${factorLabelFromKey(key)}, ${unit}, NULL, NULL, NULL, NULL)
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        label = EXCLUDED.label,
        unit = EXCLUDED.unit
    `;
  }
};

export const seedGhgActivityDefinitionsForTenant = async (sql, tenantId) => {
  for (const item of GHG_ACTIVITY_BASELINE) {
    await sql`
      INSERT INTO ghg_activity_definitions (
        id,
        tenant_id,
        scope,
        scope3_category,
        key,
        name,
        group_key,
        sub_group,
        method,
        unit,
        requires_factor,
        default_factor_key,
        input_schema,
        sdgs,
        evidence_required,
        is_system,
        is_active,
        deleted_at,
        sort_order,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${item.scope},
        ${item.scope3Category ?? null},
        ${item.key},
        ${item.name},
        ${item.groupKey || "GHG"},
        ${item.subGroup || null},
        ${item.method},
        ${item.unit},
        ${Boolean(item.requiresFactor)},
        ${item.defaultFactorKey || null},
        ${JSON.stringify(item.inputSchema || {})}::jsonb,
        ${JSON.stringify(item.sdgs || [])}::jsonb,
        ${Boolean(item.evidenceRequired)},
        TRUE,
        ${item.isActive !== false},
        NULL,
        ${Number(item.sortOrder || 0)},
        NOW()
      )
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        scope = EXCLUDED.scope,
        scope3_category = EXCLUDED.scope3_category,
        name = EXCLUDED.name,
        group_key = EXCLUDED.group_key,
        sub_group = EXCLUDED.sub_group,
        method = EXCLUDED.method,
        unit = EXCLUDED.unit,
        requires_factor = EXCLUDED.requires_factor,
        default_factor_key = EXCLUDED.default_factor_key,
        input_schema = EXCLUDED.input_schema,
        sdgs = EXCLUDED.sdgs,
        evidence_required = EXCLUDED.evidence_required,
        is_system = TRUE,
        is_active = EXCLUDED.is_active,
        deleted_at = NULL,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `;
  }
};

export const seedSocialMetricDefinitionsForTenant = async (sql, tenantId) => {
  for (const metric of SOCIAL_METRIC_BASELINE) {
    await sql`
      INSERT INTO social_metric_definitions (
        id,
        tenant_id,
        key,
        name,
        group_key,
        unit,
        method,
        input_schema,
        formula,
        sdgs,
        evidence_required,
        is_system,
        is_active,
        deleted_at,
        sort_order,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${metric.key},
        ${metric.name},
        ${metric.groupKey || "S"},
        ${metric.unit},
        ${metric.method},
        ${JSON.stringify(metric.inputSchema || {})}::jsonb,
        ${JSON.stringify(metric.formula || null)}::jsonb,
        ${JSON.stringify(metric.sdgs || [])}::jsonb,
        ${Boolean(metric.evidenceRequired)},
        TRUE,
        ${metric.isActive !== false},
        NULL,
        ${Number(metric.sortOrder || 0)},
        NOW()
      )
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        name = EXCLUDED.name,
        group_key = EXCLUDED.group_key,
        unit = EXCLUDED.unit,
        method = EXCLUDED.method,
        input_schema = EXCLUDED.input_schema,
        formula = EXCLUDED.formula,
        sdgs = EXCLUDED.sdgs,
        evidence_required = EXCLUDED.evidence_required,
        is_system = TRUE,
        is_active = EXCLUDED.is_active,
        deleted_at = NULL,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `;
  }
};

export const seedGovernanceFieldDefinitionsForTenant = async (sql, tenantId) => {
  for (const field of GOVERNANCE_FIELD_BASELINE) {
    const fieldType = ["boolean", "number", "text", "select"].includes(field.fieldType) ? field.fieldType : "text";
    await sql`
      INSERT INTO governance_field_definitions (
        id,
        tenant_id,
        key,
        label,
        field_type,
        unit,
        options,
        sdgs,
        evidence_required,
        is_system,
        is_active,
        deleted_at,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${field.key},
        ${field.label},
        ${fieldType},
        ${field.unit || null},
        ${JSON.stringify(fieldType === "select" ? ["yes", "no", "in_progress"] : [])}::jsonb,
        '[]'::jsonb,
        FALSE,
        TRUE,
        TRUE,
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        label = EXCLUDED.label,
        field_type = EXCLUDED.field_type,
        unit = EXCLUDED.unit,
        options = EXCLUDED.options,
        is_system = TRUE,
        is_active = TRUE,
        deleted_at = NULL,
        updated_at = NOW()
    `;
  }
};

export const seedEmissionFactorLibrary = async (sql) => {
  for (const row of FACTOR_LIBRARY_ROWS) {
    const country = typeof row.country === "string" && row.country.trim() ? row.country.trim().toUpperCase() : null;
    const reportingYear = Number.isInteger(row.reportingYear)
      ? row.reportingYear
      : Number.isInteger(row.year)
        ? row.year
        : null;
    const scope = typeof row.scope === "string" ? row.scope : null;
    const scope3Category = Number.isInteger(row.scope3Category) ? row.scope3Category : null;
    const method = typeof row.method === "string" ? row.method : null;
    const spendCategory = typeof row.spendCategory === "string" && row.spendCategory.trim() ? row.spendCategory.trim() : null;
    const transportMode = typeof row.transportMode === "string" && row.transportMode.trim() ? row.transportMode.trim() : null;
    const refrigerantType =
      typeof row.refrigerantType === "string" && row.refrigerantType.trim() ? row.refrigerantType.trim().toUpperCase() : null;
    const region = typeof row.region === "string" && row.region.trim() ? row.region.trim() : null;

    await sql`
      INSERT INTO emission_factor_library (
        library,
        country,
        reporting_year,
        year,
        country_key,
        reporting_year_key,
        key,
        unit,
        value,
        scope,
        scope3_category,
        method,
        spend_category,
        transport_mode,
        refrigerant_type,
        region,
        source_label,
        source_url,
        notes
      )
      VALUES (
        ${row.library},
        ${country},
        ${reportingYear},
        ${reportingYear},
        ${country || ""},
        ${reportingYear ?? -1},
        ${row.key},
        ${row.unit},
        ${row.value},
        ${scope},
        ${scope3Category},
        ${method},
        ${spendCategory},
        ${transportMode},
        ${refrigerantType},
        ${region},
        ${row.sourceLabel},
        ${row.sourceUrl},
        ${row.notes || null}
      )
      ON CONFLICT (library, country_key, reporting_year_key, key) DO UPDATE
        SET
          country = EXCLUDED.country,
          reporting_year = EXCLUDED.reporting_year,
          year = EXCLUDED.year,
          unit = EXCLUDED.unit,
          value = EXCLUDED.value,
          scope = EXCLUDED.scope,
          scope3_category = EXCLUDED.scope3_category,
          method = EXCLUDED.method,
          spend_category = EXCLUDED.spend_category,
          transport_mode = EXCLUDED.transport_mode,
          refrigerant_type = EXCLUDED.refrigerant_type,
          region = EXCLUDED.region,
          source_label = EXCLUDED.source_label,
          source_url = EXCLUDED.source_url,
          notes = EXCLUDED.notes
    `;
  }
};

export const ensureSchema = async () => {
  if (globalThis[SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[SCHEMA_PROMISE_KEY]) {
    globalThis[SCHEMA_PROMISE_KEY] = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          status TEXT NOT NULL,
          input JSONB NOT NULL DEFAULT '{}'::jsonb,
          output JSONB NULL,
          error TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ NULL,
          finished_at TIMESTAMPTZ NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC)`;
      globalThis[SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[SCHEMA_PROMISE_KEY];
};

export const ensureEnterpriseSchema = async () => {
  if (globalThis[ENTERPRISE_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY]) {
    globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS tenants (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT 'none'`;
      await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_status TEXT NOT NULL DEFAULT 'active'`;
      await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL`;
      await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS internal_notes TEXT NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS memberships (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, tenant_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS sites (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS companies (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          legal_name TEXT NULL,
          country TEXT NULL,
          is_holding BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS company_id UUID NULL`;
      await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS water_stressed BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE sites ALTER COLUMN country DROP NOT NULL`;
      await sql`ALTER TABLE sites ALTER COLUMN country DROP DEFAULT`;

      await sql`
        CREATE TABLE IF NOT EXISTS entity_evidence (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL,
          entity_id UUID NOT NULL,
          evidence_id UUID NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, entity_type, entity_id, evidence_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS metric_definitions (
          key TEXT PRIMARY KEY,
          tenant_id UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          unit TEXT NOT NULL,
          description TEXT NULL,
          is_required BOOLEAN NOT NULL DEFAULT FALSE,
          validation JSONB NULL,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          deleted_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS tenant_id UUID NULL REFERENCES tenants(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

      await sql`
        CREATE TABLE IF NOT EXISTS site_metrics (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          metric_key TEXT NOT NULL REFERENCES metric_definitions(key) ON DELETE RESTRICT,
          value NUMERIC NOT NULL,
          unit TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS workforce_monthly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
          contract_type TEXT NOT NULL CHECK (contract_type IN ('total', 'permanent', 'temporary')),
          gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'D')),
          headcount INTEGER NOT NULL CHECK (headcount >= 0),
          hours_worked NUMERIC NOT NULL CHECK (hours_worked >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, site_id, reporting_year, month, contract_type, gender)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS workforce_leavers_monthly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
          gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'D')),
          leavers INTEGER NOT NULL CHECK (leavers >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, site_id, reporting_year, month, gender)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS management_headcount_yearly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'D')),
          headcount INTEGER NOT NULL CHECK (headcount >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, site_id, reporting_year, gender)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS company_year_flags (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          gender_pay_gap_reported BOOLEAN NOT NULL DEFAULT FALSE,
          scope3_screening_performed BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, reporting_year)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS emission_factors (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          unit TEXT NOT NULL,
          value NUMERIC NULL,
          source TEXT NULL,
          source_label TEXT NULL,
          source_url TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, key)
        )
      `;
      await sql`ALTER TABLE emission_factors ADD COLUMN IF NOT EXISTS source_label TEXT NULL`;
      await sql`ALTER TABLE emission_factors ADD COLUMN IF NOT EXISTS source_url TEXT NULL`;
      await sql`
        UPDATE emission_factors
        SET source_label = source
        WHERE source IS NOT NULL
          AND (source_label IS NULL OR source_label = '')
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS emission_factor_country_overrides (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          country TEXT NOT NULL,
          reporting_year INTEGER NOT NULL,
          key TEXT NOT NULL,
          value NUMERIC NOT NULL,
          unit TEXT NOT NULL,
          source_label TEXT NULL,
          source_url TEXT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, country, reporting_year, key)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS emission_factor_library (
          library TEXT NOT NULL,
          country TEXT NULL,
          reporting_year INTEGER NULL,
          year INTEGER NULL,
          country_key TEXT NOT NULL DEFAULT '',
          reporting_year_key INTEGER NOT NULL DEFAULT -1,
          key TEXT NOT NULL,
          unit TEXT NOT NULL,
          value NUMERIC NULL,
          scope TEXT NULL,
          scope3_category INTEGER NULL,
          method TEXT NULL,
          spend_category TEXT NULL,
          transport_mode TEXT NULL,
          refrigerant_type TEXT NULL,
          region TEXT NULL,
          source_label TEXT NOT NULL,
          source_url TEXT NOT NULL,
          notes TEXT NULL,
          PRIMARY KEY (library, country_key, reporting_year_key, key)
        )
      `;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS country TEXT NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS reporting_year INTEGER NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS year INTEGER NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS country_key TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS reporting_year_key INTEGER NOT NULL DEFAULT -1`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS scope TEXT NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS scope3_category INTEGER NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS method TEXT NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS spend_category TEXT NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS transport_mode TEXT NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS refrigerant_type TEXT NULL`;
      await sql`ALTER TABLE emission_factor_library ADD COLUMN IF NOT EXISTS region TEXT NULL`;
      await sql`
        UPDATE emission_factor_library
        SET
          country_key = COALESCE(country, ''),
          reporting_year = COALESCE(reporting_year, year),
          year = COALESCE(year, reporting_year),
          reporting_year_key = COALESCE(COALESCE(reporting_year, year), -1)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS emission_factor_settings (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          country TEXT NOT NULL DEFAULT '',
          refrigerant_type TEXT NOT NULL DEFAULT 'R134A',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, country)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ghg_activity_definitions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          scope3_category INTEGER NULL,
          key TEXT NOT NULL,
          name TEXT NOT NULL,
          group_key TEXT NOT NULL DEFAULT 'GHG',
          sub_group TEXT NULL,
          method TEXT NOT NULL,
          unit TEXT NOT NULL,
          requires_factor BOOLEAN NOT NULL DEFAULT TRUE,
          default_factor_key TEXT NULL,
          input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
          sdgs JSONB NOT NULL DEFAULT '[]'::jsonb,
          evidence_required BOOLEAN NOT NULL DEFAULT TRUE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          deleted_at TIMESTAMPTZ NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, key)
        )
      `;
      await sql`ALTER TABLE ghg_activity_definitions ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE ghg_activity_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS ghg_activity_records (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE SET NULL,
          reporting_year INTEGER NOT NULL,
          month INTEGER NULL,
          activity_def_id UUID NOT NULL REFERENCES ghg_activity_definitions(id) ON DELETE RESTRICT,
          quantity NUMERIC NULL,
          amount NUMERIC NULL,
          currency TEXT NULL,
          direct_tco2e NUMERIC NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ghg_emissions_results (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          month INTEGER NULL,
          scope TEXT NOT NULL,
          scope3_category INTEGER NULL,
          total_tco2e NUMERIC NOT NULL DEFAULT 0,
          breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
          warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS social_metric_definitions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          name TEXT NOT NULL,
          group_key TEXT NOT NULL DEFAULT 'S',
          unit TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT 'manual',
          input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
          formula JSONB NULL,
          sdgs JSONB NOT NULL DEFAULT '[]'::jsonb,
          evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          deleted_at TIMESTAMPTZ NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, key)
        )
      `;
      await sql`ALTER TABLE social_metric_definitions ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE social_metric_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS social_records (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE SET NULL,
          reporting_year INTEGER NOT NULL,
          month INTEGER NULL,
          metric_def_id UUID NOT NULL REFERENCES social_metric_definitions(id) ON DELETE RESTRICT,
          value NUMERIC NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS topic_to_metric (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          topic_id UUID NOT NULL,
          metric_type TEXT NOT NULL,
          metric_key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, topic_id, metric_type, metric_key)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS people (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE SET NULL,
          full_name TEXT NOT NULL,
          email TEXT NULL,
          title TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS people_sites (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, person_id, site_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS evidence (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE SET NULL,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes BIGINT NOT NULL DEFAULT 0,
          sha256 TEXT NULL,
          blob_url TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS issue_date DATE NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS doc_type TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS scope_coverage TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS language TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS storage_backend TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS storage_key TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS external_file_id TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS external_drive_id TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS external_parent_id TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS external_web_url TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_of_truth TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS storage_status TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS activities (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          activity_type TEXT NOT NULL,
          period_start DATE NOT NULL,
          period_end DATE NOT NULL,
          quantity NUMERIC NOT NULL,
          unit TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          evidence_id UUID NULL REFERENCES evidence(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS audit_log (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS approval_states (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL,
          entity_key TEXT NOT NULL,
          company_id UUID NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          notes TEXT NOT NULL DEFAULT '',
          approved_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
          approved_at TIMESTAMPTZ NULL,
          updated_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS tenant_entitlements (
          tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          plan TEXT NOT NULL DEFAULT 'free',
          max_users INTEGER NOT NULL DEFAULT 5,
          max_evidence_bytes BIGINT NOT NULL DEFAULT 1073741824,
          max_exports_per_month INTEGER NOT NULL DEFAULT 50,
          max_jobs_per_month INTEGER NOT NULL DEFAULT 500,
          modules JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS tenant_usage_monthly (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          users_count INTEGER NOT NULL DEFAULT 0,
          evidence_bytes BIGINT NOT NULL DEFAULT 0,
          exports_count INTEGER NOT NULL DEFAULT 0,
          jobs_count INTEGER NOT NULL DEFAULT 0,
          api_calls_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, year, month)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS platform_settings (
          id INTEGER PRIMARY KEY,
          owner_name TEXT NOT NULL DEFAULT 'WindwardNexus Labs',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_tenants_created_at ON tenants (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (tenant_status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_users_platform_role ON users (platform_role)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memberships_tenant_created_at ON memberships (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memberships_user_created_at ON memberships (user_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sites_tenant_created_at ON sites (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sites_tenant_company_created_at ON sites (tenant_id, company_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_tenant_created_at ON people (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_sites_tenant_site ON people_sites (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_sites_tenant_person ON people_sites (tenant_id, person_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activities_tenant_created_at ON activities (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_evidence_tenant_created_at ON evidence (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created_at ON audit_log (tenant_id, created_at DESC)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_states_entity_unique ON approval_states (tenant_id, entity_type, entity_key)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_approval_states_lookup ON approval_states (tenant_id, entity_type, reporting_year, updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_companies_tenant_created_at ON companies (tenant_id, created_at DESC)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tenant_name_unique ON companies (tenant_id, name)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_year ON site_metrics (tenant_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_company_year ON site_metrics (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_site_year ON site_metrics (tenant_id, site_id, reporting_year)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_site_metrics_unique_site_year_key ON site_metrics (tenant_id, site_id, reporting_year, metric_key)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_entity_evidence_lookup ON entity_evidence (tenant_id, entity_type, entity_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_workforce_tenant_company_year ON workforce_monthly (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_workforce_tenant_site_year ON workforce_monthly (tenant_id, site_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leavers_tenant_company_year ON workforce_leavers_monthly (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leavers_tenant_site_year ON workforce_leavers_monthly (tenant_id, site_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_management_tenant_company_year ON management_headcount_yearly (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_management_tenant_site_year ON management_headcount_yearly (tenant_id, site_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_company_year_flags_lookup ON company_year_flags (tenant_id, reporting_year, company_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_emission_factors_lookup ON emission_factors (tenant_id, key)`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_emission_factor_country_overrides_lookup
        ON emission_factor_country_overrides (tenant_id, country, reporting_year, key)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_emission_factor_library_lookup
        ON emission_factor_library (library, country_key, reporting_year_key, key)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_emission_factor_library_pk
        ON emission_factor_library (library, country_key, reporting_year_key, key)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_emission_factor_settings_lookup
        ON emission_factor_settings (tenant_id, country)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_emission_factor_library_scope_lookup
        ON emission_factor_library (library, scope, scope3_category, method, spend_category, transport_mode, refrigerant_type, region)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ghg_activity_definitions_lookup
        ON ghg_activity_definitions (tenant_id, scope, scope3_category, is_active, sort_order, key)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ghg_activity_records_lookup
        ON ghg_activity_records (tenant_id, company_id, site_id, reporting_year, month, activity_def_id, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ghg_activity_records_year_scope
        ON ghg_activity_records (tenant_id, reporting_year, company_id, site_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ghg_emissions_results_lookup
        ON ghg_emissions_results (tenant_id, company_id, site_id, reporting_year, month, scope, scope3_category)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ghg_emissions_results_unique_rollup
        ON ghg_emissions_results (
          tenant_id,
          company_id,
          reporting_year,
          scope,
          COALESCE(scope3_category, -1),
          COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(month, -1)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_social_metric_definitions_lookup
        ON social_metric_definitions (tenant_id, group_key, is_active, sort_order, key)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_social_records_lookup
        ON social_records (tenant_id, company_id, site_id, reporting_year, month, metric_def_id, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_topic_to_metric_lookup
        ON topic_to_metric (tenant_id, topic_id, metric_type, metric_key)
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_tenant_site ON people (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activities_tenant_site ON activities (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_evidence_tenant_site ON evidence (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_tenant_usage_monthly_period ON tenant_usage_monthly (year, month, tenant_id)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_tenant_name_unique ON sites (tenant_id, name)`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_people_tenant_email_unique
        ON people (tenant_id, LOWER(email))
        WHERE email IS NOT NULL
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'memberships_role_check'
          ) THEN
            ALTER TABLE memberships
              ADD CONSTRAINT memberships_role_check
              CHECK (role IN ('TenantAdmin', 'Manager', 'Personnel', 'Auditor'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'sites_company_id_fkey'
          ) THEN
            ALTER TABLE sites
              ADD CONSTRAINT sites_company_id_fkey
              FOREIGN KEY (company_id)
              REFERENCES companies(id)
              ON DELETE RESTRICT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'entity_evidence_evidence_id_fkey'
          ) THEN
            ALTER TABLE entity_evidence
              ADD CONSTRAINT entity_evidence_evidence_id_fkey
              FOREIGN KEY (evidence_id)
              REFERENCES evidence(id)
              ON DELETE CASCADE;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ghg_activity_definitions_scope_check'
          ) THEN
            ALTER TABLE ghg_activity_definitions
              ADD CONSTRAINT ghg_activity_definitions_scope_check
              CHECK (scope IN ('scope1', 'scope2', 'scope3'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ghg_activity_definitions_scope3_category_check'
          ) THEN
            ALTER TABLE ghg_activity_definitions
              ADD CONSTRAINT ghg_activity_definitions_scope3_category_check
              CHECK (
                (scope = 'scope3' AND scope3_category BETWEEN 1 AND 15)
                OR (scope <> 'scope3' AND scope3_category IS NULL)
              );
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ghg_activity_definitions_method_check'
          ) THEN
            ALTER TABLE ghg_activity_definitions
              ADD CONSTRAINT ghg_activity_definitions_method_check
              CHECK (method IN ('activity', 'spend', 'supplier_specific', 'direct_tco2e'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ghg_activity_records_month_check'
          ) THEN
            ALTER TABLE ghg_activity_records
              ADD CONSTRAINT ghg_activity_records_month_check
              CHECK (month IS NULL OR (month >= 1 AND month <= 12));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'social_metric_definitions_method_check'
          ) THEN
            ALTER TABLE social_metric_definitions
              ADD CONSTRAINT social_metric_definitions_method_check
              CHECK (method IN ('manual', 'computed'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'social_records_month_check'
          ) THEN
            ALTER TABLE social_records
              ADD CONSTRAINT social_records_month_check
              CHECK (month IS NULL OR (month >= 1 AND month <= 12));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'emission_factor_library_scope_check'
          ) THEN
            ALTER TABLE emission_factor_library
              ADD CONSTRAINT emission_factor_library_scope_check
              CHECK (scope IS NULL OR scope IN ('scope1', 'scope2', 'scope3'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'emission_factor_library_scope3_category_check'
          ) THEN
            ALTER TABLE emission_factor_library
              ADD CONSTRAINT emission_factor_library_scope3_category_check
              CHECK (scope3_category IS NULL OR (scope3_category BETWEEN 1 AND 15));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'emission_factor_library_method_check'
          ) THEN
            ALTER TABLE emission_factor_library
              ADD CONSTRAINT emission_factor_library_method_check
              CHECK (method IS NULL OR method IN ('activity', 'spend', 'supplier_specific', 'direct_tco2e'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'users_platform_role_check'
          ) THEN
            ALTER TABLE users
              ADD CONSTRAINT users_platform_role_check
              CHECK (platform_role IN ('none', 'superadmin', 'support', 'billing'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenants_tenant_status_check'
          ) THEN
            ALTER TABLE tenants
              ADD CONSTRAINT tenants_tenant_status_check
              CHECK (tenant_status IN ('active', 'suspended', 'archived'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenants_created_by_user_id_fkey'
          ) THEN
            ALTER TABLE tenants
              ADD CONSTRAINT tenants_created_by_user_id_fkey
              FOREIGN KEY (created_by_user_id)
              REFERENCES users(id)
              ON DELETE SET NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_entitlements_max_users_check'
          ) THEN
            ALTER TABLE tenant_entitlements
              ADD CONSTRAINT tenant_entitlements_max_users_check
              CHECK (max_users >= 1);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_entitlements_max_evidence_bytes_check'
          ) THEN
            ALTER TABLE tenant_entitlements
              ADD CONSTRAINT tenant_entitlements_max_evidence_bytes_check
              CHECK (max_evidence_bytes >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_entitlements_max_exports_per_month_check'
          ) THEN
            ALTER TABLE tenant_entitlements
              ADD CONSTRAINT tenant_entitlements_max_exports_per_month_check
              CHECK (max_exports_per_month >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_entitlements_max_jobs_per_month_check'
          ) THEN
            ALTER TABLE tenant_entitlements
              ADD CONSTRAINT tenant_entitlements_max_jobs_per_month_check
              CHECK (max_jobs_per_month >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_year_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_year_check
              CHECK (year >= 2000 AND year <= 9999);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_month_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_month_check
              CHECK (month >= 1 AND month <= 12);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_users_count_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_users_count_check
              CHECK (users_count >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_evidence_bytes_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_evidence_bytes_check
              CHECK (evidence_bytes >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_exports_count_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_exports_count_check
              CHECK (exports_count >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_jobs_count_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_jobs_count_check
              CHECK (jobs_count >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_usage_monthly_api_calls_count_check'
          ) THEN
            ALTER TABLE tenant_usage_monthly
              ADD CONSTRAINT tenant_usage_monthly_api_calls_count_check
              CHECK (api_calls_count >= 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_singleton_check'
          ) THEN
            ALTER TABLE platform_settings
              ADD CONSTRAINT platform_settings_singleton_check
              CHECK (id = 1);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'approval_states_status_check'
          ) THEN
            ALTER TABLE approval_states
              ADD CONSTRAINT approval_states_status_check
              CHECK (status IN ('draft', 'in_review', 'approved'));
          END IF;
        END $$;
      `;

      await sql`
        INSERT INTO tenants (id, name)
        VALUES (${LEGACY_TENANT_ID}, 'Legacy Tenant')
        ON CONFLICT (id) DO NOTHING
      `;

      await sql`
        INSERT INTO tenant_entitlements (tenant_id)
        SELECT t.id
        FROM tenants t
        ON CONFLICT (tenant_id) DO NOTHING
      `;

      await sql`
        INSERT INTO people_sites (tenant_id, person_id, site_id)
        SELECT p.tenant_id, p.id, p.site_id
        FROM people p
        WHERE p.site_id IS NOT NULL
        ON CONFLICT (tenant_id, person_id, site_id) DO NOTHING
      `;

      const tenantRows = await sql`
        SELECT id, name
        FROM tenants
      `;
      for (const tenant of tenantRows) {
        await ensureHoldingCompanyForTenant(sql, tenant.id, tenant.name);
        await seedGhgActivityDefinitionsForTenant(sql, tenant.id);
        await seedSocialMetricDefinitionsForTenant(sql, tenant.id);
      }

      await sql`
        WITH ranked AS (
          SELECT
            id,
            tenant_id,
            ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, id ASC) AS rn
          FROM companies
          WHERE is_holding = TRUE
        )
        UPDATE companies c
        SET is_holding = FALSE, updated_at = NOW()
        FROM ranked r
        WHERE c.id = r.id
          AND r.rn > 1
      `;

      await sql`
        UPDATE sites s
        SET company_id = c.id
        FROM companies c
        WHERE s.tenant_id = c.tenant_id
          AND c.is_holding = TRUE
          AND s.company_id IS NULL
      `;

      await sql`
        UPDATE sites
        SET company_id = fallback_company.company_id
        FROM (
          SELECT DISTINCT ON (c.tenant_id) c.tenant_id, c.id AS company_id
          FROM companies c
          ORDER BY c.tenant_id, c.is_holding DESC, c.created_at ASC
        ) fallback_company
        WHERE sites.company_id IS NULL
          AND fallback_company.tenant_id = sites.tenant_id
      `;

      await sql`ALTER TABLE sites ALTER COLUMN company_id SET NOT NULL`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_single_holding_per_tenant ON companies (tenant_id) WHERE is_holding = TRUE`;

      await seedDefaultMetricDefinitions(sql);
      const factorSeeds = [
        ...EMISSION_FACTOR_DEFINITIONS.map((item) => ({ key: item.key, unit: item.unit })),
        ...FACTOR_LIBRARY_ROWS.map((item) => ({ key: item.key, unit: item.unit })),
        ...GHG_ACTIVITY_BASELINE.filter((item) => item.defaultFactorKey).map((item) => ({
          key: item.defaultFactorKey,
          unit: "kgCO2e/unit",
        })),
      ];
      for (const tenant of tenantRows) {
        await ensureFactorKeysForTenant(sql, tenant.id, factorSeeds);
      }

      await seedEmissionFactorLibrary(sql);

      globalThis[ENTERPRISE_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY];
};

export const ensureMetricsSchema = async () => {
  if (!globalThis[METRICS_SCHEMA_PROMISE_KEY]) {
    globalThis[METRICS_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS metric_definitions (
          key TEXT PRIMARY KEY,
          tenant_id UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          unit TEXT NOT NULL,
          description TEXT NULL,
          is_required BOOLEAN NOT NULL DEFAULT FALSE,
          validation JSONB NULL,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          deleted_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS tenant_id UUID NULL REFERENCES tenants(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
      await sql`ALTER TABLE metric_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

      await sql`
        CREATE TABLE IF NOT EXISTS site_metrics (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          metric_key TEXT NOT NULL REFERENCES metric_definitions(key) ON DELETE RESTRICT,
          value NUMERIC NOT NULL,
          unit TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_year ON site_metrics (tenant_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_company_year ON site_metrics (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_site_year ON site_metrics (tenant_id, site_id, reporting_year)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_site_metrics_unique_site_year_key ON site_metrics (tenant_id, site_id, reporting_year, metric_key)`;

      const countRows = await sql`
        SELECT COUNT(*)::int AS total
        FROM metric_definitions
        WHERE tenant_id IS NULL
          AND is_system = TRUE
          AND deleted_at IS NULL
      `;
      const total = Number(countRows?.[0]?.total || 0);
      if (total === 0) {
        await seedDefaultMetricDefinitions(sql);
      }
    })().finally(() => {
      globalThis[METRICS_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[METRICS_SCHEMA_PROMISE_KEY];
};

export const ensureSocialSchema = async () => {
  if (globalThis[SOCIAL_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[SOCIAL_SCHEMA_PROMISE_KEY]) {
    globalThis[SOCIAL_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      globalThis[SOCIAL_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[SOCIAL_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[SOCIAL_SCHEMA_PROMISE_KEY];
};

export const ensureGhgSchema = async () => {
  if (globalThis[GHG_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[GHG_SCHEMA_PROMISE_KEY]) {
    globalThis[GHG_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      globalThis[GHG_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[GHG_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[GHG_SCHEMA_PROMISE_KEY];
};

export const ensureGovernanceSchema = async () => {
  if (globalThis[GOVERNANCE_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY]) {
    globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS governance_yearly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          board_total INTEGER NOT NULL DEFAULT 0 CHECK (board_total >= 0),
          board_women INTEGER NOT NULL DEFAULT 0 CHECK (board_women >= 0),
          board_independent INTEGER NOT NULL DEFAULT 0 CHECK (board_independent >= 0),
          board_meetings INTEGER NOT NULL DEFAULT 0 CHECK (board_meetings >= 0),
          anti_corruption_policy BOOLEAN NOT NULL DEFAULT FALSE,
          whistleblowing_channel BOOLEAN NOT NULL DEFAULT FALSE,
          data_privacy_policy BOOLEAN NOT NULL DEFAULT FALSE,
          supplier_code_of_conduct BOOLEAN NOT NULL DEFAULT FALSE,
          gdpr_training BOOLEAN NOT NULL DEFAULT FALSE,
          data_breaches_count INTEGER NOT NULL DEFAULT 0 CHECK (data_breaches_count >= 0),
          corruption_incidents_count INTEGER NOT NULL DEFAULT 0 CHECK (corruption_incidents_count >= 0),
          fines_amount_eur NUMERIC NOT NULL DEFAULT 0 CHECK (fines_amount_eur >= 0),
          custom_values JSONB NOT NULL DEFAULT '{}'::jsonb,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, company_id, reporting_year)
        )
      `;
      await sql`ALTER TABLE governance_yearly ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}'::jsonb`;

      await sql`
        CREATE TABLE IF NOT EXISTS governance_policies (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          policy_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'no' CHECK (status IN ('yes', 'no', 'in_progress')),
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, company_id, reporting_year, policy_key)
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_governance_yearly_lookup
        ON governance_yearly (tenant_id, company_id, reporting_year)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_governance_policies_lookup
        ON governance_policies (tenant_id, company_id, reporting_year, policy_key)
      `;

      globalThis[GOVERNANCE_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY];
};

export const ensureAssessmentSchema = async () => {
  if (globalThis[ASSESSMENT_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY]) {
    globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          tenant_id UUID NULL,
          site_id UUID NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id UUID NULL`;
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_id UUID NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS parameters (
          key TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          options JSONB NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS answers (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          tenant_id UUID NULL,
          parameter_key TEXT NOT NULL REFERENCES parameters(key) ON DELETE CASCADE,
          value JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (project_id, parameter_key)
        )
      `;

      await sql`ALTER TABLE answers ADD COLUMN IF NOT EXISTS tenant_id UUID NULL`;
      await sql`ALTER TABLE answers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

      await sql`
        UPDATE projects
        SET tenant_id = ${LEGACY_TENANT_ID}
        WHERE tenant_id IS NULL
      `;

      await sql`
        UPDATE answers a
        SET tenant_id = p.tenant_id
        FROM projects p
        WHERE a.project_id = p.id
          AND a.tenant_id IS NULL
      `;

      await sql`
        UPDATE answers
        SET tenant_id = ${LEGACY_TENANT_ID}
        WHERE tenant_id IS NULL
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_id_fkey'
          ) THEN
            ALTER TABLE projects
              ADD CONSTRAINT projects_tenant_id_fkey
              FOREIGN KEY (tenant_id)
              REFERENCES tenants(id)
              ON DELETE CASCADE;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'projects_site_id_fkey'
          ) THEN
            ALTER TABLE projects
              ADD CONSTRAINT projects_site_id_fkey
              FOREIGN KEY (site_id)
              REFERENCES sites(id)
              ON DELETE SET NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'answers_tenant_id_fkey'
          ) THEN
            ALTER TABLE answers
              ADD CONSTRAINT answers_tenant_id_fkey
              FOREIGN KEY (tenant_id)
              REFERENCES tenants(id)
              ON DELETE CASCADE;
          END IF;
        END $$;
      `;

      await sql`ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL`;
      await sql`ALTER TABLE answers ALTER COLUMN tenant_id SET NOT NULL`;

      await sql`CREATE INDEX IF NOT EXISTS idx_projects_tenant_created_at ON projects (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_projects_tenant_updated_at ON projects (tenant_id, updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_projects_tenant_site ON projects (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_parameters_category_sort ON parameters (category, sort_order, key)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_answers_tenant_created_at ON answers (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_answers_project_updated_at ON answers (project_id, updated_at DESC)`;

      for (const parameter of ESG_PARAMETER_DEFINITIONS) {
        await sql`
          INSERT INTO parameters (key, category, label, description, type, required, options, sort_order)
          VALUES (
            ${parameter.key},
            ${parameter.category},
            ${parameter.label},
            ${parameter.description},
            ${parameter.type},
            ${parameter.required},
            ${JSON.stringify(parameter.options)},
            ${parameter.sortOrder}
          )
          ON CONFLICT (key) DO UPDATE SET
            category = EXCLUDED.category,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            type = EXCLUDED.type,
            required = EXCLUDED.required,
            options = EXCLUDED.options,
            sort_order = EXCLUDED.sort_order
        `;
      }

      globalThis[ASSESSMENT_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY];
};

export const ensureEcoVadisSchema = async () => {
  if (globalThis[ECOVADIS_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ECOVADIS_SCHEMA_PROMISE_KEY]) {
    globalThis[ECOVADIS_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS issue_date DATE NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS doc_type TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS scope_coverage TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS language TEXT NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_assessments (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL,
          reporting_year INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_questions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          assessment_id UUID NOT NULL REFERENCES ecovadis_assessments(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          theme TEXT NOT NULL,
          indicator TEXT NOT NULL,
          text TEXT NOT NULL,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_options (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          question_id UUID NOT NULL REFERENCES ecovadis_questions(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          requires_evidence BOOLEAN NOT NULL DEFAULT TRUE,
          has_free_text BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_answers (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          option_id UUID NOT NULL REFERENCES ecovadis_options(id) ON DELETE CASCADE,
          selected BOOLEAN NOT NULL DEFAULT FALSE,
          free_text TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_answer_evidence (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          answer_id UUID NOT NULL REFERENCES ecovadis_answers(id) ON DELETE CASCADE,
          evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
          pages TEXT NOT NULL,
          comment TEXT NULL,
          visibility TEXT NOT NULL DEFAULT 'private',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, answer_id, evidence_id)
        )
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'evidence_doc_type_check'
          ) THEN
            ALTER TABLE evidence
            ADD CONSTRAINT evidence_doc_type_check
            CHECK (
              doc_type IS NULL
              OR doc_type IN ('policy', 'action', 'reporting', 'audit', 'certification', 'other')
            );
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'evidence_scope_coverage_check'
          ) THEN
            ALTER TABLE evidence
            ADD CONSTRAINT evidence_scope_coverage_check
            CHECK (
              scope_coverage IS NULL
              OR scope_coverage IN ('tenant', 'company', 'site')
            );
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ecovadis_scope_type_check'
          ) THEN
            ALTER TABLE ecovadis_assessments
            ADD CONSTRAINT ecovadis_scope_type_check
            CHECK (scope_type IN ('Group', 'Entity', 'Site'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ecovadis_status_check'
          ) THEN
            ALTER TABLE ecovadis_assessments
            ADD CONSTRAINT ecovadis_status_check
            CHECK (status IN ('draft', 'ready', 'submitted'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ecovadis_answer_evidence_visibility_check'
          ) THEN
            ALTER TABLE ecovadis_answer_evidence
            ADD CONSTRAINT ecovadis_answer_evidence_visibility_check
            CHECK (visibility IN ('private', 'public'));
          END IF;
        END $$;
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ecovadis_assessment_scope_unique
        ON ecovadis_assessments (tenant_id, company_id, reporting_year, scope_type)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_assessments_tenant_updated
        ON ecovadis_assessments (tenant_id, updated_at DESC)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ecovadis_questions_unique_code
        ON ecovadis_questions (tenant_id, assessment_id, code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_questions_assessment_sort
        ON ecovadis_questions (tenant_id, assessment_id, sort_order)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_options_question_sort
        ON ecovadis_options (tenant_id, question_id, sort_order)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ecovadis_answers_option_unique
        ON ecovadis_answers (tenant_id, option_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_answers_tenant_updated
        ON ecovadis_answers (tenant_id, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_answer_evidence_lookup
        ON ecovadis_answer_evidence (tenant_id, answer_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_evidence_issue_date
        ON evidence (tenant_id, issue_date DESC)
      `;

      globalThis[ECOVADIS_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[ECOVADIS_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[ECOVADIS_SCHEMA_PROMISE_KEY];
};

export const ensureMaterialitySchema = async () => {
  if (globalThis[MATERIALITY_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[MATERIALITY_SCHEMA_PROMISE_KEY]) {
    globalThis[MATERIALITY_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_topics (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE materiality_topics ADD COLUMN IF NOT EXISTS sdgs JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await sql`ALTER TABLE materiality_topics ADD COLUMN IF NOT EXISTS group_key TEXT NULL`;
      await sql`ALTER TABLE materiality_topics ADD COLUMN IF NOT EXISTS parent_topic_id UUID NULL`;
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_topics_parent_topic_id_fkey'
          ) THEN
            ALTER TABLE materiality_topics
            ADD CONSTRAINT materiality_topics_parent_topic_id_fkey
            FOREIGN KEY (parent_topic_id)
            REFERENCES materiality_topics(id)
            ON DELETE SET NULL;
          END IF;
        END $$;
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_stakeholders (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          weight NUMERIC NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_scores (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          topic_id UUID NOT NULL REFERENCES materiality_topics(id) ON DELETE CASCADE,
          impact_severity INTEGER NOT NULL,
          impact_scope INTEGER NOT NULL,
          impact_irremediability INTEGER NOT NULL,
          impact_likelihood INTEGER NOT NULL,
          financial_magnitude INTEGER NOT NULL,
          financial_likelihood INTEGER NOT NULL,
          notes TEXT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, reporting_year, topic_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_thresholds (
          tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          impact_threshold NUMERIC NOT NULL DEFAULT 9.0,
          financial_threshold NUMERIC NOT NULL DEFAULT 9.0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS materiality_selected_topics (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          topic_id UUID NOT NULL REFERENCES materiality_topics(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, reporting_year, topic_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS materiality_year_kickoff_state (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          kickoff_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
          definition_completed BOOLEAN NOT NULL DEFAULT FALSE,
          last_step TEXT NOT NULL DEFAULT 'define',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, reporting_year)
        )
      `;

      await sql`
        DO $$
        DECLARE unique_constraint_name TEXT;
        BEGIN
          UPDATE materiality_topics
          SET group_key = CASE
            WHEN code ILIKE 'E%' THEN 'E'
            WHEN code ILIKE 'S%' THEN 'S'
            WHEN code ILIKE 'GEN%' THEN 'GEN'
            WHEN code ILIKE 'G%' THEN 'G'
            WHEN category ILIKE '%environment%' THEN 'E'
            WHEN category ILIKE '%social%' THEN 'S'
            WHEN category ILIKE '%governance%' THEN 'G'
            WHEN category ILIKE '%general%' THEN 'GEN'
            ELSE 'CUSTOM'
          END
          WHERE group_key IS NULL;

          SELECT c.conname
          INTO unique_constraint_name
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'materiality_topics'
            AND c.contype = 'u'
            AND (
              SELECT array_agg(a.attname ORDER BY u.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = t.oid
               AND a.attnum = u.attnum
            ) = ARRAY['tenant_id', 'code']::name[]
          LIMIT 1;

          IF unique_constraint_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE materiality_topics DROP CONSTRAINT %I', unique_constraint_name);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_stakeholders_weight_check'
          ) THEN
            ALTER TABLE materiality_stakeholders
            ADD CONSTRAINT materiality_stakeholders_weight_check
            CHECK (weight > 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_severity_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_severity_check
            CHECK (impact_severity BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_scope_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_scope_check
            CHECK (impact_scope BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_irremediability_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_irremediability_check
            CHECK (impact_irremediability BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_likelihood_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_likelihood_check
            CHECK (impact_likelihood BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_financial_magnitude_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_financial_magnitude_check
            CHECK (financial_magnitude BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_financial_likelihood_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_financial_likelihood_check
            CHECK (financial_likelihood BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_thresholds_impact_threshold_check'
          ) THEN
            ALTER TABLE materiality_thresholds
            ADD CONSTRAINT materiality_thresholds_impact_threshold_check
            CHECK (impact_threshold > 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_thresholds_financial_threshold_check'
          ) THEN
            ALTER TABLE materiality_thresholds
            ADD CONSTRAINT materiality_thresholds_financial_threshold_check
            CHECK (financial_threshold > 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_year_kickoff_state_reporting_year_check'
          ) THEN
            ALTER TABLE materiality_year_kickoff_state
            ADD CONSTRAINT materiality_year_kickoff_state_reporting_year_check
            CHECK (reporting_year BETWEEN 2000 AND 2200);
          END IF;
        END $$;
      `;

      await sql`DROP INDEX IF EXISTS idx_materiality_topics_code_unique`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_topics_group_lookup
        ON materiality_topics (tenant_id, group_key, category, code, name)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_topics_lookup
        ON materiality_topics (tenant_id, category, code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_topics_parent
        ON materiality_topics (tenant_id, parent_topic_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_scores_company_year
        ON materiality_scores (tenant_id, company_id, reporting_year)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_scores_topic
        ON materiality_scores (tenant_id, topic_id, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_selected_topics_lookup
        ON materiality_selected_topics (tenant_id, company_id, reporting_year, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_year_kickoff_state_lookup
        ON materiality_year_kickoff_state (tenant_id, company_id, reporting_year)
      `;

      globalThis[MATERIALITY_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[MATERIALITY_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[MATERIALITY_SCHEMA_PROMISE_KEY];
};

export const ensureStandardsSchema = async () => {
  if (globalThis[STANDARDS_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[STANDARDS_SCHEMA_PROMISE_KEY]) {
    globalThis[STANDARDS_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS standards_frameworks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS company_profiles (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          industry_framework TEXT NOT NULL DEFAULT 'GRI',
          sasb_industry_code TEXT NULL,
          gri_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
          region TEXT NULL,
          country TEXT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS company_enabled_definitions (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          def_type TEXT NOT NULL,
          def_key TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, def_type, def_key)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS standards_metrics (
          id UUID PRIMARY KEY,
          framework TEXT NOT NULL,
          industry_code TEXT NULL,
          code TEXT NOT NULL,
          title TEXT NOT NULL,
          unit TEXT NULL,
          method_hint TEXT NULL,
          sdgs JSONB NOT NULL DEFAULT '[]'::jsonb,
          reference_url TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS standards_mappings (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          framework TEXT NOT NULL,
          standards_metric_id UUID NOT NULL REFERENCES standards_metrics(id) ON DELETE CASCADE,
          internal_type TEXT NOT NULL,
          internal_key TEXT NOT NULL,
          notes TEXT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, framework, standards_metric_id, internal_type, internal_key)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS governance_field_definitions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          field_type TEXT NOT NULL,
          unit TEXT NULL,
          options JSONB NOT NULL DEFAULT '[]'::jsonb,
          sdgs JSONB NOT NULL DEFAULT '[]'::jsonb,
          evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          deleted_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, key)
        )
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_framework_check'
          ) THEN
            ALTER TABLE company_profiles
            ADD CONSTRAINT company_profiles_framework_check
            CHECK (industry_framework IN ('GRI', 'SASB'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'company_enabled_definitions_type_check'
          ) THEN
            ALTER TABLE company_enabled_definitions
            ADD CONSTRAINT company_enabled_definitions_type_check
            CHECK (def_type IN ('environment_metric', 'ghg_activity', 'social_metric', 'governance_field'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'standards_metrics_framework_check'
          ) THEN
            ALTER TABLE standards_metrics
            ADD CONSTRAINT standards_metrics_framework_check
            CHECK (framework IN ('GRI', 'SASB'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'standards_mappings_framework_check'
          ) THEN
            ALTER TABLE standards_mappings
            ADD CONSTRAINT standards_mappings_framework_check
            CHECK (framework IN ('GRI', 'SASB'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'standards_mappings_internal_type_check'
          ) THEN
            ALTER TABLE standards_mappings
            ADD CONSTRAINT standards_mappings_internal_type_check
            CHECK (internal_type IN ('environment_metric', 'ghg_activity', 'social_metric', 'governance_field'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'governance_field_definitions_field_type_check'
          ) THEN
            ALTER TABLE governance_field_definitions
            ADD CONSTRAINT governance_field_definitions_field_type_check
            CHECK (field_type IN ('boolean', 'number', 'text', 'select'));
          END IF;
        END $$;
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_company_profiles_framework
        ON company_profiles (tenant_id, industry_framework, sasb_industry_code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_company_enabled_definitions_lookup
        ON company_enabled_definitions (tenant_id, company_id, def_type, enabled)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_standards_metrics_unique_code
        ON standards_metrics (framework, COALESCE(industry_code, ''), code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_standards_metrics_lookup
        ON standards_metrics (framework, industry_code, code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_standards_mappings_lookup
        ON standards_mappings (tenant_id, framework, internal_type, internal_key)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_governance_field_definitions_lookup
        ON governance_field_definitions (tenant_id, is_active, key)
      `;

      await sql`
        INSERT INTO standards_frameworks (id, name)
        VALUES
          ('GRI', 'GRI'),
          ('SASB', 'SASB')
        ON CONFLICT (id) DO NOTHING
      `;

      const tenantRows = await sql`
        SELECT id
        FROM tenants
      `;
      for (const tenant of tenantRows || []) {
        await seedGovernanceFieldDefinitionsForTenant(sql, tenant.id);
      }

      globalThis[STANDARDS_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[STANDARDS_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[STANDARDS_SCHEMA_PROMISE_KEY];
};

export const PLATFORM_ROLES = {
  NONE: "none",
  SUPERADMIN: "superadmin",
  SUPPORT: "support",
  BILLING: "billing",
};

export const TENANT_STATUSES = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
};

const toSafeInteger = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
};

const normalizeModules = (value) => {
  if (!value) {
    return { ...DEFAULT_MODULES };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
      return { ...DEFAULT_MODULES };
    }
  }
  return { ...DEFAULT_MODULES };
};

export const getUsagePeriod = (date = new Date()) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
});

export const ensurePlatformSchema = async () => {
  if (globalThis[PLATFORM_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[PLATFORM_SCHEMA_PROMISE_KEY]) {
    globalThis[PLATFORM_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      globalThis[PLATFORM_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[PLATFORM_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[PLATFORM_SCHEMA_PROMISE_KEY];
};

export const ensureStorageSchema = async () => {
  if (globalThis[STORAGE_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[STORAGE_SCHEMA_PROMISE_KEY]) {
    globalThis[STORAGE_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS tenant_storage_config (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NULL REFERENCES companies(id) ON DELETE CASCADE,
          scope_level TEXT NOT NULL,
          storage_mode TEXT NOT NULL,
          primary_backend TEXT NOT NULL,
          repository_display_name TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          is_default BOOLEAN NOT NULL DEFAULT TRUE,
          auth_mode TEXT NULL,
          secret_reference TEXT NULL,
          root_folder_path TEXT NULL,
          root_folder_id TEXT NULL,
          drive_id TEXT NULL,
          external_tenant_id TEXT NULL,
          mount_path TEXT NULL,
          path_access_mode TEXT NULL,
          preview_supported BOOLEAN NOT NULL DEFAULT FALSE,
          allow_platform_upload BOOLEAN NOT NULL DEFAULT FALSE,
          allow_reference_only_mode BOOLEAN NOT NULL DEFAULT FALSE,
          download_access_mode TEXT NOT NULL,
          signed_url_ttl_sec INTEGER NULL,
          preview_mode TEXT NOT NULL,
          audit_downloads BOOLEAN NOT NULL DEFAULT TRUE,
          allow_export_file_links BOOLEAN NOT NULL DEFAULT FALSE,
          export_link_mode TEXT NOT NULL,
          backup_profile TEXT NOT NULL,
          backup_frequency TEXT NOT NULL,
          backup_retention_days INTEGER NULL,
          backup_verification_mode TEXT NOT NULL,
          offsite_repository TEXT NULL,
          folder_strategy TEXT NOT NULL,
          custom_folder_pattern TEXT NULL,
          filename_strategy TEXT NOT NULL,
          enforce_checksum BOOLEAN NOT NULL DEFAULT FALSE,
          duplicate_policy TEXT NOT NULL,
          versioning_mode TEXT NOT NULL,
          repository_health_status TEXT NOT NULL DEFAULT 'warning',
          last_validation_at TIMESTAMPTZ NULL,
          last_error_message TEXT NULL,
          migration_mode TEXT NOT NULL DEFAULT 'none',
          legacy_access_fallback BOOLEAN NOT NULL DEFAULT TRUE,
          migration_batch_size INTEGER NULL,
          migration_status TEXT NOT NULL DEFAULT 'not_started',
          migration_notes TEXT NULL,
          backup_notes TEXT NULL,
          admin_notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS company_id UUID NULL REFERENCES companies(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS scope_level TEXT NOT NULL DEFAULT 'tenant'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS storage_mode TEXT NOT NULL DEFAULT 'platform_managed'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS primary_backend TEXT NOT NULL DEFAULT 'vercel_blob'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS repository_display_name TEXT NOT NULL DEFAULT 'Primary evidence vault'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS auth_mode TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS secret_reference TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS root_folder_path TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS root_folder_id TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS drive_id TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS external_tenant_id TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS mount_path TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS path_access_mode TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS preview_supported BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS allow_platform_upload BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS allow_reference_only_mode BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS download_access_mode TEXT NOT NULL DEFAULT 'signed_url_short_lived'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS signed_url_ttl_sec INTEGER NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS preview_mode TEXT NOT NULL DEFAULT 'platform_viewer'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS audit_downloads BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS allow_export_file_links BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS export_link_mode TEXT NOT NULL DEFAULT 'reference_only'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS backup_profile TEXT NOT NULL DEFAULT 'no_backup'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS backup_frequency TEXT NOT NULL DEFAULT 'daily'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS backup_retention_days INTEGER NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS backup_verification_mode TEXT NOT NULL DEFAULT 'none'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS offsite_repository TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS folder_strategy TEXT NOT NULL DEFAULT 'tenant_company_year'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS custom_folder_pattern TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS filename_strategy TEXT NOT NULL DEFAULT 'timestamp_original'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS enforce_checksum BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS duplicate_policy TEXT NOT NULL DEFAULT 'warn_on_same_hash'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS versioning_mode TEXT NOT NULL DEFAULT 'auto_version_on_replace'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS repository_health_status TEXT NOT NULL DEFAULT 'warning'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS last_validation_at TIMESTAMPTZ NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS last_error_message TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS migration_mode TEXT NOT NULL DEFAULT 'new_uploads_only'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS legacy_access_fallback BOOLEAN NOT NULL DEFAULT TRUE`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS migration_batch_size INTEGER NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS migration_status TEXT NOT NULL DEFAULT 'not_started'`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS migration_notes TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS backup_notes TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS admin_notes TEXT NULL`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
      await sql`ALTER TABLE tenant_storage_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_storage_config_tenant_scope
        ON tenant_storage_config (tenant_id)
        WHERE scope_level = 'tenant' AND company_id IS NULL
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_storage_config_company_scope
        ON tenant_storage_config (tenant_id, company_id)
        WHERE scope_level = 'company' AND company_id IS NOT NULL
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_storage_config_active_default_tenant
        ON tenant_storage_config (tenant_id)
        WHERE scope_level = 'tenant' AND company_id IS NULL AND is_active = TRUE AND is_default = TRUE
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_storage_config_active_default_company
        ON tenant_storage_config (tenant_id, company_id)
        WHERE scope_level = 'company' AND company_id IS NOT NULL AND is_active = TRUE AND is_default = TRUE
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'tenant_storage_config_company_scope_check'
          ) THEN
            ALTER TABLE tenant_storage_config
            ADD CONSTRAINT tenant_storage_config_company_scope_check
            CHECK (
              (scope_level = 'tenant' AND company_id IS NULL)
              OR (scope_level = 'company' AND company_id IS NOT NULL)
            );
          END IF;
        END $$;
      `;

      globalThis[STORAGE_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[STORAGE_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[STORAGE_SCHEMA_PROMISE_KEY];
};

export const ensureTenantEntitlements = async (sql, tenantId) => {
  await sql`
    INSERT INTO tenant_entitlements (
      tenant_id,
      plan,
      max_users,
      max_evidence_bytes,
      max_exports_per_month,
      max_jobs_per_month,
      modules
    )
    VALUES (
      ${tenantId},
      'free',
      5,
      1073741824,
      50,
      500,
      ${JSON.stringify(DEFAULT_MODULES)}::jsonb
    )
    ON CONFLICT (tenant_id) DO NOTHING
  `;
};

export const getTenantEntitlements = async (sql, tenantId) => {
  await ensureTenantEntitlements(sql, tenantId);
  const rows = await sql`
    SELECT
      tenant_id,
      plan,
      max_users,
      max_evidence_bytes,
      max_exports_per_month,
      max_jobs_per_month,
      modules,
      created_at,
      updated_at
    FROM tenant_entitlements
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row) {
    return null;
  }

  return {
    tenantId: row.tenant_id,
    plan: row.plan || "free",
    maxUsers: toSafeInteger(row.max_users, 5),
    maxEvidenceBytes: toSafeInteger(row.max_evidence_bytes, 1073741824),
    maxExportsPerMonth: toSafeInteger(row.max_exports_per_month, 50),
    maxJobsPerMonth: toSafeInteger(row.max_jobs_per_month, 500),
    modules: normalizeModules(row.modules),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};

export const upsertTenantEntitlements = async (sql, tenantId, updates = {}) => {
  await ensureTenantEntitlements(sql, tenantId);
  const current = await getTenantEntitlements(sql, tenantId);
  const next = {
    plan: typeof updates.plan === "string" && updates.plan.trim() ? updates.plan.trim() : current?.plan || "free",
    maxUsers: Number.isFinite(Number(updates.maxUsers)) ? Math.max(1, Math.floor(Number(updates.maxUsers))) : current?.maxUsers || 5,
    maxEvidenceBytes: Number.isFinite(Number(updates.maxEvidenceBytes))
      ? Math.max(0, Math.floor(Number(updates.maxEvidenceBytes)))
      : current?.maxEvidenceBytes || 1073741824,
    maxExportsPerMonth: Number.isFinite(Number(updates.maxExportsPerMonth))
      ? Math.max(0, Math.floor(Number(updates.maxExportsPerMonth)))
      : current?.maxExportsPerMonth || 50,
    maxJobsPerMonth: Number.isFinite(Number(updates.maxJobsPerMonth))
      ? Math.max(0, Math.floor(Number(updates.maxJobsPerMonth)))
      : current?.maxJobsPerMonth || 500,
    modules:
      updates.modules && typeof updates.modules === "object" && !Array.isArray(updates.modules)
        ? updates.modules
        : current?.modules || { ...DEFAULT_MODULES },
  };

  await sql`
    UPDATE tenant_entitlements
    SET
      plan = ${next.plan},
      max_users = ${next.maxUsers},
      max_evidence_bytes = ${next.maxEvidenceBytes},
      max_exports_per_month = ${next.maxExportsPerMonth},
      max_jobs_per_month = ${next.maxJobsPerMonth},
      modules = ${JSON.stringify(next.modules)}::jsonb,
      updated_at = NOW()
    WHERE tenant_id = ${tenantId}
  `;

  return getTenantEntitlements(sql, tenantId);
};

export const ensureTenantUsageMonth = async (sql, tenantId, period = getUsagePeriod()) => {
  const year = toSafeInteger(period.year, getUsagePeriod().year);
  const month = Math.min(12, Math.max(1, toSafeInteger(period.month, getUsagePeriod().month)));
  await sql`
    INSERT INTO tenant_usage_monthly (tenant_id, year, month)
    VALUES (${tenantId}, ${year}, ${month})
    ON CONFLICT (tenant_id, year, month) DO NOTHING
  `;
  return { year, month };
};

export const getTenantUsageMonth = async (sql, tenantId, period = getUsagePeriod()) => {
  const resolved = await ensureTenantUsageMonth(sql, tenantId, period);
  const rows = await sql`
    SELECT
      tenant_id,
      year,
      month,
      users_count,
      evidence_bytes,
      exports_count,
      jobs_count,
      api_calls_count,
      created_at,
      updated_at
    FROM tenant_usage_monthly
    WHERE tenant_id = ${tenantId}
      AND year = ${resolved.year}
      AND month = ${resolved.month}
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row) {
    return null;
  }
  return {
    tenantId: row.tenant_id,
    year: toSafeInteger(row.year, resolved.year),
    month: toSafeInteger(row.month, resolved.month),
    usersCount: toSafeInteger(row.users_count, 0),
    evidenceBytes: toSafeInteger(row.evidence_bytes, 0),
    exportsCount: toSafeInteger(row.exports_count, 0),
    jobsCount: toSafeInteger(row.jobs_count, 0),
    apiCallsCount: toSafeInteger(row.api_calls_count, 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};

export const incrementTenantUsage = async (sql, tenantId, deltas = {}, period = getUsagePeriod()) => {
  const resolved = await ensureTenantUsageMonth(sql, tenantId, period);
  const usersDelta = Number.isFinite(Number(deltas.usersCount)) ? Math.floor(Number(deltas.usersCount)) : 0;
  const evidenceDelta = Number.isFinite(Number(deltas.evidenceBytes)) ? Math.floor(Number(deltas.evidenceBytes)) : 0;
  const exportsDelta = Number.isFinite(Number(deltas.exportsCount)) ? Math.floor(Number(deltas.exportsCount)) : 0;
  const jobsDelta = Number.isFinite(Number(deltas.jobsCount)) ? Math.floor(Number(deltas.jobsCount)) : 0;
  const apiCallsDelta = Number.isFinite(Number(deltas.apiCallsCount)) ? Math.floor(Number(deltas.apiCallsCount)) : 0;

  await sql`
    INSERT INTO tenant_usage_monthly (
      tenant_id,
      year,
      month,
      users_count,
      evidence_bytes,
      exports_count,
      jobs_count,
      api_calls_count
    )
    VALUES (
      ${tenantId},
      ${resolved.year},
      ${resolved.month},
      ${Math.max(usersDelta, 0)},
      ${Math.max(evidenceDelta, 0)},
      ${Math.max(exportsDelta, 0)},
      ${Math.max(jobsDelta, 0)},
      ${Math.max(apiCallsDelta, 0)}
    )
    ON CONFLICT (tenant_id, year, month)
    DO UPDATE SET
      users_count = GREATEST(tenant_usage_monthly.users_count + ${usersDelta}, 0),
      evidence_bytes = GREATEST(tenant_usage_monthly.evidence_bytes + ${evidenceDelta}, 0),
      exports_count = GREATEST(tenant_usage_monthly.exports_count + ${exportsDelta}, 0),
      jobs_count = GREATEST(tenant_usage_monthly.jobs_count + ${jobsDelta}, 0),
      api_calls_count = GREATEST(tenant_usage_monthly.api_calls_count + ${apiCallsDelta}, 0),
      updated_at = NOW()
  `;

  return getTenantUsageMonth(sql, tenantId, resolved);
};

export const setTenantUsersUsageSnapshot = async (sql, tenantId, usersCount, period = getUsagePeriod()) => {
  const resolved = await ensureTenantUsageMonth(sql, tenantId, period);
  const safeUsers = Math.max(0, Math.floor(Number(usersCount) || 0));
  await sql`
    INSERT INTO tenant_usage_monthly (tenant_id, year, month, users_count)
    VALUES (${tenantId}, ${resolved.year}, ${resolved.month}, ${safeUsers})
    ON CONFLICT (tenant_id, year, month)
    DO UPDATE SET
      users_count = ${safeUsers},
      updated_at = NOW()
  `;
  return getTenantUsageMonth(sql, tenantId, resolved);
};

export const getTenantUsageHistory = async (sql, tenantId, months = 6, period = getUsagePeriod()) => {
  const safeMonths = Math.min(24, Math.max(1, Math.floor(Number(months) || 6)));
  const anchor = new Date(Date.UTC(period.year, period.month - 1, 1));
  const floor = new Date(anchor);
  floor.setUTCMonth(floor.getUTCMonth() - (safeMonths - 1));

  const rows = await sql`
    SELECT
      tenant_id,
      year,
      month,
      users_count,
      evidence_bytes,
      exports_count,
      jobs_count,
      api_calls_count,
      created_at,
      updated_at
    FROM tenant_usage_monthly
    WHERE tenant_id = ${tenantId}
      AND (year > ${floor.getUTCFullYear()} OR (year = ${floor.getUTCFullYear()} AND month >= ${floor.getUTCMonth() + 1}))
      AND (year < ${period.year} OR (year = ${period.year} AND month <= ${period.month}))
    ORDER BY year DESC, month DESC
  `;

  return rows.map((row) => ({
    tenantId: row.tenant_id,
    year: toSafeInteger(row.year, period.year),
    month: toSafeInteger(row.month, period.month),
    usersCount: toSafeInteger(row.users_count, 0),
    evidenceBytes: toSafeInteger(row.evidence_bytes, 0),
    exportsCount: toSafeInteger(row.exports_count, 0),
    jobsCount: toSafeInteger(row.jobs_count, 0),
    apiCallsCount: toSafeInteger(row.api_calls_count, 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));
};

export const getTenantEvidenceUsageTotal = async (sql, tenantId) => {
  const usageRows = await sql`
    SELECT COALESCE(SUM(evidence_bytes), 0)::bigint AS total
    FROM tenant_usage_monthly
    WHERE tenant_id = ${tenantId}
  `;
  const evidenceRows = await sql`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
    FROM evidence
    WHERE tenant_id = ${tenantId}
  `;
  return Math.max(
    toSafeInteger(usageRows?.[0]?.total, 0),
    toSafeInteger(evidenceRows?.[0]?.total, 0),
  );
};

export const getTenantUsersCount = async (sql, tenantId) => {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM memberships
    WHERE tenant_id = ${tenantId}
  `;
  return toSafeInteger(rows?.[0]?.count, 0);
};

export const getTenantStatus = async (sql, tenantId) => {
  const rows = await sql`
    SELECT tenant_status
    FROM tenants
    WHERE id = ${tenantId}
    LIMIT 1
  `;
  if (!rows?.[0]) {
    return null;
  }
  const value = rows?.[0]?.tenant_status;
  if (value === TENANT_STATUSES.SUSPENDED || value === TENANT_STATUSES.ARCHIVED || value === TENANT_STATUSES.ACTIVE) {
    return value;
  }
  return TENANT_STATUSES.ACTIVE;
};

export const checkEvidenceQuota = async (sql, tenantId, incomingBytes, { isSuperadmin = false } = {}) => {
  const entitlements = await getTenantEntitlements(sql, tenantId);
  const totalEvidenceBytes = await getTenantEvidenceUsageTotal(sql, tenantId);
  const attemptedBytes = Math.max(0, Math.floor(Number(incomingBytes) || 0));
  const projected = totalEvidenceBytes + attemptedBytes;
  const exceeded = projected > (entitlements?.maxEvidenceBytes || 0);
  return {
    allowed: isSuperadmin || !exceeded,
    code: exceeded ? "quota_evidence_exceeded" : null,
    usage: totalEvidenceBytes,
    limit: entitlements?.maxEvidenceBytes || 0,
    projected,
  };
};

export const checkUsersQuota = async (
  sql,
  tenantId,
  { nextUsersCount = null, isSuperadmin = false } = {},
) => {
  const entitlements = await getTenantEntitlements(sql, tenantId);
  const usersCount = nextUsersCount == null ? await getTenantUsersCount(sql, tenantId) : toSafeInteger(nextUsersCount, 0);
  const exceeded = usersCount > (entitlements?.maxUsers || 0);
  return {
    allowed: isSuperadmin || !exceeded,
    code: exceeded ? "quota_users_exceeded" : null,
    usage: usersCount,
    limit: entitlements?.maxUsers || 0,
  };
};

export const checkMonthlyQuota = async (
  sql,
  tenantId,
  metric,
  { increment = 1, isSuperadmin = false, period = getUsagePeriod() } = {},
) => {
  const entitlements = await getTenantEntitlements(sql, tenantId);
  const usage = await getTenantUsageMonth(sql, tenantId, period);
  const safeIncrement = Math.max(0, Math.floor(Number(increment) || 0));

  const config =
    metric === "exports"
      ? {
          usageValue: usage?.exportsCount || 0,
          limitValue: entitlements?.maxExportsPerMonth || 0,
          code: "quota_exports_exceeded",
        }
      : {
          usageValue: usage?.jobsCount || 0,
          limitValue: entitlements?.maxJobsPerMonth || 0,
          code: "quota_jobs_exceeded",
        };

  const projected = config.usageValue + safeIncrement;
  const exceeded = projected > config.limitValue;
  return {
    allowed: isSuperadmin || !exceeded,
    code: exceeded ? config.code : null,
    usage: config.usageValue,
    limit: config.limitValue,
    projected,
    year: period.year,
    month: period.month,
  };
};

export const getTenantQuotaSnapshot = async (sql, tenantId, period = getUsagePeriod()) => {
  const [entitlements, usage] = await Promise.all([
    getTenantEntitlements(sql, tenantId),
    getTenantUsageMonth(sql, tenantId, period),
  ]);
  const totalEvidenceBytes = await getTenantEvidenceUsageTotal(sql, tenantId);

  const evidenceExceeded = totalEvidenceBytes > (entitlements?.maxEvidenceBytes || 0);
  const usersExceeded = (usage?.usersCount || 0) > (entitlements?.maxUsers || 0);
  const exportsExceeded = (usage?.exportsCount || 0) > (entitlements?.maxExportsPerMonth || 0);
  const jobsExceeded = (usage?.jobsCount || 0) > (entitlements?.maxJobsPerMonth || 0);

  return {
    entitlements,
    usage: {
      ...(usage || {
        tenantId,
        year: period.year,
        month: period.month,
        usersCount: 0,
        evidenceBytes: 0,
        exportsCount: 0,
        jobsCount: 0,
        apiCallsCount: 0,
        createdAt: null,
        updatedAt: null,
      }),
      evidenceBytesCumulative: totalEvidenceBytes,
    },
    exceeded: {
      evidence: evidenceExceeded,
      users: usersExceeded,
      exports: exportsExceeded,
      jobs: jobsExceeded,
      any: evidenceExceeded || usersExceeded || exportsExceeded || jobsExceeded,
    },
  };
};

export const ensurePlatformSettings = async (sql, ownerName = "WindwardNexus Labs") => {
  const normalizedOwner = typeof ownerName === "string" && ownerName.trim() ? ownerName.trim() : "WindwardNexus Labs";
  await sql`
    INSERT INTO platform_settings (id, owner_name)
    VALUES (1, ${normalizedOwner})
    ON CONFLICT (id) DO UPDATE SET
      owner_name = COALESCE(NULLIF(TRIM(platform_settings.owner_name), ''), EXCLUDED.owner_name),
      updated_at = NOW()
  `;
};

export const getPlatformSettings = async (sql) => {
  const rows = await sql`
    SELECT id, owner_name, created_at, updated_at
    FROM platform_settings
    WHERE id = 1
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    ownerName: row.owner_name || "WindwardNexus Labs",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};
