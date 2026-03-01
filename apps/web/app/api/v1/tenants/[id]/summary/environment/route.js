import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { errorJson, json } from "../../../../_lib/http.js";
import { parseYear } from "../../../../_lib/esg-domain.js";
import { computeEnvironmentSummary } from "../../../../_lib/esg-api.js";

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

  const [companies, sites, metricRows] = await Promise.all([
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
      SELECT id, tenant_id, company_id, site_id, reporting_year, metric_key, value, unit
      FROM site_metrics
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
  ]);

  const summary = computeEnvironmentSummary({ companies, sites, metricRows });

  return json({
    year,
    ...summary,
  });
}
