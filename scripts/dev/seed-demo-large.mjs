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
  getSql,
} from "../../apps/web/app/api/v1/_lib/db.js";
import { DEMO_REPORTING_YEARS, seedDemoData } from "./seed-demo-data.mjs";

const REQUIRED_CONFIRM = "YES";
const TENANT_NAME = "Demo Holding";
const TIMEOUT_MS = 300000;
const SKIP_ENSURE = String(process.env.DEMO_SEED_LARGE_SKIP_ENSURE || "").trim() === "1";

const EXTRA_COMPANIES = [
  { name: "Atlantic Logistics BV", country: "NL", region: "Europe" },
  { name: "Iberia Retrofit SL", country: "ES", region: "Europe" },
  { name: "Nordics Propulsion AB", country: "SE", region: "Europe" },
  { name: "Adriatic Ferries d.o.o.", country: "HR", region: "Europe" },
  { name: "Baltic Components UAB", country: "LT", region: "Europe" },
  { name: "Tyrrhenian Services SpA", country: "IT", region: "Europe" },
];

const EXTRA_SITES = [
  { companyName: "Atlantic Logistics BV", name: "Rotterdam Logistics Hub", country: "NL", waterStressed: false },
  { companyName: "Atlantic Logistics BV", name: "Antwerp Terminal", country: "BE", waterStressed: false },
  { companyName: "Atlantic Logistics BV", name: "Bremen Dispatch", country: "DE", waterStressed: false },
  { companyName: "Iberia Retrofit SL", name: "Cadiz Retrofit Yard", country: "ES", waterStressed: true },
  { companyName: "Iberia Retrofit SL", name: "Bilbao Dry Dock", country: "ES", waterStressed: false },
  { companyName: "Iberia Retrofit SL", name: "Lisbon Service Pier", country: "PT", waterStressed: false },
  { companyName: "Nordics Propulsion AB", name: "Gothenburg Assembly", country: "SE", waterStressed: false },
  { companyName: "Nordics Propulsion AB", name: "Oslo Retrofit Lab", country: "NO", waterStressed: false },
  { companyName: "Nordics Propulsion AB", name: "Turku Marine Systems", country: "FI", waterStressed: false },
  { companyName: "Adriatic Ferries d.o.o.", name: "Rijeka Ferry Ops", country: "HR", waterStressed: false },
  { companyName: "Adriatic Ferries d.o.o.", name: "Split Passenger Terminal", country: "HR", waterStressed: true },
  { companyName: "Adriatic Ferries d.o.o.", name: "Koper Support Base", country: "SI", waterStressed: false },
  { companyName: "Baltic Components UAB", name: "Klaipeda Systems Port", country: "LT", waterStressed: false },
  { companyName: "Baltic Components UAB", name: "Riga Spare Parts Hub", country: "LV", waterStressed: false },
  { companyName: "Baltic Components UAB", name: "Tallinn Cold Dock", country: "EE", waterStressed: false },
  { companyName: "Tyrrhenian Services SpA", name: "Naples Passenger Services", country: "IT", waterStressed: true },
  { companyName: "Tyrrhenian Services SpA", name: "Cagliari Support Yard", country: "IT", waterStressed: true },
  { companyName: "Tyrrhenian Services SpA", name: "Palermo Marine Workshop", country: "IT", waterStressed: false },
];

const logStep = (message) => console.log(`[seed-demo-large] ${message}`);
const toBool = (value) => value === true;
const scaleValue = (value, multiplier) => Math.round(Number(value) * Number(multiplier || 1));
const yearMultiplier = (reportingYear) => {
  if (reportingYear === 2025) return 1.08;
  if (reportingYear === 2027) return 0.94;
  return 1;
};

const ensureEnvGuard = () => {
  if (process.env.APP_ENV !== "local" || process.env.CONFIRM_DEMO_SEED_LARGE !== REQUIRED_CONFIRM) {
    console.error("Refusing to run large demo seed.");
    console.error("Required:");
    console.error("  APP_ENV=local");
    console.error("  CONFIRM_DEMO_SEED_LARGE=YES");
    console.error("  DATABASE_URL=...");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
};

const upsertCompany = async (sql, { tenantId, name, country }) => {
  const rows = await sql`
    INSERT INTO companies (id, tenant_id, name, country, is_holding, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, ${name}, ${country}, FALSE, NOW())
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET country = EXCLUDED.country,
          updated_at = NOW()
    RETURNING id, name, country
  `;
  return rows[0];
};

const upsertCompanyProfile = async (sql, { tenantId, companyId, country, region }) => {
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
      'GRI',
      NULL,
      ${JSON.stringify({ sector: "Industrial Products", seeded: true, dataset: "large" })}::jsonb,
      ${region},
      ${country},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id) DO UPDATE
      SET gri_profile = EXCLUDED.gri_profile,
          region = EXCLUDED.region,
          country = EXCLUDED.country,
          updated_at = NOW()
  `;
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
    RETURNING id, company_id, name, country
  `;
  return rows[0];
};

const upsertSiteMetric = async (sql, { tenantId, companyId, siteId, reportingYear, metricKey, value, unit }) => {
  await sql`
    INSERT INTO site_metrics (id, tenant_id, company_id, site_id, reporting_year, metric_key, value, unit, updated_at)
    VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${siteId}, ${reportingYear}, ${metricKey}, ${value}, ${unit}, NOW())
    ON CONFLICT (tenant_id, site_id, reporting_year, metric_key) DO UPDATE
      SET value = EXCLUDED.value,
          unit = EXCLUDED.unit,
          updated_at = NOW()
  `;
};

const upsertCompanyYearFlags = async (sql, { tenantId, companyId, reportingYear }) => {
  await sql`
    INSERT INTO company_year_flags (
      tenant_id,
      company_id,
      reporting_year,
      gender_pay_gap_reported,
      scope3_screening_performed,
      updated_at
    )
    VALUES (${tenantId}, ${companyId}, ${reportingYear}, TRUE, TRUE, NOW())
    ON CONFLICT (tenant_id, company_id, reporting_year) DO UPDATE
      SET gender_pay_gap_reported = EXCLUDED.gender_pay_gap_reported,
          scope3_screening_performed = EXCLUDED.scope3_screening_performed,
          updated_at = NOW()
  `;
};

const upsertGovernanceYearly = async (sql, { tenantId, companyId, reportingYear, notes, boardWomen = 3, boardMeetings = 8 }) => {
  try {
    await sql`
      INSERT INTO governance_yearly (
        id, tenant_id, company_id, reporting_year, board_total, board_women, board_independent, board_meetings,
        anti_corruption_policy, whistleblowing_channel, data_privacy_policy, supplier_code_of_conduct, gdpr_training,
        data_breaches_count, corruption_incidents_count, fines_amount_eur, custom_values, notes, updated_at
      )
      VALUES (
        ${randomUUID()}, ${tenantId}, ${companyId}, ${reportingYear}, 7, ${boardWomen}, 3, ${boardMeetings},
        TRUE, TRUE, TRUE, TRUE, TRUE,
        0, 0, 0, ${JSON.stringify({ seeded_large: true })}::jsonb, ${notes}, NOW()
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
            custom_values = EXCLUDED.custom_values,
            notes = EXCLUDED.notes,
            updated_at = NOW()
    `;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("custom_values")) {
      throw error;
    }
    await sql`
      INSERT INTO governance_yearly (
        id, tenant_id, company_id, reporting_year, board_total, board_women, board_independent, board_meetings,
        anti_corruption_policy, whistleblowing_channel, data_privacy_policy, supplier_code_of_conduct, gdpr_training,
        data_breaches_count, corruption_incidents_count, fines_amount_eur, notes, updated_at
      )
      VALUES (
        ${randomUUID()}, ${tenantId}, ${companyId}, ${reportingYear}, 7, ${boardWomen}, 3, ${boardMeetings},
        TRUE, TRUE, TRUE, TRUE, TRUE,
        0, 0, 0, ${notes}, NOW()
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
            notes = EXCLUDED.notes,
            updated_at = NOW()
    `;
  }
};

const upsertGhgRecord = async (sql, { tenantId, companyId, siteId, reportingYear, activityDefId, quantity, amount, currency, notes }) => {
  const existing = await sql`
    SELECT id
    FROM ghg_activity_records
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND ((${siteId}::uuid IS NULL AND site_id IS NULL) OR site_id = ${siteId})
      AND reporting_year = ${reportingYear}
      AND activity_def_id = ${activityDefId}
      AND notes = ${notes}
    LIMIT 1
  `;
  const id = existing[0]?.id || randomUUID();
  const rows = await sql`
    INSERT INTO ghg_activity_records (
      id, tenant_id, company_id, site_id, reporting_year, month, activity_def_id,
      quantity, amount, currency, direct_tco2e, metadata, notes, updated_at
    )
    VALUES (
      ${id}, ${tenantId}, ${companyId}, ${siteId}, ${reportingYear}, NULL, ${activityDefId},
      ${quantity}, ${amount}, ${currency}, NULL, ${JSON.stringify({ seeded_large: true })}::jsonb, ${notes}, NOW()
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
  return rows[0]?.id || id;
};

const upsertWorkforce = async (sql, { tenantId, companyId, siteId, reportingYear, month, gender, headcount, hoursWorked }) => {
  await sql`
    INSERT INTO workforce_monthly (
      id, tenant_id, company_id, site_id, reporting_year, month, contract_type, gender, headcount, hours_worked, updated_at
    )
    VALUES (
      ${randomUUID()}, ${tenantId}, ${companyId}, ${siteId}, ${reportingYear}, ${month}, 'total', ${gender}, ${headcount}, ${hoursWorked}, NOW()
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
      id, tenant_id, company_id, site_id, reporting_year, month, gender, leavers, updated_at
    )
    VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${siteId}, ${reportingYear}, ${month}, ${gender}, ${leavers}, NOW())
    ON CONFLICT (tenant_id, site_id, reporting_year, month, gender) DO UPDATE
      SET leavers = EXCLUDED.leavers,
          updated_at = NOW()
  `;
};

const upsertManagement = async (sql, { tenantId, companyId, siteId, reportingYear, gender, headcount }) => {
  await sql`
    INSERT INTO management_headcount_yearly (
      id, tenant_id, company_id, site_id, reporting_year, gender, headcount, updated_at
    )
    VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${siteId}, ${reportingYear}, ${gender}, ${headcount}, NOW())
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
      AND metric_def_id = ${metricDefId}
      AND notes = ${notes}
    LIMIT 1
  `;
  const id = existing[0]?.id || randomUUID();
  const rows = await sql`
    INSERT INTO social_records (
      id, tenant_id, company_id, site_id, reporting_year, month, metric_def_id, value, metadata, notes, updated_at
    )
    VALUES (
      ${id}, ${tenantId}, ${companyId}, ${siteId}, ${reportingYear}, NULL, ${metricDefId}, ${value},
      ${JSON.stringify({ seeded_large: true })}::jsonb, ${notes}, NOW()
    )
    ON CONFLICT (id) DO UPDATE
      SET value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          notes = EXCLUDED.notes,
          updated_at = NOW()
    RETURNING id
  `;
  return rows[0]?.id || id;
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
      id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, created_at
    )
    VALUES (${randomUUID()}, ${tenantId}, ${siteId}, ${filename}, 'application/pdf', 0, NULL, ${blobUrl}, NOW())
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

const upsertMateriality = async (sql, { tenantId, companyId, reportingYear, topicId, severity, likelihood }) => {
  await sql`
    INSERT INTO materiality_selected_topics (tenant_id, company_id, reporting_year, topic_id, created_at)
    VALUES (${tenantId}, ${companyId}, ${reportingYear}, ${topicId}, NOW())
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO materiality_scores (
      tenant_id, company_id, reporting_year, topic_id,
      impact_severity, impact_scope, impact_irremediability, impact_likelihood,
      financial_magnitude, financial_likelihood, notes, updated_at
    )
    VALUES (
      ${tenantId}, ${companyId}, ${reportingYear}, ${topicId},
      ${severity}, 3, 3, ${likelihood}, 3, ${likelihood}, 'Seeded large demo topic', NOW()
    )
    ON CONFLICT (tenant_id, company_id, reporting_year, topic_id) DO UPDATE
      SET impact_severity = EXCLUDED.impact_severity,
          impact_likelihood = EXCLUDED.impact_likelihood,
          financial_likelihood = EXCLUDED.financial_likelihood,
          notes = EXCLUDED.notes,
          updated_at = NOW()
  `;
};

const main = async () => {
  ensureEnvGuard();
  const sql = getSql();
  const watchdog = setTimeout(() => {
    console.error(`[seed-demo-large] timed out after ${TIMEOUT_MS}ms`);
    process.exit(1);
  }, TIMEOUT_MS);

  if (!SKIP_ENSURE) {
    logStep("ensuring schemas");
    await ensureEnterpriseSchema();
    await ensureStandardsSchema();
    await ensureMetricsSchema();
    await ensureGhgSchema();
    await ensureSocialSchema();
    await ensureGovernanceSchema();
    await ensureMaterialitySchema();
  } else {
    logStep("skipping schema ensure (DEMO_SEED_LARGE_SKIP_ENSURE=1)");
  }

  logStep("seeding baseline small dataset");
  await seedDemoData({ sql, skipEnsureSchemas: true });

  const tenant = (await sql`SELECT id FROM tenants WHERE name = ${TENANT_NAME} LIMIT 1`)[0];
  if (!tenant?.id) {
    throw new Error(`Tenant not found: ${TENANT_NAME}`);
  }
  const tenantId = tenant.id;

  logStep("loading reusable catalogs");
  const [ghgDefs, socialDefs, topics] = await Promise.all([
    sql`
      SELECT id, key, scope, scope3_category
      FROM ghg_activity_definitions
      WHERE tenant_id = ${tenantId}
        AND is_active = TRUE
        AND deleted_at IS NULL
      ORDER BY sort_order ASC, key ASC
    `,
    sql`
      SELECT id, key, name
      FROM social_metric_definitions
      WHERE tenant_id = ${tenantId}
        AND is_active = TRUE
      ORDER BY sort_order ASC, key ASC
      LIMIT 6
    `,
    sql`
      SELECT id
      FROM materiality_topics
      WHERE tenant_id = ${tenantId}
      ORDER BY code ASC, name ASC
      LIMIT 6
    `,
  ]);

  const pickGhg = (predicate) => ghgDefs.find(predicate)?.id || null;
  const scope1DefId = pickGhg((row) => row.scope === "scope1");
  const scope2DefId = pickGhg((row) => row.scope === "scope2");
  const scope3Cat1DefId = pickGhg((row) => row.scope === "scope3" && Number(row.scope3_category) === 1) || pickGhg((row) => row.scope === "scope3");
  const scope3Cat6DefId = pickGhg((row) => row.scope === "scope3" && Number(row.scope3_category) === 6) || pickGhg((row) => row.scope === "scope3");
  const socialMetricIds = socialDefs.slice(0, 3).map((row) => row.id).filter(Boolean);

  logStep("creating additional companies and sites");
  const companies = [];
  for (const seed of EXTRA_COMPANIES) {
    // eslint-disable-next-line no-await-in-loop
    const company = await upsertCompany(sql, { tenantId, name: seed.name, country: seed.country });
    // eslint-disable-next-line no-await-in-loop
    await upsertCompanyProfile(sql, { tenantId, companyId: company.id, country: seed.country, region: seed.region });
    for (const reportingYear of DEMO_REPORTING_YEARS) {
      // eslint-disable-next-line no-await-in-loop
      await upsertCompanyYearFlags(sql, { tenantId, companyId: company.id, reportingYear });
      // eslint-disable-next-line no-await-in-loop
      await upsertGovernanceYearly(sql, {
        tenantId,
        companyId: company.id,
        reportingYear,
        boardWomen: reportingYear === 2025 ? 2 : reportingYear === 2027 ? 4 : 3,
        boardMeetings: reportingYear === 2025 ? 6 : reportingYear === 2027 ? 9 : 8,
        notes: `${seed.name} governance snapshot ${reportingYear}`,
      });
    }
    companies.push(company);
  }

  const companyByName = new Map(companies.map((row) => [row.name, row]));
  const sites = [];
  for (const seed of EXTRA_SITES) {
    const company = companyByName.get(seed.companyName);
    if (!company) continue;
    // eslint-disable-next-line no-await-in-loop
    const site = await upsertSite(sql, { tenantId, companyId: company.id, name: seed.name, country: seed.country, waterStressed: seed.waterStressed });
    sites.push({ ...site, companyName: seed.companyName });
  }

  logStep("populating environment, ghg, social, governance and evidence");
  let createdEvidenceLinks = 0;
  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index];
    const company = companyByName.get(site.companyName);
    const multiplier = index + 1;
    for (const reportingYear of DEMO_REPORTING_YEARS) {
      const multiplierByYear = yearMultiplier(reportingYear);
      // eslint-disable-next-line no-await-in-loop
      await upsertSiteMetric(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, metricKey: "electricity_kwh", value: scaleValue(120000 + multiplier * 5500, multiplierByYear), unit: "kWh" });
      // eslint-disable-next-line no-await-in-loop
      await upsertSiteMetric(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, metricKey: "water_withdrawal_m3", value: scaleValue(2000 + multiplier * 80, 1 + (reportingYear - 2026) * 0.03), unit: "m3" });
      // eslint-disable-next-line no-await-in-loop
      await upsertSiteMetric(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, metricKey: "waste_generated_tons", value: scaleValue(30 + multiplier * 2, 1 + (reportingYear - 2026) * 0.05), unit: "tons" });

      const ghgRecordIds = [];
      if (scope1DefId) {
        // eslint-disable-next-line no-await-in-loop
        ghgRecordIds.push(await upsertGhgRecord(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, activityDefId: scope1DefId, quantity: scaleValue(40 + multiplier * 4, multiplierByYear), amount: null, currency: null, notes: `${site.name} ${reportingYear} scope1` }));
      }
      if (scope2DefId) {
        // eslint-disable-next-line no-await-in-loop
        ghgRecordIds.push(await upsertGhgRecord(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, activityDefId: scope2DefId, quantity: scaleValue(120000 + multiplier * 5500, multiplierByYear), amount: null, currency: null, notes: `${site.name} ${reportingYear} scope2` }));
      }
      if (scope3Cat1DefId) {
        // eslint-disable-next-line no-await-in-loop
        ghgRecordIds.push(await upsertGhgRecord(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, activityDefId: scope3Cat1DefId, quantity: scaleValue(250 + multiplier * 15, reportingYear === 2027 ? 1.06 : multiplierByYear), amount: null, currency: null, notes: `${site.name} ${reportingYear} scope3 cat1` }));
      }
      if (scope3Cat6DefId) {
        // eslint-disable-next-line no-await-in-loop
        ghgRecordIds.push(await upsertGhgRecord(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, activityDefId: scope3Cat6DefId, quantity: scaleValue(1800 + multiplier * 90, reportingYear === 2025 ? 1.1 : reportingYear === 2027 ? 0.96 : 1), amount: null, currency: null, notes: `${site.name} ${reportingYear} scope3 cat6` }));
      }

      for (const month of [1, 2, 3]) {
        // eslint-disable-next-line no-await-in-loop
        await upsertWorkforce(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, month, gender: "F", headcount: scaleValue(18 + multiplier, reportingYear === 2025 ? 0.96 : reportingYear === 2027 ? 1.04 : 1), hoursWorked: scaleValue(2500 + multiplier * 100, reportingYear === 2025 ? 0.96 : reportingYear === 2027 ? 1.04 : 1) });
        // eslint-disable-next-line no-await-in-loop
        await upsertWorkforce(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, month, gender: "M", headcount: scaleValue(42 + multiplier * 2, reportingYear === 2025 ? 0.96 : reportingYear === 2027 ? 1.04 : 1), hoursWorked: scaleValue(5800 + multiplier * 130, reportingYear === 2025 ? 0.96 : reportingYear === 2027 ? 1.04 : 1) });
        // eslint-disable-next-line no-await-in-loop
        await upsertLeavers(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, month, gender: "F", leavers: reportingYear === 2025 ? (month === 2 ? 2 : 0) : month === 2 ? 1 : 0 });
        // eslint-disable-next-line no-await-in-loop
        await upsertLeavers(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, month, gender: "M", leavers: reportingYear === 2027 ? 0 : month === 3 ? 1 : 0 });
      }
      // eslint-disable-next-line no-await-in-loop
      await upsertManagement(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, gender: "F", headcount: 3 + (index % 2) + (reportingYear === 2027 ? 1 : 0) });
      // eslint-disable-next-line no-await-in-loop
      await upsertManagement(sql, { tenantId, companyId: company.id, siteId: site.id, reportingYear, gender: "M", headcount: 5 + (index % 3) });

      for (let socialIndex = 0; socialIndex < socialMetricIds.length; socialIndex += 1) {
        // eslint-disable-next-line no-await-in-loop
        await upsertSocialRecord(sql, {
          tenantId,
          companyId: company.id,
          siteId: site.id,
          reportingYear,
          metricDefId: socialMetricIds[socialIndex],
          value: scaleValue(5 + multiplier + socialIndex, reportingYear === 2025 ? 0.92 : reportingYear === 2027 ? 1.08 : 1),
          notes: `${site.name} ${reportingYear} social ${socialIndex + 1}`,
        });
      }

      if (index % 2 === 0 && ghgRecordIds[0]) {
        // eslint-disable-next-line no-await-in-loop
        const evidenceId = await upsertEvidence(sql, {
          tenantId,
          siteId: site.id,
          filename: `${site.name.replace(/\s+/g, "-").toLowerCase()}-${reportingYear}-utility-bill.pdf`,
          blobUrl: `https://demo.local/${site.id}/${reportingYear}/utility-bill.pdf`,
        });
        // eslint-disable-next-line no-await-in-loop
        await ensureEntityEvidenceLink(sql, { tenantId, entityType: "ghg_record", entityId: ghgRecordIds[0], evidenceId });
        createdEvidenceLinks += 1;
      }
    }
  }

  logStep("expanding materiality coverage");
  for (const company of companies) {
    for (const reportingYear of DEMO_REPORTING_YEARS) {
      for (let index = 0; index < topics.length; index += 1) {
        const topic = topics[index];
        // eslint-disable-next-line no-await-in-loop
        await upsertMateriality(sql, {
          tenantId,
          companyId: company.id,
          reportingYear,
          topicId: topic.id,
          severity: 3 + (index % 2) + (reportingYear === 2025 ? 1 : 0),
          likelihood: 3 + ((index + 1) % 2),
        });
      }
    }
  }

  clearTimeout(watchdog);
  console.log("✅ Large demo dataset ready.");
  console.log(`Tenant: ${TENANT_NAME}`);
  console.log(`Extra companies: ${companies.length}`);
  console.log(`Extra sites: ${sites.length}`);
  console.log(`Evidence links added: ${createdEvidenceLinks}`);
};

main().catch((error) => {
  console.error("seed-demo-large failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
