import { randomUUID } from "node:crypto";
import { ensureGhgSchema } from "../../../../_lib/db.js";
import { buildScope3SupportWarnings, SCOPE3_SUPPORT_MATRIX } from "../../../../_lib/ghg-catalog.js";
import { computeGhgInventory, normalizeGhgDefinitionRow } from "../../../../_lib/ghg-api.js";
import { resolveCompany, resolveSite } from "../../../../_lib/esg-api.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message, extra = {}) => errorJson(message, 400, { code, requestId, ...extra });
const serverError = (requestId, code, message) => errorJson(message, 500, { code, requestId });

const parseYear = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200) {
    return null;
  }
  return parsed;
};

const parseMonth = (value) => {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    return null;
  }
  return parsed;
};

const parseFilters = (requestUrl) => {
  const url = new URL(requestUrl);
  const reportingYear = parseYear(url.searchParams.get("year"));
  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));
  const month = parseMonth(url.searchParams.get("month"));
  const library = cleanString(url.searchParams.get("library")).toUpperCase() || null;

  if (!reportingYear) {
    return { error: { code: "invalid_year", message: "year is required and must be a valid year" } };
  }

  if (companyId && !UUID_PATTERN.test(companyId)) {
    return { error: { code: "invalid_company_id", message: "companyId must be a UUID" } };
  }
  if (siteId && !UUID_PATTERN.test(siteId)) {
    return { error: { code: "invalid_site_id", message: "siteId must be a UUID" } };
  }
  if (new URL(requestUrl).searchParams.has("month") && month == null) {
    return { error: { code: "invalid_month", message: "month must be between 1 and 12" } };
  }

  return {
    filters: {
      reportingYear,
      companyId: companyId || null,
      siteId: siteId || null,
      month,
      library,
    },
  };
};

const verifyCompanyAndSite = async ({ sql, tenantId, companyId, siteId, requestId }) => {
  if (!companyId && !siteId) {
    return { company: null, site: null };
  }

  let company = null;
  if (companyId) {
    company = await resolveCompany(sql, tenantId, companyId);
    if (!company) {
      return { error: badRequest(requestId, "invalid_company_id", "companyId is invalid for this tenant") };
    }
  }

  let site = null;
  if (siteId) {
    site = await resolveSite(sql, tenantId, siteId);
    if (!site) {
      return { error: badRequest(requestId, "invalid_site_id", "siteId is invalid for this tenant") };
    }
    if (company && site.company_id !== company.id) {
      return { error: badRequest(requestId, "site_company_mismatch", "siteId does not belong to companyId") };
    }
    if (!company) {
      company = await resolveCompany(sql, tenantId, site.company_id);
    }
  }

  return { company, site };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureGhgSchema();

    const parsed = parseFilters(request.url);
    if (parsed.error) {
      return badRequest(requestId, parsed.error.code, parsed.error.message);
    }

    const verified = await verifyCompanyAndSite({
      sql: context.sql,
      tenantId,
      companyId: parsed.filters.companyId,
      siteId: parsed.filters.siteId,
      requestId,
    });
    if (verified.error) {
      return verified.error;
    }

    const [definitionRows, recordRows, factorRows, countryOverrideRows, libraryRows, companyRows, siteRows, evidenceRows] = await Promise.all([
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
          AND reporting_year = ${parsed.filters.reportingYear}
          AND (${parsed.filters.companyId || ""} = '' OR company_id = ${parsed.filters.companyId})
          AND (${parsed.filters.siteId || ""} = '' OR site_id = ${parsed.filters.siteId})
          AND (${parsed.filters.month ?? -1} = -1 OR month = ${parsed.filters.month})
      `,
      context.sql`
        SELECT key, unit, value, source, source_label, source_url
        FROM emission_factors
        WHERE tenant_id = ${tenantId}
      `,
      context.sql`
        SELECT country, reporting_year, key, unit, value, source_label, source_url
        FROM emission_factor_country_overrides
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${parsed.filters.reportingYear}
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
        WHERE (${parsed.filters.library || ""} = '' OR library = ${parsed.filters.library})
          AND (reporting_year = ${parsed.filters.reportingYear} OR year = ${parsed.filters.reportingYear} OR reporting_year IS NULL OR year IS NULL)
      `,
      context.sql`
        SELECT id, tenant_id, name, legal_name, country, is_holding
        FROM companies
        WHERE tenant_id = ${tenantId}
          AND (${parsed.filters.companyId || ""} = '' OR id = ${parsed.filters.companyId})
      `,
      context.sql`
        SELECT id, tenant_id, company_id, name, country, address, water_stressed
        FROM sites
        WHERE tenant_id = ${tenantId}
          AND (${parsed.filters.companyId || ""} = '' OR company_id = ${parsed.filters.companyId})
          AND (${parsed.filters.siteId || ""} = '' OR id = ${parsed.filters.siteId})
      `,
      context.sql`
        SELECT entity_id
        FROM entity_evidence
        WHERE tenant_id = ${tenantId}
          AND entity_type = 'ghg_record'
      `,
    ]);

    const definitions = definitionRows.map((row) => normalizeGhgDefinitionRow(row));

    const computed = computeGhgInventory({
      records: recordRows.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        siteId: row.site_id,
        reportingYear: Number(row.reporting_year),
        month: row.month == null ? null : Number(row.month),
        activityDefId: row.activity_def_id,
        quantity: row.quantity == null ? null : Number(row.quantity),
        amount: row.amount == null ? null : Number(row.amount),
        currency: row.currency,
        directTco2e: row.direct_tco2e == null ? null : Number(row.direct_tco2e),
        metadata: row.metadata,
      })),
      definitions,
      companies: companyRows,
      sites: siteRows,
      tenantFactorRows: factorRows,
      countryOverrideRows,
      factorLibraryRows: libraryRows,
      library: parsed.filters.library,
      defaultCountry: verified.company?.country || null,
    });

    const supportWarnings = buildScope3SupportWarnings((computed.scope3Breakdown || []).map((item) => item.category));
    const evidenceSet = new Set((evidenceRows || []).map((row) => cleanString(row.entity_id)).filter(Boolean));
    const definitionById = new Map(definitions.map((item) => [item.id, item]));
    const missingEvidenceCount = recordRows.reduce((count, row) => {
      const definition = definitionById.get(row.activity_def_id);
      return definition?.evidenceRequired === true && !evidenceSet.has(row.id) ? count + 1 : count;
    }, 0);
    const unsupportedCategoriesCount = SCOPE3_SUPPORT_MATRIX.filter((item) => item.status !== "supported").length;
    const nonComputableRecordCount = (computed.records || []).reduce(
      (count, item) => (item?.tco2e == null || item?.factorUsed?.resolution === "missing" ? count + 1 : count),
      0,
    );

    return json({
      ok: true,
      year: parsed.filters.reportingYear,
      month: parsed.filters.month,
      companyId: parsed.filters.companyId,
      siteId: parsed.filters.siteId,
      library: parsed.filters.library,
      requestId,
      scope3Support: SCOPE3_SUPPORT_MATRIX,
      summary: {
        missingFactorsCount: Array.isArray(computed.missingFactors) ? computed.missingFactors.length : 0,
        unsupportedCategoriesCount,
        missingEvidenceCount,
        nonComputableRecordCount,
      },
      ...computed,
      warnings: [...new Set([...(computed.warnings || []), ...supportWarnings])],
    });
  } catch (error) {
    return serverError(
      requestId,
      "ghg_compute_failed",
      error instanceof Error ? error.message : "Unable to compute GHG inventory",
    );
  }
}
