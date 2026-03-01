import { computeEmissionSummary } from "../../../_lib/esg-api.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { errorJson, json } from "../../../_lib/http.js";
import { parseYear } from "../../../_lib/esg-domain.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const year = parseYear(new URL(request.url).searchParams.get("year"));
  if (!year) {
    return errorJson("Valid year is required", 400);
  }

  const [factors, metricRows, sites, companies] = await Promise.all([
    context.sql`
      SELECT key, value
      FROM emission_factors
      WHERE tenant_id = ${tenantId}
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
  ]);

  const factorsByKey = new Map(factors.map((row) => [row.key, row.value == null ? null : Number(row.value)]));

  const summary = computeEmissionSummary({
    factorsByKey,
    metricRows,
    sites,
    companies,
  });

  return json({
    year,
    ...summary,
  });
}
