import { buildSessionCookie } from "../../_lib/auth.js";
import { getTenantQuotaSnapshot } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/enterprise-api.js";
import { errorJson, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const buildPayload = (context, tenantId, readOnly, quota) => {
  const membership = context.memberships.find((item) => item.tenantId === tenantId) || null;
  return {
    ok: true,
    activeTenantId: tenantId,
    activeRole: membership?.role || null,
    platformRole: context.platformRole,
    impersonationReadOnly: readOnly,
    availableTenants: context.availableTenants || [],
    quota,
  };
};

export async function POST(request) {
  const auth = await requireAuth(request, { enforceWrite: false });
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  context.availableTenants = context.isSuperadmin
    ? (
        await context.sql`
          SELECT id, name, tenant_status
          FROM tenants
          ORDER BY name ASC
        `
      ).map((row) => ({
        tenantId: row.id,
        tenantName: row.name,
        tenantStatus: row.tenant_status || "active",
        role: "Superadmin",
      }))
    : context.memberships.map((item) => ({
        tenantId: item.tenantId,
        tenantName: item.tenantName,
        tenantStatus: item.tenantStatus || "active",
        role: item.role,
      }));
  const payload = await parseJsonBody(request);
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  const readOnly = payload.readOnly === true;

  if (!tenantId) {
    return errorJson("tenantId is required", 400);
  }

  const allowed = context.isSuperadmin
    ? context.availableTenants.some((item) => item.tenantId === tenantId)
    : context.memberships.some((item) => item.tenantId === tenantId);
  if (!allowed) {
    return errorJson("Tenant not available for current user", 403, {
      code: "tenant_forbidden",
    });
  }

  const impersonationReadOnly = context.isSuperadmin ? readOnly : false;
  const quota = await getTenantQuotaSnapshot(context.sql, tenantId).catch(() => null);

  return new Response(JSON.stringify(buildPayload(context, tenantId, impersonationReadOnly, quota)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": buildSessionCookie({
        userId: context.user.id,
        activeTenantId: tenantId,
        impersonationReadOnly,
      }),
    },
  });
}
