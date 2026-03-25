import { randomUUID } from "node:crypto";
import { computeEmissionSummary } from "../../../_lib/esg-api.js";
import { ensureGhgSchema } from "../../../_lib/db.js";
import { buildScope3SupportWarnings, SCOPE3_SUPPORT_MATRIX } from "../../../_lib/ghg-catalog.js";
import { computeGhgInventory, normalizeGhgDefinitionRow } from "../../../_lib/ghg-api.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { errorJson, json } from "../../../_lib/http.js";
import { parseYear } from "../../../_lib/esg-domain.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message, extra = {}) => errorJson(message, 400, { code, requestId, ...extra });
const serverError = (requestId, code, message) => errorJson(message, 500, { code, requestId });

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const year = parseYear(new URL(request.url).searchParams.get("year"));
  const library = String(new URL(request.url).searchParams.get("library") || "").trim().toUpperCase() || null;
  if (!year) {
    return badRequest(requestId, "missing_year", "Valid year is required");
  }

  try {
    await ensureGhgSchema();

    const [factorRows, countryOverrideRows, metricRows, sites, companies, ghgDefinitions, ghgRecords, libraryRows, evidenceRows] = await Promise.all([
      context.sql`
        SELECT key, unit, value, source, source_label, source_url
        FROM emission_factors
        WHERE tenant_id = ${tenantId}
      `,
      context.sql`
        SELECT country, reporting_year, key, unit, value, source_label, source_url
        FROM emission_factor_country_overrides
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      context.sql`
        SELECT tenant_id, company_id, site_id, reporting_year, metric_key, value, unit
        FROM site_metrics
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
      `,
      context.sql`
        SELECT id, tenant_id, company_id, name, country, address, water_stressed
        FROM sites
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at ASC
      `,
      context.sql`
        SELECT id, tenant_id, name, legal_name, country, is_holding
        FROM companies
        WHERE tenant_id = ${tenantId}
        ORDER BY is_holding DESC, created_at ASC
      `,
      context.sql`
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
          is_system,
          is_active,
          deleted_at,
          sort_order,
          created_at,
          updated_at
        FROM ghg_activity_definitions
        WHERE tenant_id = ${tenantId}
          AND is_active = TRUE
          AND deleted_at IS NULL
      `,
      context.sql`
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
      context.sql`
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
        WHERE (${library || ""} = '' OR library = ${library})
          AND (reporting_year = ${year} OR year = ${year} OR reporting_year IS NULL OR year IS NULL)
      `,
      context.sql`
        SELECT entity_id
        FROM entity_evidence
        WHERE tenant_id = ${tenantId}
          AND entity_type = 'ghg_record'
      `,
    ]);

    const legacySummary = computeEmissionSummary({
      factorRows,
      countryOverrideRows,
      metricRows,
      sites,
      companies,
    });

    const ghgSummary = computeGhgInventory({
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
      library,
    });

    const companyScope3Map = new Map((ghgSummary.companies || []).map((item) => [item.companyId, item.scope3Tco2e || 0]));
    const siteScope3Map = new Map((ghgSummary.sites || []).map((item) => [item.siteId, item.scope3Tco2e || 0]));

    const companiesWithScope3 = (legacySummary.companies || []).map((item) => ({
      ...item,
      scope3Tco2e: Number(companyScope3Map.get(item.companyId) || 0),
    }));
    const sitesWithScope3 = (legacySummary.sites || []).map((item) => ({
      ...item,
      scope3Tco2e: Number(siteScope3Map.get(item.siteId) || 0),
    }));

    const supportWarnings = buildScope3SupportWarnings((ghgSummary.scope3Breakdown || []).map((item) => item.category));
    const warnings = [...new Set([...(legacySummary.warnings || []), ...(ghgSummary.warnings || []), ...supportWarnings])];
    const missingFactors = [...new Set([...(legacySummary.missingFactors || []), ...(ghgSummary.missingFactors || [])])];
    const evidenceSet = new Set((evidenceRows || []).map((row) => String(row.entity_id || "").trim()).filter(Boolean));
    const ghgDefinitionById = new Map(ghgDefinitions.map((row) => [row.id, row]));
    const missingEvidenceCount = ghgRecords.reduce((count, row) => {
      const definition = ghgDefinitionById.get(row.activity_def_id);
      return definition?.evidence_required === true && !evidenceSet.has(row.id) ? count + 1 : count;
    }, 0);
    const unsupportedCategoriesCount = SCOPE3_SUPPORT_MATRIX.filter((item) => item.status !== "supported").length;
    const nonComputableRecordCount = (ghgSummary.records || []).reduce(
      (count, item) => (item?.tco2e == null || item?.factorUsed?.resolution === "missing" ? count + 1 : count),
      0,
    );

    return json({
      ok: missingFactors.length === 0,
      year,
      tenantTotals: {
        ...legacySummary.tenantTotals,
        scope3Tco2e: ghgSummary.scopeTotals?.scope3Tco2e || 0,
        ghgCoveragePct: ghgSummary.coverage,
      },
      companies: companiesWithScope3,
      sites: sitesWithScope3,
      warnings,
      missingFactors,
      summary: {
        missingFactorsCount: missingFactors.length,
        unsupportedCategoriesCount,
        missingEvidenceCount,
        nonComputableRecordCount,
      },
      requestId,
      ghg: {
        scopeTotals: ghgSummary.scopeTotals,
        scope3Breakdown: ghgSummary.scope3Breakdown,
        coverage: ghgSummary.coverage,
        records: ghgSummary.records,
        scope3Support: SCOPE3_SUPPORT_MATRIX,
      },
    });
  } catch (error) {
    return serverError(
      requestId,
      "emissions_fetch_failed",
      error instanceof Error ? error.message : "Unable to load emissions summary",
    );
  }
}
