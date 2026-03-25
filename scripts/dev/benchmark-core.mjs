#!/usr/bin/env node
import { appendHistoryArtifact, writeArtifact } from "../../apps/web/app/api/v1/_lib/ops-artifacts.js";
import { join } from "node:path";
import { getSql } from "../../apps/web/app/api/v1/_lib/db.js";
import { computeEmissionSummary } from "../../apps/web/app/api/v1/_lib/esg-api.js";
import { computeGhgInventory, normalizeGhgDefinitionRow } from "../../apps/web/app/api/v1/_lib/ghg-api.js";
import { buildMaterialityReport, getMaterialityThresholds, normalizeMaterialityScore } from "../../apps/web/app/api/v1/_lib/materiality-api.js";

const YEAR = Number.parseInt(String(process.env.BENCHMARK_YEAR || "2026"), 10);
const OUTPUT_PATH = join(process.cwd(), "apps/web/public/benchmark-core.json");
const DATASET_LABEL = (process.env.BENCHMARK_DATASET || "small").trim() || "small";
const tenantName = (process.env.BENCHMARK_TENANT_NAME || "Demo Holding").trim();
const log = (message) => console.log(`[benchmark-core] ${message}`);

const measure = async (label, task) => {
  const startedAt = performance.now();
  const result = await task();
  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  return { label, durationMs, resultCount: Array.isArray(result) ? result.length : result?.count ?? null };
};

const toTable = (rows) => {
  const header = "label                      durationMs   resultCount";
  const body = rows.map((row) => `${row.label.padEnd(26)} ${String(row.durationMs).padStart(10)}   ${String(row.resultCount ?? "-")}`);
  return [header, ...body].join("\n");
};

const main = async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = getSql();
  const tenant = (await sql`SELECT id, name FROM tenants WHERE name = ${tenantName} LIMIT 1`)[0];
  if (!tenant?.id) {
    throw new Error(`Tenant not found: ${tenantName}`);
  }

  const results = [];
  results.push(await measure("companies", async () => sql`SELECT id FROM companies WHERE tenant_id = ${tenant.id}`));
  results.push(await measure("sites", async () => sql`SELECT id FROM sites WHERE tenant_id = ${tenant.id}`));
  results.push(await measure("metrics_summary", async () => sql`SELECT company_id, SUM(value) AS total FROM site_metrics WHERE tenant_id = ${tenant.id} AND reporting_year = ${YEAR} GROUP BY company_id`));

  const [companies, sites, factorRows, countryOverrideRows, metricRows, ghgDefinitions, ghgRecords, libraryRows] = await Promise.all([
    sql`SELECT id, tenant_id, name, legal_name, country, is_holding FROM companies WHERE tenant_id = ${tenant.id}`,
    sql`SELECT id, tenant_id, company_id, name, country, address, water_stressed FROM sites WHERE tenant_id = ${tenant.id}`,
    sql`SELECT key, unit, value, source, source_label, source_url FROM emission_factors WHERE tenant_id = ${tenant.id}`,
    sql`SELECT country, reporting_year, key, unit, value, source_label, source_url FROM emission_factor_country_overrides WHERE tenant_id = ${tenant.id} AND reporting_year = ${YEAR}`,
    sql`SELECT tenant_id, company_id, site_id, reporting_year, metric_key, value, unit FROM site_metrics WHERE tenant_id = ${tenant.id} AND reporting_year = ${YEAR}`,
    sql`SELECT id, tenant_id, scope, scope3_category, key, name, group_key, sub_group, method, unit, requires_factor, default_factor_key, input_schema, sdgs, evidence_required, is_system, is_active, deleted_at, sort_order, created_at, updated_at FROM ghg_activity_definitions WHERE tenant_id = ${tenant.id} AND is_active = TRUE AND deleted_at IS NULL`,
    sql`SELECT id, tenant_id, company_id, site_id, reporting_year, month, activity_def_id, quantity, amount, currency, direct_tco2e, metadata, notes, created_at, updated_at FROM ghg_activity_records WHERE tenant_id = ${tenant.id} AND reporting_year = ${YEAR}`,
    sql`SELECT library, country, reporting_year, year, key, unit, value, scope, scope3_category, method, spend_category, transport_mode, refrigerant_type, region, source_label, source_url, notes FROM emission_factor_library WHERE reporting_year = ${YEAR} OR year = ${YEAR} OR reporting_year IS NULL OR year IS NULL`,
  ]);

  results.push(await measure("ghg_compute", async () => {
    const summary = computeGhgInventory({
      records: ghgRecords.map((row) => ({
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
      definitions: ghgDefinitions.map((row) => normalizeGhgDefinitionRow(row)),
      companies,
      sites,
      tenantFactorRows: factorRows,
      countryOverrideRows,
      factorLibraryRows: libraryRows,
      library: "IPCC",
    });
    return summary.records || [];
  }));

  results.push(await measure("emissions", async () => {
    const summary = computeEmissionSummary({ factorRows, countryOverrideRows, metricRows, sites, companies });
    return summary.companies || [];
  }));

  results.push(await measure("materiality_report", async () => {
    const thresholds = await getMaterialityThresholds({ sql, tenantId: tenant.id });
    const selected = await sql`
      SELECT s.company_id, t.id, t.code, t.name, t.category, t.group_key, t.sdgs
      FROM materiality_selected_topics s
      INNER JOIN materiality_topics t
        ON t.tenant_id = s.tenant_id
       AND t.id = s.topic_id
      WHERE s.tenant_id = ${tenant.id}
        AND s.reporting_year = ${YEAR}
    `;
    const topicIds = selected.map((row) => row.id);
    const scores = topicIds.length > 0
      ? await sql`
          SELECT tenant_id, company_id, reporting_year, topic_id, impact_severity, impact_scope, impact_irremediability, impact_likelihood, financial_magnitude, financial_likelihood, notes, updated_at
          FROM materiality_scores
          WHERE tenant_id = ${tenant.id}
            AND reporting_year = ${YEAR}
            AND topic_id = ANY(${topicIds})
        `
      : [];
    const scoreByCompany = new Map();
    for (const topic of selected) {
      const row = scores.find((item) => item.company_id === topic.company_id && item.topic_id === topic.id);
      const normalized = normalizeMaterialityScore({ row, topic, thresholds });
      const bucket = scoreByCompany.get(topic.company_id) || [];
      bucket.push(normalized);
      scoreByCompany.set(topic.company_id, bucket);
    }
    return [...scoreByCompany.values()].map((items) => buildMaterialityReport({ scores: items, thresholds }));
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    tenantId: tenant.id,
    tenantName: tenant.name,
    year: YEAR,
    dataset: DATASET_LABEL,
    results,
  };

  await writeArtifact("benchmark-core.json", payload);
  await appendHistoryArtifact(
    "benchmark-history.json",
    {
      generatedAt: payload.generatedAt,
      tenantId: tenant.id,
      tenantName: tenant.name,
      year: YEAR,
      dataset: DATASET_LABEL,
      status: "passed",
      results,
    },
    20,
  );

  log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(toTable(results));
  log(`JSON written to ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error("benchmark-core failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
