import { randomUUID } from "node:crypto";
import { ensureDefaultEmissionFactorsForTenant, ensureHoldingCompanyForTenant, ensureTenantEntitlements } from "../_lib/db.js";
import { requireAuth } from "../_lib/enterprise-api.js";
import { errorJson, parseJsonBody, json } from "../_lib/http.js";
import { normalizeTenant } from "../_lib/enterprise-api.js";
import { writeAuditLog } from "../_lib/audit.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const rows = context.isSuperadmin
    ? await context.sql`
        SELECT t.id, t.name, t.tenant_status, t.created_by_user_id, t.internal_notes, t.created_at, t.updated_at
        FROM tenants t
        ORDER BY t.name ASC
      `
    : await context.sql`
        SELECT t.id, t.name, t.tenant_status, t.created_by_user_id, t.internal_notes, t.created_at, t.updated_at
        FROM tenants t
        JOIN memberships m ON m.tenant_id = t.id
        WHERE m.user_id = ${context.user.id}
        ORDER BY t.name ASC
      `;

  const roleByTenant = new Map(context.memberships.map((item) => [item.tenantId, item.role || null]));

  return json({
    tenants: rows.map((row) => ({
      ...normalizeTenant(row),
      role: roleByTenant.get(row.id) || (context.isSuperadmin ? "Superadmin" : null),
      isActive: row.id === context.activeTenantId,
    })),
  });
}

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  if (!context.isSuperadmin) {
    return errorJson("Only superadmin can create tenants", 403, {
      code: "platform_role_forbidden",
    });
  }
  const payload = await parseJsonBody(request);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";

  if (!name) {
    return errorJson("Tenant name is required", 400);
  }

  const tenantId = randomUUID();

  const rows = await context.sql`
    INSERT INTO tenants (id, name, tenant_status, created_by_user_id, internal_notes)
    VALUES (${tenantId}, ${name}, 'active', ${context.user.id}, ${typeof payload.internalNotes === "string" ? payload.internalNotes : null})
    RETURNING id, name, tenant_status, created_by_user_id, internal_notes, created_at, updated_at
  `;

  await ensureHoldingCompanyForTenant(context.sql, tenantId, name);
  await ensureDefaultEmissionFactorsForTenant(context.sql, tenantId);
  await ensureTenantEntitlements(context.sql, tenantId);

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenantId,
    payload: { name },
  });

  return json({ tenant: { ...normalizeTenant(rows[0]), role: "Superadmin", isActive: false } }, 201);
}
