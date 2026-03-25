import {
  PLATFORM_ROLES,
  TENANT_STATUSES,
  getTenantEntitlements,
  getTenantQuotaSnapshot,
  getTenantUsageHistory,
  getUsagePeriod,
  upsertTenantEntitlements,
} from "../../../_lib/db.js";
import { normalizeTenant, requirePlatformRole } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const readTenant = async (sql, tenantId) => {
  const rows = await sql`
    SELECT id, name, tenant_status, created_by_user_id, internal_notes, created_at, updated_at
    FROM tenants
    WHERE id = ${tenantId}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export async function GET(request, { params }) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN, PLATFORM_ROLES.SUPPORT, PLATFORM_ROLES.BILLING]);
  if (auth.response) {
    return auth.response;
  }

  const tenantId = params?.tenantId;
  const { context } = auth;
  const tenant = await readTenant(context.sql, tenantId);
  if (!tenant) {
    return errorJson("Tenant not found", 404);
  }

  const [entitlements, quotaSnapshot, usageHistory, companyRows, siteRows] = await Promise.all([
    getTenantEntitlements(context.sql, tenantId),
    getTenantQuotaSnapshot(context.sql, tenantId, getUsagePeriod()),
    getTenantUsageHistory(context.sql, tenantId, 6),
    context.sql`
      SELECT id, name, legal_name, country, is_holding, created_at
      FROM companies
      WHERE tenant_id = ${tenantId}
      ORDER BY is_holding DESC, name ASC
    `,
    context.sql`
      SELECT id, company_id, name, country, address, created_at
      FROM sites
      WHERE tenant_id = ${tenantId}
      ORDER BY name ASC
    `,
  ]);

  return json({
    tenant: normalizeTenant(tenant),
    entitlements,
    usageCurrent: quotaSnapshot?.usage || null,
    usageHistory,
    exceeded: quotaSnapshot?.exceeded || null,
    companies: companyRows.map((row) => ({
      id: row.id,
      name: row.name,
      legalName: row.legal_name || null,
      country: row.country || null,
      isHolding: Boolean(row.is_holding),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
    sites: siteRows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      country: row.country || null,
      address: row.address || "",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
  });
}

export async function PUT(request, { params }) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN]);
  if (auth.response) {
    return auth.response;
  }

  const tenantId = params?.tenantId;
  const { context } = auth;
  const payload = await parseJsonBody(request);

  const current = await readTenant(context.sql, tenantId);
  if (!current) {
    return errorJson("Tenant not found", 404);
  }

  const nextStatus = cleanString(payload.tenantStatus) || current.tenant_status || TENANT_STATUSES.ACTIVE;
  if (![TENANT_STATUSES.ACTIVE, TENANT_STATUSES.SUSPENDED, TENANT_STATUSES.ARCHIVED].includes(nextStatus)) {
    return errorJson("Invalid tenantStatus", 400);
  }

  const nextName = cleanString(payload.name) || current.name;
  const nextNotes = payload.internalNotes == null ? current.internal_notes : cleanString(payload.internalNotes) || null;

  const rows = await context.sql`
    UPDATE tenants
    SET
      name = ${nextName},
      tenant_status = ${nextStatus},
      internal_notes = ${nextNotes},
      updated_at = NOW()
    WHERE id = ${tenantId}
    RETURNING id, name, tenant_status, created_by_user_id, internal_notes, created_at, updated_at
  `;

  const hasEntitlementUpdates =
    payload.plan ||
    Number.isFinite(Number(payload.maxUsers)) ||
    Number.isFinite(Number(payload.maxEvidenceBytes)) ||
    Number.isFinite(Number(payload.maxExportsPerMonth)) ||
    Number.isFinite(Number(payload.maxJobsPerMonth)) ||
    (payload.modules && typeof payload.modules === "object" && !Array.isArray(payload.modules));

  let entitlements = await getTenantEntitlements(context.sql, tenantId);
  if (hasEntitlementUpdates) {
    entitlements = await upsertTenantEntitlements(context.sql, tenantId, {
      plan: payload.plan,
      maxUsers: payload.maxUsers,
      maxEvidenceBytes: payload.maxEvidenceBytes,
      maxExportsPerMonth: payload.maxExportsPerMonth,
      maxJobsPerMonth: payload.maxJobsPerMonth,
      modules: payload.modules,
    });
  }

  return json({
    ok: true,
    tenant: normalizeTenant(rows[0]),
    entitlements,
  });
}

export async function DELETE(request, { params }) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN]);
  if (auth.response) {
    return auth.response;
  }

  const tenantId = params?.tenantId;
  const { context } = auth;
  const rows = await context.sql`
    UPDATE tenants
    SET tenant_status = 'archived', updated_at = NOW()
    WHERE id = ${tenantId}
    RETURNING id, name, tenant_status, created_by_user_id, internal_notes, created_at, updated_at
  `;

  if (!rows?.[0]) {
    return errorJson("Tenant not found", 404);
  }

  return json({
    ok: true,
    tenant: normalizeTenant(rows[0]),
  });
}
