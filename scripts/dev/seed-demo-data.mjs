#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  ensureEnterpriseSchema,
  ensureGhgSchema,
  ensureGovernanceSchema,
  ensureMaterialitySchema,
  ensureMetricsSchema,
  ensureSocialSchema,
  ensureStandardsSchema,
  ensureTenantEntitlements,
  getSql,
} from "../../apps/web/app/api/v1/_lib/db.js";
import { hashPassword } from "../../apps/web/app/api/v1/_lib/auth.js";
import { ensureMaterialityDefaults } from "../../apps/web/app/api/v1/_lib/materiality-api.js";

const REQUIRED_CONFIRM = "YES";
export const DEMO_REPORTING_YEARS = [2025, 2026, 2027];
const DEMO_YEAR = 2026;
const DEMO_TAG_KEY = "demo_seed";

const SUPERADMIN_EMAIL = "superadmin@windwardnexus.local";
const TENANT_ADMIN_EMAIL = "admin@demoholding.local";
export const DEMO_SUPERADMIN_PASSWORD = "Windward123!";
export const DEMO_TENANT_ADMIN_PASSWORD = "DemoHolding123!";

const TENANT_NAME = "Demo Holding";
const HOLDING_COMPANY_NAME = "Demo Holding";
const OPERATING_COMPANY_NAME = "Shipyard One";
const SECOND_OPERATING_COMPANY_NAME = "Marine Services GmbH";

const SITE_SEEDS = [
  { name: "Bagnoli", country: "IT", waterStressed: false, companyKey: "shipyard_one" },
  { name: "Torre Annunziata Alfa", country: "IT", waterStressed: true, companyKey: "shipyard_one" },
  { name: "Hamburg Yard", country: "DE", waterStressed: false, companyKey: "marine_services" },
];

const YEAR_PROFILES = {
  2025: {
    electricityMultiplier: 1.08,
    naturalGasMultiplier: 1.06,
    dieselMultiplier: 1.07,
    flightMultiplier: 1.12,
    trainingMultiplier: 0.9,
    incidentValue: 3,
    supplierMultiplier: 0.8,
    workforceMultiplier: 0.96,
    womenManagementDelta: -1,
    boardWomen: 2,
    boardMeetings: 5,
    materiality: {
      E1: { impactSeverity: 5, impactLikelihood: 5, financialMagnitude: 4, financialLikelihood: 4 },
      S1: { impactSeverity: 4, impactLikelihood: 4, financialMagnitude: 3, financialLikelihood: 3 },
      G1: { impactSeverity: 4, impactLikelihood: 3, financialMagnitude: 3, financialLikelihood: 3 },
      GEN1: { impactSeverity: 3, impactLikelihood: 4, financialMagnitude: 3, financialLikelihood: 3 },
    },
  },
  2026: {
    electricityMultiplier: 1,
    naturalGasMultiplier: 1,
    dieselMultiplier: 1,
    flightMultiplier: 1,
    trainingMultiplier: 1,
    incidentValue: 2,
    supplierMultiplier: 1,
    workforceMultiplier: 1,
    womenManagementDelta: 0,
    boardWomen: 3,
    boardMeetings: 6,
    materiality: {
      E1: { impactSeverity: 5, impactLikelihood: 4, financialMagnitude: 5, financialLikelihood: 3 },
      S1: { impactSeverity: 4, impactLikelihood: 4, financialMagnitude: 3, financialLikelihood: 3 },
      G1: { impactSeverity: 4, impactLikelihood: 4, financialMagnitude: 3, financialLikelihood: 3 },
      GEN1: { impactSeverity: 4, impactLikelihood: 4, financialMagnitude: 3, financialLikelihood: 3 },
    },
  },
  2027: {
    electricityMultiplier: 0.93,
    naturalGasMultiplier: 0.92,
    dieselMultiplier: 0.9,
    flightMultiplier: 0.95,
    trainingMultiplier: 1.15,
    incidentValue: 1,
    supplierMultiplier: 1.2,
    workforceMultiplier: 1.03,
    womenManagementDelta: 1,
    boardWomen: 4,
    boardMeetings: 7,
    materiality: {
      E1: { impactSeverity: 4, impactLikelihood: 4, financialMagnitude: 4, financialLikelihood: 3 },
      S1: { impactSeverity: 4, impactLikelihood: 3, financialMagnitude: 3, financialLikelihood: 3 },
      G1: { impactSeverity: 3, impactLikelihood: 3, financialMagnitude: 3, financialLikelihood: 3 },
      GEN1: { impactSeverity: 4, impactLikelihood: 3, financialMagnitude: 3, financialLikelihood: 3 },
    },
  },
};

const FACTOR_SEEDS = [
  {
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    value: 0.23,
    sourceLabel: "DEMO ONLY · IEA starter reference",
    sourceUrl: "https://www.iea.org/data-and-statistics/data-tools/emissions-factors",
  },
  {
    key: "ef_natural_gas_kgco2e_per_mwh",
    unit: "kgCO2e/MWh",
    value: 202,
    sourceLabel: "DEMO ONLY · IPCC starter reference",
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
  },
  {
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.68,
    sourceLabel: "DEMO ONLY · DEFRA starter reference",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
  },
  {
    key: "ef_gasoline_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    value: 2.31,
    sourceLabel: "DEMO ONLY · DEFRA starter reference",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
  },
  {
    key: "ef_refrigerant_kgco2e_per_kg",
    unit: "kgCO2e/kg",
    value: 1430,
    sourceLabel: "DEMO ONLY · IPCC AR6 GWP100 (R134a)",
    sourceUrl: "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_AnnexVII.pdf",
  },
  {
    key: "ef_s3_cat6_flight_kgco2e_per_pax_km",
    unit: "kgCO2e/pax_km",
    value: 0.146,
    sourceLabel: "DEMO ONLY · ICAO/DEFRA starter",
    sourceUrl: "https://www.icao.int/environmental-protection/",
  },
];

const BASE_COUNTRY_OVERRIDE_SEEDS = [
  {
    country: "IT",
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    valueByYear: {
      2025: 0.33,
      2026: 0.29,
      2027: 0.24,
    },
    sourceLabel: "DEMO ONLY · IT electricity location factor",
    sourceUrl: "https://www.iea.org/data-and-statistics/data-tools/emissions-factors",
  },
  {
    country: "DE",
    key: "ef_scope2_location_kgco2e_per_kwh",
    unit: "kgCO2e/kWh",
    valueByYear: {
      2025: 0.41,
      2026: 0.36,
      2027: 0.3,
    },
    sourceLabel: "DEMO ONLY · DE electricity location factor",
    sourceUrl: "https://www.iea.org/data-and-statistics/data-tools/emissions-factors",
  },
  {
    country: "IT",
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    valueByYear: {
      2025: 2.72,
      2026: 2.7,
      2027: 2.66,
    },
    sourceLabel: "DEMO ONLY · IT diesel factor",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
  },
  {
    country: "DE",
    key: "ef_diesel_kgco2e_per_liter",
    unit: "kgCO2e/liter",
    valueByYear: {
      2025: 2.66,
      2026: 2.64,
      2027: 2.61,
    },
    sourceLabel: "DEMO ONLY · DE diesel factor",
    sourceUrl: "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting",
  },
];

const COUNTRY_OVERRIDE_SEEDS = DEMO_REPORTING_YEARS.flatMap((reportingYear) =>
  BASE_COUNTRY_OVERRIDE_SEEDS.map((seed) => ({
    country: seed.country,
    reportingYear,
    key: seed.key,
    unit: seed.unit,
    value: seed.valueByYear?.[reportingYear] ?? seed.value,
    sourceLabel: seed.sourceLabel,
    sourceUrl: seed.sourceUrl,
  })),
);

const WORKFORCE_MONTHS = [1, 2, 3];
const DEFAULT_TIMEOUT_MS = 180000;

const toBool = (value) => value === true;

const logStep = (message) => {
  console.log(`[seed-demo-data] ${message}`);
};

const getYearProfile = (reportingYear) => YEAR_PROFILES[reportingYear] || YEAR_PROFILES[DEMO_YEAR];

const scaleValue = (value, multiplier, precision = 0) => {
  const scaled = Number(value) * Number(multiplier || 1);
  if (precision <= 0) {
    return Math.round(scaled);
  }
  return Number(scaled.toFixed(precision));
};

const ensureEnvGuard = () => {
  if (process.env.APP_ENV !== "local" || process.env.CONFIRM_DEMO_SEED !== REQUIRED_CONFIRM) {
    console.error("Refusing to run demo seed.");
    console.error("Required:");
    console.error("  APP_ENV=local");
    console.error("  CONFIRM_DEMO_SEED=YES");
    console.error("  DATABASE_URL=... (via env/.env.local)");
    console.error("Example:");
    console.error("  APP_ENV=local CONFIRM_DEMO_SEED=YES DATABASE_URL=... node scripts/dev/seed-demo-data.mjs");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
};

const upsertTenantByName = async (sql, name, createdByUserId = null) => {
  const existing = await sql`
    SELECT id, name
    FROM tenants
    WHERE name = ${name}
    LIMIT 1
  `;
  if (existing[0]) {
    return existing[0];
  }

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO tenants (id, name, tenant_status, created_by_user_id, updated_at)
    VALUES (${id}, ${name}, 'active', ${createdByUserId}, NOW())
    RETURNING id, name
  `;
  return rows[0];
};

const upsertUserWithPassword = async (sql, { email, name, platformRole = "none", password }) => {
  const cleanedEmail = String(email || "").trim().toLowerCase();
  const cleanedName = String(name || "").trim() || cleanedEmail;
  const passwordHash = hashPassword(password);
  const existing = await sql`
    SELECT id
    FROM users
    WHERE LOWER(email) = ${cleanedEmail}
    LIMIT 1
  `;
  const userId = existing[0]?.id || randomUUID();
  await sql`
    INSERT INTO users (id, email, name, password_hash, platform_role, updated_at)
    VALUES (${userId}, ${cleanedEmail}, ${cleanedName}, ${passwordHash}, ${platformRole}, NOW())
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          password_hash = EXCLUDED.password_hash,
          platform_role = EXCLUDED.platform_role,
          updated_at = NOW()
  `;
  return { id: userId, email: cleanedEmail };
};

const upsertCompany = async (sql, { tenantId, name, isHolding }) => {
  const rows = await sql`
    INSERT INTO companies (id, tenant_id, name, is_holding, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, ${name}, ${toBool(isHolding)}, NOW())
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET is_holding = EXCLUDED.is_holding,
          updated_at = NOW()
    RETURNING id, tenant_id, name, is_holding
  `;
  return rows[0];
};

const upsertSite = async (sql, { tenantId, companyId, name, country, waterStressed }) => {
  const rows = await sql`
    INSERT INTO sites (id, tenant_id, company_id, name, country, address, water_stressed, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${name}, ${country}, '', ${toBool(waterStressed)}, NOW())
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET company_id = EXCLUDED.company_id,
          country = EXCLUDED.country,
          water_stressed = EXCLUDED.water_stressed,
          updated_at = NOW()
    RETURNING id, tenant_id, company_id, name, country, water_stressed
  `;
  return rows[0];
};

const upsertCompanyProfile = async (sql, { tenantId, companyId, country, region, industryFramework = "GRI", sasbIndustryCode = null }) => {
  await sql`
    INSERT INTO company_profiles (
      tenant_id,
      company_id,
      industry_framework,
      sasb_industry_code,
      gri_profile,
      region,
      country,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${companyId},
      ${industryFramework},
      ${sasbIndustryCode},
      ${JSON.stringify({ sector: "Industrial Products", seeded: true })}::jsonb,
      ${region},
      ${country},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id) DO UPDATE
      SET industry_framework = EXCLUDED.industry_framework,
          sasb_industry_code = EXCLUDED.sasb_industry_code,
          gri_profile = EXCLUDED.gri_profile,
          region = EXCLUDED.region,
          country = EXCLUDED.country,
          updated_at = NOW()
  `;
};

const upsertSiteMetric = async (sql, { tenantId, companyId, siteId, reportingYear, metricKey, value, unit }) => {
  await sql`
    INSERT INTO site_metrics (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      metric_key,
      value,
      unit,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      ${metricKey},
      ${value},
      ${unit},
      NOW()
    )
    ON CONFLICT (tenant_id, site_id, reporting_year, metric_key) DO UPDATE
      SET value = EXCLUDED.value,
          unit = EXCLUDED.unit,
          updated_at = NOW()
  `;
};

const upsertCompanyYearFlags = async (sql, { tenantId, companyId, reportingYear, genderPayGapReported, scope3ScreeningPerformed }) => {
  await sql`
    INSERT INTO company_year_flags (
      tenant_id,
      company_id,
      reporting_year,
      gender_pay_gap_reported,
      scope3_screening_performed,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${companyId},
      ${reportingYear},
      ${toBool(genderPayGapReported)},
      ${toBool(scope3ScreeningPerformed)},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id, reporting_year) DO UPDATE
      SET gender_pay_gap_reported = EXCLUDED.gender_pay_gap_reported,
          scope3_screening_performed = EXCLUDED.scope3_screening_performed,
          updated_at = NOW()
  `;
};

const upsertGovernanceYearly = async (
  sql,
  {
    tenantId,
    companyId,
    reportingYear,
    notes,
    customValues = {},
    boardTotal = 9,
    boardWomen = 3,
    boardIndependent = 4,
    boardMeetings = 6,
  },
) => {
  try {
    const rows = await sql`
      INSERT INTO governance_yearly (
        id,
        tenant_id,
        company_id,
        reporting_year,
        board_total,
        board_women,
        board_independent,
        board_meetings,
        anti_corruption_policy,
        whistleblowing_channel,
        data_privacy_policy,
        supplier_code_of_conduct,
        gdpr_training,
        data_breaches_count,
        corruption_incidents_count,
        fines_amount_eur,
        custom_values,
        notes,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${companyId},
        ${reportingYear},
        ${boardTotal},
        ${boardWomen},
        ${boardIndependent},
        ${boardMeetings},
        TRUE,
        TRUE,
        TRUE,
        TRUE,
        TRUE,
        0,
        0,
        0,
        ${JSON.stringify(customValues)}::jsonb,
        ${notes},
        NOW()
      )
      ON CONFLICT (tenant_id, company_id, reporting_year) DO UPDATE
        SET board_total = EXCLUDED.board_total,
            board_women = EXCLUDED.board_women,
            board_independent = EXCLUDED.board_independent,
            board_meetings = EXCLUDED.board_meetings,
            anti_corruption_policy = EXCLUDED.anti_corruption_policy,
            whistleblowing_channel = EXCLUDED.whistleblowing_channel,
            data_privacy_policy = EXCLUDED.data_privacy_policy,
            supplier_code_of_conduct = EXCLUDED.supplier_code_of_conduct,
            gdpr_training = EXCLUDED.gdpr_training,
            data_breaches_count = EXCLUDED.data_breaches_count,
            corruption_incidents_count = EXCLUDED.corruption_incidents_count,
            fines_amount_eur = EXCLUDED.fines_amount_eur,
            custom_values = EXCLUDED.custom_values,
            notes = EXCLUDED.notes,
            updated_at = NOW()
      RETURNING id
    `;
    return rows[0]?.id || null;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("custom_values")) {
      throw error;
    }

    const rows = await sql`
      INSERT INTO governance_yearly (
        id,
        tenant_id,
        company_id,
        reporting_year,
        board_total,
        board_women,
        board_independent,
        board_meetings,
        anti_corruption_policy,
        whistleblowing_channel,
        data_privacy_policy,
        supplier_code_of_conduct,
        gdpr_training,
        data_breaches_count,
        corruption_incidents_count,
        fines_amount_eur,
        notes,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${companyId},
        ${reportingYear},
        ${boardTotal},
        ${boardWomen},
        ${boardIndependent},
        ${boardMeetings},
        TRUE,
        TRUE,
        TRUE,
        TRUE,
        TRUE,
        0,
        0,
        0,
        ${notes},
        NOW()
      )
      ON CONFLICT (tenant_id, company_id, reporting_year) DO UPDATE
        SET board_total = EXCLUDED.board_total,
            board_women = EXCLUDED.board_women,
            board_independent = EXCLUDED.board_independent,
            board_meetings = EXCLUDED.board_meetings,
            anti_corruption_policy = EXCLUDED.anti_corruption_policy,
            whistleblowing_channel = EXCLUDED.whistleblowing_channel,
            data_privacy_policy = EXCLUDED.data_privacy_policy,
            supplier_code_of_conduct = EXCLUDED.supplier_code_of_conduct,
            gdpr_training = EXCLUDED.gdpr_training,
            data_breaches_count = EXCLUDED.data_breaches_count,
            corruption_incidents_count = EXCLUDED.corruption_incidents_count,
            fines_amount_eur = EXCLUDED.fines_amount_eur,
            notes = EXCLUDED.notes,
            updated_at = NOW()
      RETURNING id
    `;
    return rows[0]?.id || null;
  }
};

const upsertGovernancePolicy = async (sql, { tenantId, companyId, reportingYear, policyKey, status, notes }) => {
  await sql`
    INSERT INTO governance_policies (
      id,
      tenant_id,
      company_id,
      reporting_year,
      policy_key,
      status,
      notes,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${companyId},
      ${reportingYear},
      ${policyKey},
      ${status},
      ${notes},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id, reporting_year, policy_key) DO UPDATE
      SET status = EXCLUDED.status,
          notes = EXCLUDED.notes,
          updated_at = NOW()
  `;
};

const loadTopicIds = async (sql, tenantId, codes) => {
  const rows = await sql`
    SELECT id, code
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
      AND code = ANY(${codes})
  `;
  return new Map(rows.map((row) => [row.code, row.id]));
};

const upsertMaterialitySelection = async (sql, { tenantId, companyId, reportingYear, topicId }) => {
  await sql`
    INSERT INTO materiality_selected_topics (tenant_id, company_id, reporting_year, topic_id, created_at)
    VALUES (${tenantId}, ${companyId}, ${reportingYear}, ${topicId}, NOW())
    ON CONFLICT (tenant_id, company_id, reporting_year, topic_id) DO NOTHING
  `;
};

const upsertMaterialityScore = async (sql, { tenantId, companyId, reportingYear, topicId, impactSeverity, impactScope, impactIrremediability, impactLikelihood, financialMagnitude, financialLikelihood, notes }) => {
  await sql`
    INSERT INTO materiality_scores (
      tenant_id,
      company_id,
      reporting_year,
      topic_id,
      impact_severity,
      impact_scope,
      impact_irremediability,
      impact_likelihood,
      financial_magnitude,
      financial_likelihood,
      notes,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${companyId},
      ${reportingYear},
      ${topicId},
      ${impactSeverity},
      ${impactScope},
      ${impactIrremediability},
      ${impactLikelihood},
      ${financialMagnitude},
      ${financialLikelihood},
      ${notes},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id, reporting_year, topic_id) DO UPDATE
      SET impact_severity = EXCLUDED.impact_severity,
          impact_scope = EXCLUDED.impact_scope,
          impact_irremediability = EXCLUDED.impact_irremediability,
          impact_likelihood = EXCLUDED.impact_likelihood,
          financial_magnitude = EXCLUDED.financial_magnitude,
          financial_likelihood = EXCLUDED.financial_likelihood,
          notes = EXCLUDED.notes,
          updated_at = NOW()
  `;
};

const upsertMembership = async (sql, { userId, tenantId, role = "TenantAdmin" }) => {
  await sql`
    INSERT INTO memberships (user_id, tenant_id, role, created_at)
    VALUES (${userId}, ${tenantId}, ${role}, NOW())
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET role = EXCLUDED.role
  `;
};

const upsertFactor = async (sql, tenantId, seed) => {
  await sql`
    INSERT INTO emission_factors (
      tenant_id,
      key,
      label,
      unit,
      value,
      source,
      source_label,
      source_url,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${seed.key},
      ${seed.key},
      ${seed.unit},
      ${seed.value},
      ${seed.sourceLabel},
      ${seed.sourceLabel},
      ${seed.sourceUrl},
      NOW()
    )
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET unit = EXCLUDED.unit,
          value = EXCLUDED.value,
          source = EXCLUDED.source,
          source_label = EXCLUDED.source_label,
          source_url = EXCLUDED.source_url,
          updated_at = NOW()
  `;
};

const upsertCountryOverride = async (sql, tenantId, seed) => {
  await sql`
    INSERT INTO emission_factor_country_overrides (
      tenant_id,
      country,
      reporting_year,
      key,
      value,
      unit,
      source_label,
      source_url,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${seed.country},
      ${seed.reportingYear},
      ${seed.key},
      ${seed.value},
      ${seed.unit},
      ${seed.sourceLabel},
      ${seed.sourceUrl},
      NOW()
    )
    ON CONFLICT (tenant_id, country, reporting_year, key) DO UPDATE
      SET value = EXCLUDED.value,
          unit = EXCLUDED.unit,
          source_label = EXCLUDED.source_label,
          source_url = EXCLUDED.source_url,
          updated_at = NOW()
  `;
};

const findDefinitionByKey = async (sql, tenantId, key) => {
  const rows = await sql`
    SELECT id, key, method
    FROM ghg_activity_definitions
    WHERE tenant_id = ${tenantId}
      AND key = ${key}
    LIMIT 1
  `;
  return rows[0] || null;
};

const findSocialDefinitionByKey = async (sql, tenantId, key) => {
  const rows = await sql`
    SELECT id, key, method
    FROM social_metric_definitions
    WHERE tenant_id = ${tenantId}
      AND key = ${key}
    LIMIT 1
  `;
  return rows[0] || null;
};

const upsertDemoGhgRecord = async (sql, { tenantId, companyId, siteId, reportingYear, month, activityDefId, quantity, amount, currency, notes, metadata }) => {
  const existing = await sql`
    SELECT id
    FROM ghg_activity_records
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND ((${siteId}::uuid IS NULL AND site_id IS NULL) OR site_id = ${siteId})
      AND reporting_year = ${reportingYear}
      AND ((${month}::int IS NULL AND month IS NULL) OR month = ${month})
      AND activity_def_id = ${activityDefId}
      AND notes = ${notes}
    LIMIT 1
  `;

  const recordId = existing[0]?.id || randomUUID();
  const rows = await sql`
    INSERT INTO ghg_activity_records (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      activity_def_id,
      quantity,
      amount,
      currency,
      direct_tco2e,
      metadata,
      notes,
      updated_at
    )
    VALUES (
      ${recordId},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      ${month},
      ${activityDefId},
      ${quantity},
      ${amount},
      ${currency},
      NULL,
      ${JSON.stringify(metadata || { [DEMO_TAG_KEY]: true })}::jsonb,
      ${notes},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
      SET quantity = EXCLUDED.quantity,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          metadata = EXCLUDED.metadata,
          notes = EXCLUDED.notes,
          updated_at = NOW()
    RETURNING id
  `;

  return rows[0]?.id || recordId;
};

const upsertWorkforce = async (sql, { tenantId, companyId, siteId, reportingYear, month, gender, headcount, hoursWorked }) => {
  await sql`
    INSERT INTO workforce_monthly (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      contract_type,
      gender,
      headcount,
      hours_worked,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      ${month},
      'total',
      ${gender},
      ${headcount},
      ${hoursWorked},
      NOW()
    )
    ON CONFLICT (tenant_id, site_id, reporting_year, month, contract_type, gender) DO UPDATE
      SET headcount = EXCLUDED.headcount,
          hours_worked = EXCLUDED.hours_worked,
          updated_at = NOW()
  `;
};

const upsertLeavers = async (sql, { tenantId, companyId, siteId, reportingYear, month, gender, leavers }) => {
  await sql`
    INSERT INTO workforce_leavers_monthly (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      gender,
      leavers,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      ${month},
      ${gender},
      ${leavers},
      NOW()
    )
    ON CONFLICT (tenant_id, site_id, reporting_year, month, gender) DO UPDATE
      SET leavers = EXCLUDED.leavers,
          updated_at = NOW()
  `;
};

const upsertManagement = async (sql, { tenantId, companyId, siteId, reportingYear, gender, headcount }) => {
  await sql`
    INSERT INTO management_headcount_yearly (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      gender,
      headcount,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      ${gender},
      ${headcount},
      NOW()
    )
    ON CONFLICT (tenant_id, site_id, reporting_year, gender) DO UPDATE
      SET headcount = EXCLUDED.headcount,
          updated_at = NOW()
  `;
};

const upsertSocialRecord = async (sql, { tenantId, companyId, siteId, reportingYear, metricDefId, value, notes }) => {
  const existing = await sql`
    SELECT id
    FROM social_records
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND ((${siteId}::uuid IS NULL AND site_id IS NULL) OR site_id = ${siteId})
      AND reporting_year = ${reportingYear}
      AND month IS NULL
      AND metric_def_id = ${metricDefId}
      AND notes = ${notes}
    LIMIT 1
  `;

  const recordId = existing[0]?.id || randomUUID();
  const rows = await sql`
    INSERT INTO social_records (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      metric_def_id,
      value,
      metadata,
      notes,
      updated_at
    )
    VALUES (
      ${recordId},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${reportingYear},
      NULL,
      ${metricDefId},
      ${value},
      ${JSON.stringify({ [DEMO_TAG_KEY]: true, source: "seed-demo-data" })}::jsonb,
      ${notes},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
      SET value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          notes = EXCLUDED.notes,
          updated_at = NOW()
    RETURNING id
  `;

  return rows[0]?.id || recordId;
};

const upsertEvidence = async (sql, { tenantId, siteId, filename, blobUrl }) => {
  const existing = await sql`
    SELECT id
    FROM evidence
    WHERE tenant_id = ${tenantId}
      AND filename = ${filename}
      AND blob_url = ${blobUrl}
    LIMIT 1
  `;

  if (existing[0]?.id) {
    return existing[0].id;
  }

  const rows = await sql`
    INSERT INTO evidence (
      id,
      tenant_id,
      site_id,
      filename,
      content_type,
      size_bytes,
      sha256,
      blob_url,
      created_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${siteId},
      ${filename},
      'application/pdf',
      0,
      NULL,
      ${blobUrl},
      NOW()
    )
    RETURNING id
  `;

  return rows[0].id;
};

const ensureEntityEvidenceLink = async (sql, { tenantId, entityType, entityId, evidenceId }) => {
  await sql`
    INSERT INTO entity_evidence (tenant_id, entity_type, entity_id, evidence_id, created_at)
    VALUES (${tenantId}, ${entityType}, ${entityId}, ${evidenceId}, NOW())
    ON CONFLICT (tenant_id, entity_type, entity_id, evidence_id) DO NOTHING
  `;
};

export const seedDemoData = async ({ sql, skipEnsureSchemas = false } = {}) => {
  if (!skipEnsureSchemas) {
    logStep("ensuring schemas");
    await ensureEnterpriseSchema();
    await ensureGhgSchema();
    await ensureGovernanceSchema();
    await ensureMaterialitySchema();
    await ensureMetricsSchema();
    await ensureSocialSchema();
    await ensureStandardsSchema();
  }

  const superUser = await upsertUserWithPassword(sql, {
    email: SUPERADMIN_EMAIL,
    name: "Platform Superadmin",
    platformRole: "superadmin",
    password: DEMO_SUPERADMIN_PASSWORD,
  });
  const tenantAdminUser = await upsertUserWithPassword(sql, {
    email: TENANT_ADMIN_EMAIL,
    name: "Demo Holding Admin",
    platformRole: "none",
    password: DEMO_TENANT_ADMIN_PASSWORD,
  });

  const tenant = await upsertTenantByName(sql, TENANT_NAME, superUser?.id || null);
  await ensureTenantEntitlements(sql, tenant.id);
  if (!skipEnsureSchemas) {
    logStep("ensuring materiality defaults");
    await ensureMaterialityDefaults({ sql, tenantId: tenant.id });
  }

  await upsertMembership(sql, { userId: superUser.id, tenantId: tenant.id, role: "TenantAdmin" });
  await upsertMembership(sql, { userId: tenantAdminUser.id, tenantId: tenant.id, role: "TenantAdmin" });

  const holdingCompany = await upsertCompany(sql, {
    tenantId: tenant.id,
    name: HOLDING_COMPANY_NAME,
    isHolding: true,
  });
  const operatingCompany = await upsertCompany(sql, {
    tenantId: tenant.id,
    name: OPERATING_COMPANY_NAME,
    isHolding: false,
  });
  const secondOperatingCompany = await upsertCompany(sql, {
    tenantId: tenant.id,
    name: SECOND_OPERATING_COMPANY_NAME,
    isHolding: false,
  });

  await upsertCompanyProfile(sql, {
    tenantId: tenant.id,
    companyId: holdingCompany.id,
    country: "IT",
    region: "EU",
    sasbIndustryCode: "RT-IG",
  });
  await upsertCompanyProfile(sql, {
    tenantId: tenant.id,
    companyId: operatingCompany.id,
    country: "IT",
    region: "EU",
    sasbIndustryCode: "RT-IG",
  });
  await upsertCompanyProfile(sql, {
    tenantId: tenant.id,
    companyId: secondOperatingCompany.id,
    country: "DE",
    region: "EU",
    sasbIndustryCode: "RT-IG",
  });

  const sites = [];
  const companyBySeedKey = {
    shipyard_one: operatingCompany.id,
    marine_services: secondOperatingCompany.id,
  };
  for (const siteSeed of SITE_SEEDS) {
    // eslint-disable-next-line no-await-in-loop
    const site = await upsertSite(sql, {
      tenantId: tenant.id,
      companyId: companyBySeedKey[siteSeed.companyKey] || operatingCompany.id,
      name: siteSeed.name,
      country: siteSeed.country,
      waterStressed: siteSeed.waterStressed,
    });
    sites.push(site);
  }
  logStep(`tenant structure ready: ${1 + 2} companies, ${sites.length} sites`);

  for (const factorSeed of FACTOR_SEEDS) {
    // eslint-disable-next-line no-await-in-loop
    await upsertFactor(sql, tenant.id, factorSeed);
  }
  for (const overrideSeed of COUNTRY_OVERRIDE_SEEDS) {
    // eslint-disable-next-line no-await-in-loop
    await upsertCountryOverride(sql, tenant.id, overrideSeed);
  }
  logStep(`factors ready: ${FACTOR_SEEDS.length} tenant defaults, ${COUNTRY_OVERRIDE_SEEDS.length} country overrides`);

  const bagnoli = sites.find((item) => item.name === "Bagnoli");
  const torre = sites.find((item) => item.name === "Torre Annunziata Alfa");
  const hamburg = sites.find((item) => item.name === "Hamburg Yard");

  const siteMetricSeeds = [
    { site: bagnoli, companyId: operatingCompany.id, metricKey: "electricity_kwh", value: 185000, unit: "kWh" },
    { site: bagnoli, companyId: operatingCompany.id, metricKey: "renewable_electricity_kwh", value: 25000, unit: "kWh" },
    { site: bagnoli, companyId: operatingCompany.id, metricKey: "natural_gas_mwh", value: 92, unit: "MWh" },
    { site: bagnoli, companyId: operatingCompany.id, metricKey: "water_withdrawal_m3", value: 4200, unit: "m3" },
    { site: bagnoli, companyId: operatingCompany.id, metricKey: "water_discharge_m3", value: 3960, unit: "m3" },
    { site: torre, companyId: operatingCompany.id, metricKey: "electricity_kwh", value: 132000, unit: "kWh" },
    { site: torre, companyId: operatingCompany.id, metricKey: "diesel_liters", value: 980, unit: "liters" },
    { site: torre, companyId: operatingCompany.id, metricKey: "waste_generated_tons", value: 18, unit: "tons" },
    { site: torre, companyId: operatingCompany.id, metricKey: "waste_recycled_tons", value: 9, unit: "tons" },
    { site: hamburg, companyId: secondOperatingCompany.id, metricKey: "electricity_kwh", value: 225000, unit: "kWh" },
    { site: hamburg, companyId: secondOperatingCompany.id, metricKey: "renewable_electricity_kwh", value: 40000, unit: "kWh" },
    { site: hamburg, companyId: secondOperatingCompany.id, metricKey: "water_withdrawal_m3", value: 2100, unit: "m3" },
  ].filter((item) => item.site?.id);

  for (const reportingYear of DEMO_REPORTING_YEARS) {
    const profile = getYearProfile(reportingYear);
    for (const metricSeed of siteMetricSeeds) {
      let multiplier = 1;
      if (metricSeed.metricKey.includes("electricity")) {
        multiplier = profile.electricityMultiplier;
      } else if (metricSeed.metricKey.includes("natural_gas")) {
        multiplier = profile.naturalGasMultiplier;
      } else if (metricSeed.metricKey.includes("diesel")) {
        multiplier = profile.dieselMultiplier;
      } else if (metricSeed.metricKey.includes("water")) {
        multiplier = 1 + (reportingYear - DEMO_YEAR) * 0.02;
      } else if (metricSeed.metricKey.includes("waste")) {
        multiplier = 1 + (reportingYear - DEMO_YEAR) * 0.04;
      }
      // eslint-disable-next-line no-await-in-loop
      await upsertSiteMetric(sql, {
        tenantId: tenant.id,
        companyId: metricSeed.companyId,
        siteId: metricSeed.site.id,
        reportingYear,
        metricKey: metricSeed.metricKey,
        value: scaleValue(metricSeed.value, multiplier),
        unit: metricSeed.unit,
      });
    }
  }
  logStep(`environment metrics ready: ${siteMetricSeeds.length * DEMO_REPORTING_YEARS.length} rows`);

  const dieselDef = await findDefinitionByKey(sql, tenant.id, "s1_mobile_diesel_liters");
  const electricityDef = await findDefinitionByKey(sql, tenant.id, "s2_purchased_electricity_location_kwh");
  const flightsDef = await findDefinitionByKey(sql, tenant.id, "s3_cat6_flights_pax_km");

  if (!dieselDef || !electricityDef || !flightsDef) {
    throw new Error("Missing required GHG definitions for demo seed.");
  }

  const ghgRecordIds = [];
  const ghgRecordByYear = new Map();
  for (const reportingYear of DEMO_REPORTING_YEARS) {
    const profile = getYearProfile(reportingYear);
    const yearRecordIds = [];
    // eslint-disable-next-line no-await-in-loop
    yearRecordIds.push(await upsertDemoGhgRecord(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      siteId: bagnoli?.id || null,
      reportingYear,
      month: 1,
      activityDefId: dieselDef.id,
      quantity: scaleValue(1250, profile.dieselMultiplier),
      amount: null,
      currency: null,
      notes: `DEMO_SEED::${reportingYear}::s1-diesel-bagnoli`,
      metadata: { [DEMO_TAG_KEY]: true, demo_year: reportingYear, transport_mode: "road" },
    }));
    // eslint-disable-next-line no-await-in-loop
    yearRecordIds.push(await upsertDemoGhgRecord(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      siteId: torre?.id || null,
      reportingYear,
      month: 2,
      activityDefId: dieselDef.id,
      quantity: scaleValue(980, profile.dieselMultiplier),
      amount: null,
      currency: null,
      notes: `DEMO_SEED::${reportingYear}::s1-diesel-torre`,
      metadata: { [DEMO_TAG_KEY]: true, demo_year: reportingYear, transport_mode: "road" },
    }));
    // eslint-disable-next-line no-await-in-loop
    yearRecordIds.push(await upsertDemoGhgRecord(sql, {
      tenantId: tenant.id,
      companyId: secondOperatingCompany.id,
      siteId: hamburg?.id || null,
      reportingYear,
      month: 2,
      activityDefId: electricityDef.id,
      quantity: scaleValue(225000, profile.electricityMultiplier),
      amount: null,
      currency: null,
      notes: `DEMO_SEED::${reportingYear}::s2-electricity-hamburg`,
      metadata: { [DEMO_TAG_KEY]: true, demo_year: reportingYear, market_instrument: "grid" },
    }));
    // eslint-disable-next-line no-await-in-loop
    yearRecordIds.push(await upsertDemoGhgRecord(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      siteId: null,
      reportingYear,
      month: 3,
      activityDefId: flightsDef.id,
      quantity: scaleValue(180000, profile.flightMultiplier),
      amount: null,
      currency: null,
      notes: `DEMO_SEED::${reportingYear}::s3-cat6-flights`,
      metadata: { [DEMO_TAG_KEY]: true, demo_year: reportingYear, flight_class: "economy" },
    }));
    ghgRecordByYear.set(reportingYear, yearRecordIds[0] || null);
    ghgRecordIds.push(...yearRecordIds);
  }
  logStep(`ghg records ready: ${ghgRecordIds.length} rows`);

  for (const reportingYear of DEMO_REPORTING_YEARS) {
    const profile = getYearProfile(reportingYear);
    for (const month of WORKFORCE_MONTHS) {
      // eslint-disable-next-line no-await-in-loop
      await upsertWorkforce(sql, {
        tenantId: tenant.id,
        companyId: operatingCompany.id,
        siteId: bagnoli.id,
        reportingYear,
        month,
        gender: "M",
        headcount: scaleValue(month === 1 ? 44 : month === 2 ? 45 : 46, profile.workforceMultiplier),
        hoursWorked: scaleValue(month === 1 ? 7300 : month === 2 ? 7420 : 7560, profile.workforceMultiplier),
      });
      // eslint-disable-next-line no-await-in-loop
      await upsertWorkforce(sql, {
        tenantId: tenant.id,
        companyId: operatingCompany.id,
        siteId: bagnoli.id,
        reportingYear,
        month,
        gender: "F",
        headcount: scaleValue(month === 1 ? 20 : month === 2 ? 21 : 21, profile.workforceMultiplier),
        hoursWorked: scaleValue(month === 1 ? 3350 : month === 2 ? 3470 : 3520, profile.workforceMultiplier),
      });
      // eslint-disable-next-line no-await-in-loop
      await upsertWorkforce(sql, {
        tenantId: tenant.id,
        companyId: operatingCompany.id,
        siteId: bagnoli.id,
        reportingYear,
        month,
        gender: "D",
        headcount: 1,
        hoursWorked: 160,
      });
    }

    // eslint-disable-next-line no-await-in-loop
    await upsertLeavers(sql, { tenantId: tenant.id, companyId: operatingCompany.id, siteId: bagnoli.id, reportingYear, month: 2, gender: "M", leavers: reportingYear === 2025 ? 2 : 1 });
    // eslint-disable-next-line no-await-in-loop
    await upsertLeavers(sql, { tenantId: tenant.id, companyId: operatingCompany.id, siteId: bagnoli.id, reportingYear, month: 2, gender: "F", leavers: reportingYear === 2027 ? 0 : 1 });
    // eslint-disable-next-line no-await-in-loop
    await upsertLeavers(sql, { tenantId: tenant.id, companyId: operatingCompany.id, siteId: bagnoli.id, reportingYear, month: 2, gender: "D", leavers: 0 });

    // eslint-disable-next-line no-await-in-loop
    await upsertManagement(sql, { tenantId: tenant.id, companyId: operatingCompany.id, siteId: bagnoli.id, reportingYear, gender: "M", headcount: 6 });
    // eslint-disable-next-line no-await-in-loop
    await upsertManagement(sql, { tenantId: tenant.id, companyId: operatingCompany.id, siteId: bagnoli.id, reportingYear, gender: "F", headcount: 3 + profile.womenManagementDelta });
    // eslint-disable-next-line no-await-in-loop
    await upsertManagement(sql, { tenantId: tenant.id, companyId: operatingCompany.id, siteId: bagnoli.id, reportingYear, gender: "D", headcount: 0 });
  }

  const trainingDef = await findSocialDefinitionByKey(sql, tenant.id, "s_training_hours_total");
  const incidentsDef = await findSocialDefinitionByKey(sql, tenant.id, "s_hs_total_recordable_incidents");
  const supplierDef = await findSocialDefinitionByKey(sql, tenant.id, "s_supplier_screened_count");

  if (!trainingDef || !incidentsDef || !supplierDef) {
    throw new Error("Missing required social metric definitions for demo seed.");
  }

  const socialRecordIds = [];
  const socialRecordByYear = new Map();
  const governanceByYear = new Map();
  for (const reportingYear of DEMO_REPORTING_YEARS) {
    const profile = getYearProfile(reportingYear);
    const yearSocialIds = [];
    // eslint-disable-next-line no-await-in-loop
    yearSocialIds.push(await upsertSocialRecord(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      siteId: bagnoli.id,
      reportingYear,
      metricDefId: trainingDef.id,
      value: scaleValue(420, profile.trainingMultiplier),
      notes: `DEMO_SEED::${reportingYear}::training-hours-q1`,
    }));
    // eslint-disable-next-line no-await-in-loop
    yearSocialIds.push(await upsertSocialRecord(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      siteId: bagnoli.id,
      reportingYear,
      metricDefId: incidentsDef.id,
      value: profile.incidentValue,
      notes: `DEMO_SEED::${reportingYear}::recordable-incidents-q1`,
    }));
    // eslint-disable-next-line no-await-in-loop
    yearSocialIds.push(await upsertSocialRecord(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      siteId: null,
      reportingYear,
      metricDefId: supplierDef.id,
      value: scaleValue(34, profile.supplierMultiplier),
      notes: `DEMO_SEED::${reportingYear}::supplier-screened-count`,
    }));
    socialRecordByYear.set(reportingYear, yearSocialIds[0] || null);
    socialRecordIds.push(...yearSocialIds);

    // eslint-disable-next-line no-await-in-loop
    await upsertCompanyYearFlags(sql, { tenantId: tenant.id, companyId: operatingCompany.id, reportingYear, genderPayGapReported: true, scope3ScreeningPerformed: true });
    // eslint-disable-next-line no-await-in-loop
    await upsertCompanyYearFlags(sql, { tenantId: tenant.id, companyId: secondOperatingCompany.id, reportingYear, genderPayGapReported: true, scope3ScreeningPerformed: true });

    // eslint-disable-next-line no-await-in-loop
    const governanceId = await upsertGovernanceYearly(sql, {
      tenantId: tenant.id,
      companyId: operatingCompany.id,
      reportingYear,
      notes: `DEMO_SEED::${reportingYear}::governance-yearly`,
      boardWomen: profile.boardWomen,
      boardMeetings: profile.boardMeetings,
      customValues: {
        board_skill_matrix: "shipping, procurement, HSE",
        boardWomenTarget: profile.boardWomen,
        boardMeetingsTarget: profile.boardMeetings,
        [DEMO_TAG_KEY]: true,
      },
    });
    governanceByYear.set(reportingYear, governanceId);
    // eslint-disable-next-line no-await-in-loop
    await upsertGovernancePolicy(sql, { tenantId: tenant.id, companyId: operatingCompany.id, reportingYear, policyKey: "anti_corruption", status: "yes", notes: `DEMO_SEED::${reportingYear}::anti-corruption-policy` });
    // eslint-disable-next-line no-await-in-loop
    await upsertGovernancePolicy(sql, { tenantId: tenant.id, companyId: operatingCompany.id, reportingYear, policyKey: "whistleblowing", status: "yes", notes: `DEMO_SEED::${reportingYear}::whistleblowing-policy` });
  }
  logStep(`social records ready: ${socialRecordIds.length} rows`);

  const materialityTopicIds = await loadTopicIds(sql, tenant.id, ["E1", "S1", "G1", "GEN1"]);
  for (const reportingYear of DEMO_REPORTING_YEARS) {
    const profile = getYearProfile(reportingYear);
    for (const code of ["E1", "S1", "G1", "GEN1"]) {
      const topicId = materialityTopicIds.get(code);
      if (!topicId) {
        continue;
      }
      const materialityProfile = profile.materiality?.[code] || profile.materiality?.GEN1 || {};
      // eslint-disable-next-line no-await-in-loop
      await upsertMaterialitySelection(sql, {
        tenantId: tenant.id,
        companyId: operatingCompany.id,
        reportingYear,
        topicId,
      });
      // eslint-disable-next-line no-await-in-loop
      await upsertMaterialityScore(sql, {
        tenantId: tenant.id,
        companyId: operatingCompany.id,
        reportingYear,
        topicId,
        impactSeverity: materialityProfile.impactSeverity || 4,
        impactScope: 4,
        impactIrremediability: 3,
        impactLikelihood: materialityProfile.impactLikelihood || 4,
        financialMagnitude: materialityProfile.financialMagnitude || 3,
        financialLikelihood: materialityProfile.financialLikelihood || 3,
        notes: `DEMO_SEED::${reportingYear}::materiality-${code.toLowerCase()}`,
      });
    }
  }
  logStep("governance, company flags, and materiality ready");

  const evidenceIds = [];
  for (const reportingYear of DEMO_REPORTING_YEARS) {
    // eslint-disable-next-line no-await-in-loop
    const evidenceA = await upsertEvidence(sql, {
      tenantId: tenant.id,
      siteId: bagnoli.id,
      filename: `demo-${reportingYear}.pdf`,
      blobUrl: `https://example.com/demo-${reportingYear}.pdf`,
    });
    // eslint-disable-next-line no-await-in-loop
    const evidenceB = await upsertEvidence(sql, {
      tenantId: tenant.id,
      siteId: bagnoli.id,
      filename: `invoice-${reportingYear}.pdf`,
      blobUrl: `https://example.com/invoice-${reportingYear}.pdf`,
    });
    evidenceIds.push(evidenceA, evidenceB);
    if (ghgRecordByYear.get(reportingYear)) {
      // eslint-disable-next-line no-await-in-loop
      await ensureEntityEvidenceLink(sql, { tenantId: tenant.id, entityType: "ghg_record", entityId: ghgRecordByYear.get(reportingYear), evidenceId: evidenceA });
    }
    if (socialRecordByYear.get(reportingYear)) {
      // eslint-disable-next-line no-await-in-loop
      await ensureEntityEvidenceLink(sql, { tenantId: tenant.id, entityType: "social_record", entityId: socialRecordByYear.get(reportingYear), evidenceId: evidenceB });
    }
    if (governanceByYear.get(reportingYear)) {
      // eslint-disable-next-line no-await-in-loop
      await ensureEntityEvidenceLink(sql, { tenantId: tenant.id, entityType: "governance_yearly", entityId: governanceByYear.get(reportingYear), evidenceId: evidenceA });
    }
  }
  logStep("evidence links ready");

  return {
    tenantId: tenant.id,
    companies: {
      holding: holdingCompany,
      operating: operatingCompany,
      operatingSecondary: secondOperatingCompany,
    },
    sites,
    ghgRecordIds,
    socialRecordIds,
    evidenceIds,
  };
};

const main = async () => {
  ensureEnvGuard();
  const sql = getSql();
  const timeoutMsRaw = Number.parseInt(String(process.env.DEMO_SEED_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10);
  const timeoutMs = Number.isInteger(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : DEFAULT_TIMEOUT_MS;
  const skipEnsureSchemas = String(process.env.DEMO_SEED_SKIP_ENSURE || "").trim() === "1";
  const startedAt = Date.now();
  const watchdog = setTimeout(() => {
    console.error(`[seed-demo-data] timed out after ${timeoutMs}ms`);
    process.exit(1);
  }, timeoutMs);

  const result = await seedDemoData({ sql, skipEnsureSchemas });
  clearTimeout(watchdog);

  const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

  console.log("✅ Demo seed completed (idempotent).");
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  console.log(`Schema ensure: ${skipEnsureSchemas ? "skipped" : "enabled"}`);
  console.log(`Tenant: ${TENANT_NAME} (${result.tenantId})`);
  console.log("Companies:");
  console.log(`  - ${result.companies.holding.name} (${result.companies.holding.id}) [holding]`);
  console.log(`  - ${result.companies.operating.name} (${result.companies.operating.id}) [operating]`);
  console.log(`  - ${result.companies.operatingSecondary.name} (${result.companies.operatingSecondary.id}) [operating]`);
  console.log("Sites:");
  for (const site of result.sites) {
    console.log(`  - ${site.name} (${site.id}) country=${site.country || "n/a"} waterStressed=${site.water_stressed}`);
  }
  console.log("Dataset coverage:");
  console.log("  - environment metrics: seeded");
  console.log("  - ghg records: scope1/scope2/scope3 seeded");
  console.log("  - social records: seeded");
  console.log("  - governance: seeded");
  console.log("  - materiality: seeded where default topics are available");
  console.log("GHG record IDs:", result.ghgRecordIds.join(", "));
  console.log("Social record IDs:", result.socialRecordIds.join(", "));
  console.log("Evidence IDs:", result.evidenceIds.join(", "));
  console.log("");
  console.log("Open locally:");
  console.log(`  ${baseUrl}/login`);
  console.log(`  ${baseUrl}/app/ghg`);
  console.log(`  ${baseUrl}/app/emissions`);
  console.log(`  ${baseUrl}/app/social`);
  console.log(`  ${baseUrl}/app/evidence`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("seed-demo-data failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
