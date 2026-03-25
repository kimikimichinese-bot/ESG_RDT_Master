import { buildSessionCookie } from "../../_lib/auth.js";
import { getTenantQuotaSnapshot } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/enterprise-api.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const buildMePayload = (context, activeTenantId, quota = null) => {
  const activeMembership = context.memberships.find((item) => item.tenantId === activeTenantId) || null;
  return {
    authenticated: true,
    user: context.user,
    userId: context.user.id,
    email: context.user.email,
    name: context.user.name,
    platformRole: context.platformRole,
    memberships: context.memberships.map((item) => ({
      tenantId: item.tenantId,
      tenantName: item.tenantName,
      tenantStatus: item.tenantStatus,
      role: item.role,
    })),
    activeTenantId,
    activeRole: activeMembership?.role || null,
    impersonationReadOnly: Boolean(context.impersonationReadOnly),
    availableTenants: context.availableTenants || [],
    quota,
  };
};

const loadAvailableTenants = async (context) => {
  if (context.platformRole !== "none") {
    const rows = await context.sql`
      SELECT id, name, tenant_status
      FROM tenants
      ORDER BY name ASC
    `;
    return rows.map((row) => ({
      tenantId: row.id,
      tenantName: row.name,
      tenantStatus: row.tenant_status || "active",
      role: context.isSuperadmin ? "Superadmin" : context.platformRole,
    }));
  }

  return context.memberships.map((item) => ({
    tenantId: item.tenantId,
    tenantName: item.tenantName,
    tenantStatus: item.tenantStatus || "active",
    role: item.role,
  }));
};

export async function GET(request) {
  const auth = await requireAuth(request, { enforceWrite: false });
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  context.availableTenants = await loadAvailableTenants(context);
  const needsCookieRefresh =
    context.activeTenantId !== context.session.activeTenantId ||
    context.impersonationReadOnly !== Boolean(context.session.impersonationReadOnly);
  const quota =
    context.activeTenantId && context.sql
      ? await getTenantQuotaSnapshot(context.sql, context.activeTenantId).catch(() => null)
      : null;

  const response = new Response(JSON.stringify(buildMePayload(context, context.activeTenantId, quota)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

  if (needsCookieRefresh) {
    response.headers.set(
      "set-cookie",
      buildSessionCookie({
        userId: context.user.id,
        activeTenantId: context.activeTenantId,
        impersonationReadOnly: context.impersonationReadOnly,
      }),
    );
  }

  return response;
}

export async function PUT(request) {
  const auth = await requireAuth(request, { enforceWrite: false });
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  context.availableTenants = await loadAvailableTenants(context);
  const payload = await parseJsonBody(request);
  const nextTenantId = typeof payload.activeTenantId === "string" ? payload.activeTenantId : "";
  const nextReadOnly = payload.readOnly === true;

  const canUseTenant = context.isSuperadmin
    ? context.availableTenants.some((item) => item.tenantId === nextTenantId)
    : context.memberships.some((item) => item.tenantId === nextTenantId);
  if (!canUseTenant) {
    return errorJson("Tenant not available for current user", 403);
  }

  const quota =
    context.sql && nextTenantId ? await getTenantQuotaSnapshot(context.sql, nextTenantId).catch(() => null) : null;

  return new Response(JSON.stringify(buildMePayload(context, nextTenantId, quota)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": buildSessionCookie({
        userId: context.user.id,
        activeTenantId: nextTenantId,
        impersonationReadOnly: context.isSuperadmin ? nextReadOnly : false,
      }),
    },
  });
}
