import { randomUUID } from "node:crypto";
import {
  PLATFORM_ROLES,
  ensureDefaultEmissionFactorsForTenant,
  ensureHoldingCompanyForTenant,
  ensureTenantEntitlements,
  getUsagePeriod,
  upsertTenantEntitlements,
} from "../../_lib/db.js";
import { normalizeTenant, requirePlatformRole } from "../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const normalizeQuota = (entitlements, usage, counts) => {
  const evidenceBytesCumulative = Number(usage?.evidence_bytes_cumulative ?? 0);
  const usersCount = Number(usage?.users_count ?? 0);
  const exportsCount = Number(usage?.exports_count ?? 0);
  const jobsCount = Number(usage?.jobs_count ?? 0);
  return {
    entitlements: {
      plan: entitlements?.plan || "free",
      maxUsers: Number(entitlements?.max_users ?? 0),
      maxEvidenceBytes: Number(entitlements?.max_evidence_bytes ?? 0),
      maxExportsPerMonth: Number(entitlements?.max_exports_per_month ?? 0),
      maxJobsPerMonth: Number(entitlements?.max_jobs_per_month ?? 0),
      modules: entitlements?.modules || {},
    },
    usage: {
      usersCount,
      evidenceBytes: evidenceBytesCumulative,
      exportsCount,
      jobsCount,
      apiCallsCount: Number(usage?.api_calls_count ?? 0),
    },
    counters: {
      companiesCount: Number(counts?.companies_count ?? 0),
      sitesCount: Number(counts?.sites_count ?? 0),
    },
    overQuota: {
      users: usersCount > Number(entitlements?.max_users ?? 0),
      evidence: evidenceBytesCumulative > Number(entitlements?.max_evidence_bytes ?? 0),
      exports: exportsCount > Number(entitlements?.max_exports_per_month ?? 0),
      jobs: jobsCount > Number(entitlements?.max_jobs_per_month ?? 0),
    },
  };
};

export async function GET(request) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN, PLATFORM_ROLES.SUPPORT, PLATFORM_ROLES.BILLING]);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const period = getUsagePeriod();

  const rows = await context.sql`
    SELECT
      t.id,
      t.name,
      t.tenant_status,
      t.created_by_user_id,
      t.internal_notes,
      t.created_at,
      t.updated_at,
      COALESCE(te.plan, 'free') AS plan,
      COALESCE(te.max_users, 5) AS max_users,
      COALESCE(te.max_evidence_bytes, 1073741824) AS max_evidence_bytes,
      COALESCE(te.max_exports_per_month, 50) AS max_exports_per_month,
      COALESCE(te.max_jobs_per_month, 500) AS max_jobs_per_month,
      COALESCE(te.modules, '{}'::jsonb) AS modules,
      COALESCE(tum.users_count, 0) AS users_count,
      COALESCE(tum.exports_count, 0) AS exports_count,
      COALESCE(tum.jobs_count, 0) AS jobs_count,
      COALESCE(tum.api_calls_count, 0) AS api_calls_count,
      COALESCE(cstats.companies_count, 0) AS companies_count,
      COALESCE(sstats.sites_count, 0) AS sites_count,
      COALESCE(evc.evidence_bytes_cumulative, 0) AS evidence_bytes_cumulative
    FROM tenants t
    LEFT JOIN tenant_entitlements te ON te.tenant_id = t.id
    LEFT JOIN tenant_usage_monthly tum
      ON tum.tenant_id = t.id
      AND tum.year = ${period.year}
      AND tum.month = ${period.month}
    LEFT JOIN (
      SELECT tenant_id, COUNT(*)::int AS companies_count
      FROM companies
      GROUP BY tenant_id
    ) cstats ON cstats.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*)::int AS sites_count
      FROM sites
      GROUP BY tenant_id
    ) sstats ON sstats.tenant_id = t.id
    LEFT JOIN (
      SELECT tenant_id, COALESCE(SUM(evidence_bytes), 0)::bigint AS evidence_bytes_cumulative
      FROM tenant_usage_monthly
      GROUP BY tenant_id
    ) evc ON evc.tenant_id = t.id
    ORDER BY t.name ASC
  `;

  const tenants = rows.map((row) => ({
    ...normalizeTenant(row),
    ...normalizeQuota(row, row, row),
  }));

  const totals = tenants.reduce(
    (acc, item) => {
      acc.tenantsCount += 1;
      acc.usersCount += item.usage.usersCount;
      acc.evidenceBytes += item.usage.evidenceBytes;
      acc.exportsCount += item.usage.exportsCount;
      acc.jobsCount += item.usage.jobsCount;
      acc.apiCallsCount += item.usage.apiCallsCount;
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
    period,
    totals,
    tenants,
  });
}

export async function POST(request) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN]);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const payload = await parseJsonBody(request);
  const name = cleanString(payload.name);
  if (!name) {
    return errorJson("Tenant name is required", 400);
  }

  const tenantId = randomUUID();
  const notes = cleanString(payload.internalNotes) || null;
  const rows = await context.sql`
    INSERT INTO tenants (id, name, tenant_status, created_by_user_id, internal_notes)
    VALUES (${tenantId}, ${name}, 'active', ${context.user.id}, ${notes})
    RETURNING id, name, tenant_status, created_by_user_id, internal_notes, created_at, updated_at
  `;

  await ensureTenantEntitlements(context.sql, tenantId);
  await ensureHoldingCompanyForTenant(context.sql, tenantId, name);
  await ensureDefaultEmissionFactorsForTenant(context.sql, tenantId);

  const hasQuotaPayload =
    payload.plan ||
    Number.isFinite(Number(payload.maxUsers)) ||
    Number.isFinite(Number(payload.maxEvidenceBytes)) ||
    Number.isFinite(Number(payload.maxExportsPerMonth)) ||
    Number.isFinite(Number(payload.maxJobsPerMonth)) ||
    (payload.modules && typeof payload.modules === "object" && !Array.isArray(payload.modules));

  if (hasQuotaPayload) {
    await upsertTenantEntitlements(context.sql, tenantId, {
      plan: payload.plan,
      maxUsers: payload.maxUsers,
      maxEvidenceBytes: payload.maxEvidenceBytes,
      maxExportsPerMonth: payload.maxExportsPerMonth,
      maxJobsPerMonth: payload.maxJobsPerMonth,
      modules: payload.modules,
    });
  }

  return json(
    {
      ok: true,
      tenantId,
      tenant: normalizeTenant(rows[0]),
    },
    201,
  );
}
