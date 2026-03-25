import { writeAuditLog } from "../../_lib/audit.js";
import { requireTenantContext, normalizeTenant } from "../../_lib/enterprise-api.js";
import { errorJson, json, parseJsonBody } from "../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "tenant");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT id, name, created_at, updated_at
    FROM tenants
    WHERE id = ${tenantId}
    LIMIT 1
  `;

  if (!rows?.[0]) {
    return errorJson("Tenant not found", 404);
  }

  return json({
    tenant: {
      ...normalizeTenant(rows[0]),
      role: context.membership?.role || (context.isSuperadmin ? "Superadmin" : null),
      isActive: context.activeTenantId === tenantId,
    },
  });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "tenant");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";

  if (!name) {
    return errorJson("Tenant name is required", 400);
  }

  const rows = await context.sql`
    UPDATE tenants
    SET name = ${name}, updated_at = NOW()
    WHERE id = ${tenantId}
    RETURNING id, name, created_at, updated_at
  `;

  if (!rows?.[0]) {
    return errorJson("Tenant not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "tenant.update",
    entityType: "tenant",
    entityId: tenantId,
    payload: { name },
  });

  return json({ tenant: normalizeTenant(rows[0]) });
}
