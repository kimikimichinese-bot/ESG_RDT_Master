import { randomUUID } from "node:crypto";
import { requireAuthContext } from "../_lib/enterprise-api.js";
import { errorJson, parseJsonBody, json } from "../_lib/http.js";
import { normalizeTenant } from "../_lib/enterprise-api.js";
import { writeAuditLog } from "../_lib/audit.js";
import { ensureDefaultEmissionFactorsForTenant, ensureHoldingCompanyForTenant } from "../_lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const rows = await context.sql`
    SELECT t.id, t.name, t.created_at, t.updated_at
    FROM tenants t
    JOIN memberships m ON m.tenant_id = t.id
    WHERE m.user_id = ${context.user.id}
    ORDER BY t.name ASC
  `;

  const roleByTenant = new Map(context.memberships.map((item) => [item.tenantId, item.role]));

  return json({
    tenants: rows.map((row) => ({
      ...normalizeTenant(row),
      role: roleByTenant.get(row.id) || null,
      isActive: row.id === context.activeTenantId,
    })),
  });
}

export async function POST(request) {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const payload = await parseJsonBody(request);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";

  if (!name) {
    return errorJson("Tenant name is required", 400);
  }

  const tenantId = randomUUID();

  const rows = await context.sql`
    INSERT INTO tenants (id, name)
    VALUES (${tenantId}, ${name})
    RETURNING id, name, created_at, updated_at
  `;

  await context.sql`
    INSERT INTO memberships (user_id, tenant_id, role)
    VALUES (${context.user.id}, ${tenantId}, 'TenantAdmin')
  `;
  await ensureHoldingCompanyForTenant(context.sql, tenantId, name);
  await ensureDefaultEmissionFactorsForTenant(context.sql, tenantId);

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenantId,
    payload: { name },
  });

  return json({ tenant: { ...normalizeTenant(rows[0]), role: "TenantAdmin", isActive: false } }, 201);
}
