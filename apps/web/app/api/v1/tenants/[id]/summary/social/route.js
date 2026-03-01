import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { errorJson, json } from "../../../../_lib/http.js";
import { parseYear } from "../../../../_lib/esg-domain.js";
import { computeSocialSummary } from "../../../../_lib/esg-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "social");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const year = parseYear(new URL(request.url).searchParams.get("year"));
  if (!year) {
    return errorJson("Valid year is required", 400);
  }

  const [companies, sites, workforceRows, leaverRows, managementRows, flagRows] = await Promise.all([
    context.sql`
      SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
      FROM companies
      WHERE tenant_id = ${tenantId}
      ORDER BY is_holding DESC, created_at ASC
    `,
    context.sql`
      SELECT id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
      FROM sites
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `,
    context.sql`
      SELECT tenant_id, company_id, site_id, reporting_year, month, contract_type, gender, headcount, hours_worked
      FROM workforce_monthly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    context.sql`
      SELECT tenant_id, company_id, site_id, reporting_year, month, gender, leavers
      FROM workforce_leavers_monthly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    context.sql`
      SELECT tenant_id, company_id, site_id, reporting_year, gender, headcount
      FROM management_headcount_yearly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    context.sql`
      SELECT tenant_id, company_id, reporting_year, gender_pay_gap_reported, scope3_screening_performed
      FROM company_year_flags
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
  ]);

  const summary = computeSocialSummary({
    companies,
    sites,
    workforceRows,
    leaverRows,
    managementRows,
    flagRows,
  });

  return json({
    year,
    ...summary,
  });
}
