import { PLATFORM_ROLES, getUsagePeriod } from "../../../_lib/db.js";
import { requirePlatformRole } from "../../../_lib/enterprise-api.js";
import { errorJson, json } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN, PLATFORM_ROLES.SUPPORT, PLATFORM_ROLES.BILLING]);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const url = new URL(request.url);
  const fallbackPeriod = getUsagePeriod();
  const year = Number.parseInt(url.searchParams.get("year") || "", 10);
  const month = Number.parseInt(url.searchParams.get("month") || "", 10);
  const resolvedYear = Number.isFinite(year) && year >= 2000 && year <= 9999 ? year : fallbackPeriod.year;
  const resolvedMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : fallbackPeriod.month;

  if (resolvedMonth < 1 || resolvedMonth > 12) {
    return errorJson("month must be between 1 and 12", 400);
  }

  const rows = await context.sql`
    SELECT
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.tenant_status,
      COALESCE(u.users_count, 0) AS users_count,
      COALESCE(u.evidence_bytes, 0) AS evidence_bytes,
      COALESCE(u.exports_count, 0) AS exports_count,
      COALESCE(u.jobs_count, 0) AS jobs_count,
      COALESCE(u.api_calls_count, 0) AS api_calls_count
    FROM tenants t
    LEFT JOIN tenant_usage_monthly u
      ON u.tenant_id = t.id
      AND u.year = ${resolvedYear}
      AND u.month = ${resolvedMonth}
    ORDER BY u.evidence_bytes DESC NULLS LAST, t.name ASC
  `;

  const totals = rows.reduce(
    (acc, row) => {
      acc.tenantsCount += 1;
      acc.usersCount += Number(row.users_count ?? 0);
      acc.evidenceBytes += Number(row.evidence_bytes ?? 0);
      acc.exportsCount += Number(row.exports_count ?? 0);
      acc.jobsCount += Number(row.jobs_count ?? 0);
      acc.apiCallsCount += Number(row.api_calls_count ?? 0);
      return acc;
    },
    {
      tenantsCount: 0,
      usersCount: 0,
      evidenceBytes: 0,
      exportsCount: 0,
      jobsCount: 0,
      apiCallsCount: 0,
    },
  );

  return json({
    period: {
      year: resolvedYear,
      month: resolvedMonth,
    },
    totals,
    topConsumers: rows.slice(0, 10).map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
      usersCount: Number(row.users_count ?? 0),
      evidenceBytes: Number(row.evidence_bytes ?? 0),
      exportsCount: Number(row.exports_count ?? 0),
      jobsCount: Number(row.jobs_count ?? 0),
      apiCallsCount: Number(row.api_calls_count ?? 0),
    })),
    tenants: rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
      usersCount: Number(row.users_count ?? 0),
      evidenceBytes: Number(row.evidence_bytes ?? 0),
      exportsCount: Number(row.exports_count ?? 0),
      jobsCount: Number(row.jobs_count ?? 0),
      apiCallsCount: Number(row.api_calls_count ?? 0),
    })),
  });
}
