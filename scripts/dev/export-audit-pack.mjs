#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ensureEnterpriseSchema,
  ensureGhgSchema,
  ensureGovernanceSchema,
  ensureMaterialitySchema,
  ensureSocialSchema,
  ensureStandardsSchema,
  getSql,
} from "../../apps/web/app/api/v1/_lib/db.js";
import { buildScope3SupportWarnings, SCOPE3_SUPPORT_MATRIX } from "../../apps/web/app/api/v1/_lib/ghg-catalog.js";
import { computeEmissionSummary, computeSocialSummary } from "../../apps/web/app/api/v1/_lib/esg-api.js";
import { buildEvidenceCoverage } from "../../apps/web/app/api/v1/_lib/evidence-policy.js";
import { computeGhgInventory, computeSocialCatalogMetrics, normalizeGhgDefinitionRow } from "../../apps/web/app/api/v1/_lib/ghg-api.js";
import { buildMaterialityReport, getMaterialityThresholds, normalizeMaterialityScore } from "../../apps/web/app/api/v1/_lib/materiality-api.js";

const REQUIRED_CONFIRM = "YES";
const DEFAULT_YEAR = 2026;
const DEFAULT_TENANT_NAME = "Demo Holding";
const DEFAULT_TIMEOUT_MS = 180000;

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");
const logStep = (message) => console.log(`[export-audit-pack] ${message}`);
const ensureEnvGuard = () => {
  if (process.env.APP_ENV !== "local" || process.env.CONFIRM_AUDIT_EXPORT !== REQUIRED_CONFIRM) {
    console.error("Refusing to run audit export.");
    console.error("Required:");
    console.error("  APP_ENV=local");
    console.error("  CONFIRM_AUDIT_EXPORT=YES");
    console.error("  DATABASE_URL=...");
    console.error("  BASE_URL=http://127.0.0.1:3000");
    console.error("Example:");
    console.error(
      "  APP_ENV=local CONFIRM_AUDIT_EXPORT=YES DATABASE_URL=... BASE_URL=http://127.0.0.1:3000 node scripts/dev/export-audit-pack.mjs",
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
};

const toCsvCell = (value) => {
  const raw = value == null ? "" : String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '""')}"`;
};

const toCsv = (rows, headers) => {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => toCsvCell(row[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
};

const pickTenant = async (sql, preferredName) => {
  const preferred = await sql`
    SELECT id, name
    FROM tenants
    WHERE name = ${preferredName}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (preferred[0]) {
    return preferred[0];
  }

  const fallback = await sql`
    SELECT id, name
    FROM tenants
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return fallback[0] || null;
};

const loadGovernanceSnapshot = async ({ sql, tenantId, year }) => {
  try {
    const [yearly, policies] = await Promise.all([
      sql`
        SELECT
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
        FROM governance_yearly
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      sql`
        SELECT tenant_id, company_id, reporting_year, policy_key, status, notes, updated_at
        FROM governance_policies
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
        ORDER BY company_id ASC, policy_key ASC
      `,
    ]);
    return { yearly, policies };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("custom_values")) {
      throw error;
    }

    const [yearly, policies] = await Promise.all([
      sql`
        SELECT
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
        FROM governance_yearly
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      sql`
        SELECT tenant_id, company_id, reporting_year, policy_key, status, notes, updated_at
        FROM governance_policies
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
        ORDER BY company_id ASC, policy_key ASC
      `,
    ]);
    return { yearly, policies };
  }
};

const loadMaterialityHighlights = async ({ sql, tenantId, companies, year }) => {
  const thresholds = await getMaterialityThresholds({ sql, tenantId });
  const byCompany = [];

  for (const company of companies) {
    // eslint-disable-next-line no-await-in-loop
    const selected = await sql`
      SELECT t.id, t.code, t.name, t.category, t.group_key, t.sdgs
      FROM materiality_selected_topics s
      INNER JOIN materiality_topics t
        ON t.tenant_id = s.tenant_id
       AND t.id = s.topic_id
      WHERE s.tenant_id = ${tenantId}
        AND s.company_id = ${company.id}
        AND s.reporting_year = ${year}
      ORDER BY t.code ASC, t.name ASC
    `;

    if (selected.length === 0) {
      byCompany.push({
        companyId: company.id,
        companyName: company.name,
        selectedTopicIds: [],
        matrixPoints: [],
        materialTopics: [],
        topImpactTopics: [],
        topFinancialTopics: [],
        thresholds,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    const topicIds = selected.map((row) => row.id);
    // eslint-disable-next-line no-await-in-loop
    const scoreRows = await sql`
      SELECT
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
      FROM materiality_scores
      WHERE tenant_id = ${tenantId}
        AND company_id = ${company.id}
        AND reporting_year = ${year}
        AND topic_id = ANY(${topicIds})
    `;

    const scoreByTopicId = new Map(scoreRows.map((row) => [row.topic_id, row]));
    const normalizedScores = selected.map((topic) => {
      const row = scoreByTopicId.get(topic.id) || {
        tenant_id: tenantId,
        company_id: company.id,
        reporting_year: year,
        topic_id: topic.id,
        impact_severity: 3,
        impact_scope: 3,
        impact_irremediability: 3,
        impact_likelihood: 3,
        financial_magnitude: 3,
        financial_likelihood: 3,
        notes: "",
        updated_at: null,
      };
      return normalizeMaterialityScore({ row, topic, thresholds });
    });

    const report = buildMaterialityReport({ scores: normalizedScores, thresholds });
    byCompany.push({
      companyId: company.id,
      companyName: company.name,
      selectedTopicIds: topicIds,
      ...report,
    });
  }

  return {
    thresholds,
    byCompany,
  };
};

export const loadAuditSnapshot = async ({ sql, tenantId, year }) => {
  const [tenantRows, companies, sites, factorRows, countryOverrideRows, metricRows, metricDefinitionRows, ghgDefinitionsRows, ghgRecordsRows, libraryRows, evidenceRows, governanceFieldRows] =
    await Promise.all([
      sql`
        SELECT id, name, tenant_status, created_at, updated_at
        FROM tenants
        WHERE id = ${tenantId}
        LIMIT 1
      `,
      sql`
        SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
        FROM companies
        WHERE tenant_id = ${tenantId}
        ORDER BY is_holding DESC, created_at ASC
      `,
      sql`
        SELECT id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
        FROM sites
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at ASC
      `,
      sql`
        SELECT key, unit, value, source, source_label, source_url
        FROM emission_factors
        WHERE tenant_id = ${tenantId}
      `,
      sql`
        SELECT country, reporting_year, key, unit, value, source_label, source_url
        FROM emission_factor_country_overrides
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      sql`
        SELECT id, tenant_id, company_id, site_id, reporting_year, metric_key, value, unit
        FROM site_metrics
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      sql`
        SELECT key, label, validation
        FROM metric_definitions
        WHERE tenant_id IS NULL OR tenant_id = ${tenantId}
        ORDER BY CASE WHEN tenant_id = ${tenantId} THEN 0 ELSE 1 END ASC
      `,
      sql`
        SELECT
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
          is_active,
          sort_order,
          created_at,
          updated_at
        FROM ghg_activity_definitions
        WHERE tenant_id = ${tenantId}
          AND is_active = TRUE
      `,
      sql`
        SELECT
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
          created_at,
          updated_at
        FROM ghg_activity_records
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      sql`
        SELECT
          library,
          country,
          reporting_year,
          year,
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
        FROM emission_factor_library
        WHERE reporting_year = ${year}
           OR year = ${year}
           OR reporting_year IS NULL
           OR year IS NULL
      `,
      sql`
        SELECT
          e.id AS evidence_id,
          e.filename,
          e.blob_url,
          e.storage_backend,
          e.external_file_id,
          ee.entity_type,
          ee.entity_id
        FROM evidence e
        LEFT JOIN entity_evidence ee
          ON ee.tenant_id = e.tenant_id
         AND ee.evidence_id = e.id
        WHERE e.tenant_id = ${tenantId}
        ORDER BY e.created_at ASC
      `,
      sql`
        SELECT id, key, label, evidence_required
        FROM governance_field_definitions
        WHERE tenant_id = ${tenantId}
          AND is_active = TRUE
      `,
    ]);

  const tenant = tenantRows[0] || null;

  const legacySummary = computeEmissionSummary({
    factorRows,
    countryOverrideRows,
    metricRows,
    sites,
    companies,
  });

  const ghgSummary = computeGhgInventory({
    records: ghgRecordsRows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      siteId: row.site_id,
      reportingYear: Number(row.reporting_year),
      month: row.month == null ? null : Number(row.month),
      activityDefId: row.activity_def_id,
      quantity: row.quantity == null ? null : Number(row.quantity),
      amount: row.amount == null ? null : Number(row.amount),
      currency: row.currency || null,
      directTco2e: row.direct_tco2e == null ? null : Number(row.direct_tco2e),
      metadata: row.metadata || {},
    })),
    definitions: ghgDefinitionsRows.map((row) => normalizeGhgDefinitionRow(row)),
    companies,
    sites,
    tenantFactorRows: factorRows,
    countryOverrideRows,
    factorLibraryRows: libraryRows,
    library: null,
  });

  const companyScope3Map = new Map((ghgSummary.companies || []).map((item) => [item.companyId, Number(item.scope3Tco2e || 0)]));
  const siteScope3Map = new Map((ghgSummary.sites || []).map((item) => [item.siteId, Number(item.scope3Tco2e || 0)]));

  const supportWarnings = buildScope3SupportWarnings((ghgSummary.scope3Breakdown || []).map((item) => item.category));
  const emissionsSnapshot = {
    year,
    tenantTotals: {
      ...legacySummary.tenantTotals,
      scope3Tco2e: ghgSummary.scopeTotals?.scope3Tco2e || 0,
      ghgCoveragePct: ghgSummary.coverage,
    },
    companies: (legacySummary.companies || []).map((item) => ({
      ...item,
      scope3Tco2e: companyScope3Map.get(item.companyId) || 0,
    })),
    sites: (legacySummary.sites || []).map((item) => ({
      ...item,
      scope3Tco2e: siteScope3Map.get(item.siteId) || 0,
    })),
    scope3Breakdown: ghgSummary.scope3Breakdown,
    resolvedFactors: (ghgSummary.records || []).map((row) => ({
      recordId: row.recordId,
      activityKey: row.activityKey,
      scope: row.scope,
      scope3Category: row.scope3Category,
      tco2e: row.tco2e,
      factor: row.factorUsed,
    })),
    missingFactors: ghgSummary.missingFactors || [],
    warnings: [...new Set([...(legacySummary.warnings || []), ...(ghgSummary.warnings || []), ...supportWarnings])],
  };

  const [workforceRows, leaverRows, managementRows, flagRows, socialMetricRows, socialRecordRows] = await Promise.all([
    sql`
      SELECT tenant_id, company_id, site_id, reporting_year, month, contract_type, gender, headcount, hours_worked
      FROM workforce_monthly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    sql`
      SELECT tenant_id, company_id, site_id, reporting_year, month, gender, leavers
      FROM workforce_leavers_monthly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    sql`
      SELECT tenant_id, company_id, site_id, reporting_year, gender, headcount
      FROM management_headcount_yearly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    sql`
      SELECT tenant_id, company_id, reporting_year, gender_pay_gap_reported, scope3_screening_performed
      FROM company_year_flags
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    sql`
      SELECT key, method, group_key, unit, input_schema, formula, sdgs, evidence_required, is_active, sort_order
      FROM social_metric_definitions
      WHERE tenant_id = ${tenantId}
        AND is_active = TRUE
      ORDER BY sort_order ASC, key ASC
    `,
    sql`
      SELECT
        r.id,
        r.company_id,
        r.site_id,
        r.reporting_year,
        r.month,
        r.value,
        d.key AS metric_key
      FROM social_records r
      JOIN social_metric_definitions d
        ON d.id = r.metric_def_id
       AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${tenantId}
        AND r.reporting_year = ${year}
    `,
  ]);

  const socialSummary = computeSocialSummary({
    companies,
    sites,
    workforceRows,
    leaverRows,
    managementRows,
    flagRows,
  });
  const socialCatalog = computeSocialCatalogMetrics({
    metricDefinitions: socialMetricRows.map((row) => ({ key: row.key, method: row.method })),
    socialRecords: socialRecordRows,
    workforceRows,
    leaverRows,
    managementRows,
  });

  const materiality = await loadMaterialityHighlights({
    sql,
    tenantId,
    companies,
    year,
  });
  const materialityTopicChecks = materiality.byCompany.flatMap((company) => [
    ...(company.materialTopics || []).map((item) => ({
      topicId: item.topicId,
      label: `${company.companyName} · ${item.topicCode} ${item.topicName}`.trim(),
      reason: "Critical material topic requires linked evidence before final export",
      requirementLevel: "required",
    })),
    ...(company.matrixPoints || [])
      .filter((item) => !(company.materialTopics || []).some((topic) => topic.topicId === item.topicId))
      .slice(0, 3)
      .map((item) => ({
        topicId: item.topicId,
        label: `${company.companyName} · ${item.topicCode} ${item.topicName}`.trim(),
        reason: "Selected topic should include evidence to support workshop traceability",
        requirementLevel: "recommended",
      })),
  ]);
  const [{ yearly: governanceRows, policies: governancePolicyRows }, companyProfileRows] = await Promise.all([
    loadGovernanceSnapshot({ sql, tenantId, year }),
    sql`
      SELECT tenant_id, company_id, industry_framework, sasb_industry_code, gri_profile, region, country, updated_at
      FROM company_profiles
      WHERE tenant_id = ${tenantId}
      ORDER BY company_id ASC
    `,
  ]);
  const evidenceCoverage = buildEvidenceCoverage({
    evidenceRows,
    metricRows,
    metricDefinitionRows,
    ghgDefinitionsRows,
    ghgRecordsRows,
    socialMetricRows,
    socialRecordRows,
    governanceRows,
    governanceFieldRows,
    materialityTopicChecks,
  });

  return {
    generatedAt: new Date().toISOString(),
    tenant,
    structure: {
      companies,
      sites,
    },
    emissions: emissionsSnapshot,
    social: {
      year,
      summary: socialSummary,
      catalogValues: socialCatalog.values,
      catalogAggregates: socialCatalog.aggregates,
    },
    materiality,
    governance: {
      year,
      yearly: governanceRows,
      policies: governancePolicyRows,
    },
    evidenceCoverage,
    standards: {
      companyProfiles: companyProfileRows,
    },
    scope3Support: SCOPE3_SUPPORT_MATRIX,
  };
};

export const exportAuditPack = async ({
  sql,
  baseUrl,
  year = DEFAULT_YEAR,
  outputRoot = "_exports",
  skipEnsureSchemas = false,
  skipZip = false,
  tenantId = null,
} = {}) => {
  if (!skipEnsureSchemas) {
    await ensureEnterpriseSchema();
    await ensureGhgSchema();
    await ensureGovernanceSchema();
    await ensureSocialSchema();
    await ensureMaterialitySchema();
    await ensureStandardsSchema();
  }

  const tenant = tenantId
    ? { id: tenantId, name: process.env.TENANT_NAME || DEFAULT_TENANT_NAME }
    : await pickTenant(sql, process.env.TENANT_NAME || DEFAULT_TENANT_NAME);
  if (!tenant?.id) {
    throw new Error("No tenant found for audit export.");
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const exportDir = join(outputRoot, `audit-pack-${timestamp}`);
  await mkdir(exportDir, { recursive: true });

  const snapshot = await loadAuditSnapshot({
    sql,
    tenantId: tenant.id,
    year,
  });

  const standardsRows = await sql`
    SELECT
      sm.framework,
      sm.industry_code,
      sm.code,
      sm.title,
      m.internal_type,
      m.internal_key
    FROM standards_mappings m
    JOIN standards_metrics sm
      ON sm.id = m.standards_metric_id
    WHERE m.tenant_id = ${tenant.id}
    ORDER BY sm.framework ASC, sm.industry_code ASC NULLS FIRST, sm.code ASC, m.internal_type ASC, m.internal_key ASC
  `;

  const evidenceRows = await sql`
    SELECT
      e.id AS evidence_id,
      e.filename,
      e.blob_url,
      e.storage_backend,
      e.external_file_id,
      ee.entity_type,
      ee.entity_id
    FROM evidence e
    LEFT JOIN entity_evidence ee
      ON ee.tenant_id = e.tenant_id
     AND ee.evidence_id = e.id
    WHERE e.tenant_id = ${tenant.id}
    ORDER BY e.created_at ASC
  `;

  const snapshotPath = join(exportDir, "snapshot.json");
  const standardsCsvPath = join(exportDir, "standards-mappings.csv");
  const evidenceCsvPath = join(exportDir, "evidence-links.csv");
  const scope3SupportCsvPath = join(exportDir, "scope3-support.csv");
  const readmePath = join(exportDir, "README.txt");

  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  await writeFile(
    standardsCsvPath,
    toCsv(standardsRows, ["framework", "industry_code", "code", "title", "internal_type", "internal_key"]),
    "utf-8",
  );
  await writeFile(
    evidenceCsvPath,
    toCsv(
      evidenceRows.map((row) => ({
        evidence_id: row.evidence_id,
        filename: row.filename,
        blob_url:
          row.blob_url ||
          (row.storage_backend === "onedrive" && row.external_file_id
            ? `${baseUrl || ""}/api/v1/tenants/${tenant.id}/evidence/${row.evidence_id}/content?mode=download`
            : ""),
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        pages: "",
        comment: "",
      })),
      ["evidence_id", "filename", "blob_url", "entity_type", "entity_id", "pages", "comment"],
    ),
    "utf-8",
  );
  await writeFile(
    scope3SupportCsvPath,
    toCsv(
      SCOPE3_SUPPORT_MATRIX.map((row) => ({
        category: row.category,
        label: row.label,
        status: row.status,
        methods: row.methodSupport.join("|"),
        starter_factor_coverage: row.starterFactorCoverage,
        note: row.note,
      })),
      ["category", "label", "status", "methods", "starter_factor_coverage", "note"],
    ),
    "utf-8",
  );

  await writeFile(
    readmePath,
    [
      "Audit Pack (local demo)",
      "",
      `Generated at: ${snapshot.generatedAt}`,
      `Tenant: ${snapshot?.tenant?.name || tenant.name} (${tenant.id})`,
      `Year: ${year}`,
      "",
      "Contents:",
      "- snapshot.json: tenant structure + emissions/social/materiality/governance snapshot",
      "- standards-mappings.csv: standards mappings export",
      "- evidence-links.csv: evidence to entity links (url/ref)",
      "- scope3-support.csv: supported / partial / not-enabled Scope 3 categories for pilot delivery",
      "",
      `Required evidence coverage: ${snapshot.evidenceCoverage.requiredCoverage.coveredCount}/${snapshot.evidenceCoverage.requiredCoverage.requiredCount} (${snapshot.evidenceCoverage.requiredCoverage.coveragePct}%)`,
      `Recommended evidence coverage: ${snapshot.evidenceCoverage.recommendedCoverage.coveredCount}/${snapshot.evidenceCoverage.recommendedCoverage.requiredCount} (${snapshot.evidenceCoverage.recommendedCoverage.coveragePct}%)`,
      snapshot.evidenceCoverage.missingCount > 0
        ? `Missing required evidence links: ${snapshot.evidenceCoverage.missingCount}`
        : "Missing required evidence links: 0",
      "",
      "Disclaimer:",
      "- Demo-only dataset. Values are illustrative and not suitable for regulatory filing.",
      "- Scope 3 categories marked Partial or Not enabled require manual methodology review before they should be treated as covered.",
      snapshot.evidenceCoverage.missingCount > 0
        ? "- Evidence coverage is incomplete. Review snapshot.json -> evidenceCoverage.missingEvidence before sharing with assurance."
        : "- Evidence coverage check did not find missing required links in the audited entities.",
      "",
      `Suggested local review URLs:`,
      `- ${cleanString(baseUrl || "http://127.0.0.1:3000")}/app/emissions`,
      `- ${cleanString(baseUrl || "http://127.0.0.1:3000")}/app/ghg`,
      `- ${cleanString(baseUrl || "http://127.0.0.1:3000")}/app/social`,
      `- ${cleanString(baseUrl || "http://127.0.0.1:3000")}/app/governance`,
      `- ${cleanString(baseUrl || "http://127.0.0.1:3000")}/app/materiality`,
    ].join("\n"),
    "utf-8",
  );

  const zipFilename = `audit-pack-${timestamp}.zip`;
  const zipPath = join(outputRoot, zipFilename);
  if (!skipZip) {
    const outputRootAbs = join(process.cwd(), outputRoot);
    const zipRun = spawnSync("zip", ["-qr", zipFilename, `audit-pack-${timestamp}`], {
      cwd: outputRootAbs,
      stdio: "pipe",
    });

    if (zipRun.status !== 0) {
      const stderr = String(zipRun.stderr || "").trim();
      throw new Error(stderr || "zip command failed while creating audit pack archive");
    }
  }

  return {
    tenantId: tenant.id,
    tenantName: snapshot?.tenant?.name || tenant.name,
    exportDir,
    zipPath,
  };
};

const main = async () => {
  ensureEnvGuard();

  const sql = getSql();
  const baseUrl = cleanString(process.env.BASE_URL || "http://127.0.0.1:3000");
  const year = Number.parseInt(String(process.env.YEAR || DEFAULT_YEAR), 10);
  const skipEnsureSchemas = String(process.env.AUDIT_EXPORT_SKIP_ENSURE || "").trim() === "1";
  const timeoutMsRaw = Number.parseInt(String(process.env.AUDIT_EXPORT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10);
  const timeoutMs = Number.isInteger(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const watchdog = setTimeout(() => {
    console.error(`[export-audit-pack] timed out after ${timeoutMs}ms`);
    process.exit(1);
  }, timeoutMs);
  logStep("starting export");
  const result = await exportAuditPack({
    sql,
    baseUrl,
    year: Number.isInteger(year) ? year : DEFAULT_YEAR,
    skipEnsureSchemas,
  });
  clearTimeout(watchdog);

  console.log("✅ Audit-ready export pack created.");
  console.log(`Elapsed: ${Date.now() - startedAt}ms`);
  console.log(`Schema ensure: ${skipEnsureSchemas ? "skipped" : "enabled"}`);
  console.log(`Tenant: ${result.tenantName} (${result.tenantId})`);
  console.log(`Folder: ${result.exportDir}`);
  console.log(`Zip: ${result.zipPath}`);
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === process.argv[1]) {
  main().catch((error) => {
    console.error("export-audit-pack failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
