import { randomUUID } from "node:crypto";
import { hashPassword } from "../../../_lib/auth.js";
import { writeAuditLog } from "../../../_lib/audit.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";
import { isValidRole } from "../../../_lib/rbac.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const normalizeMember = (row) => ({
  userId: row.user_id,
  email: row.email,
  name: row.name,
  role: row.role,
  joinedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
});

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "members");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT m.user_id, u.email, u.name, m.role, m.created_at
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId}
    ORDER BY m.created_at ASC
  `;

  return json({ members: rows.map((row) => normalizeMember(row)) });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "members");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const email = cleanString(payload.email).toLowerCase();
  const role = cleanString(payload.role);

  if (!email || !email.includes("@")) {
    return errorJson("Valid member email is required", 400);
  }

  if (!isValidRole(role)) {
    return errorJson("Invalid role", 400);
  }

  let user = null;
  const existingRows = await context.sql`
    SELECT id, email, name
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  user = existingRows?.[0] || null;

  if (!user) {
    const name = cleanString(payload.name) || email.split("@")[0];
    const password = cleanString(payload.password);
    if (password.length < 8) {
      return errorJson("Password (>=8 chars) required when creating a new user", 400);
    }

    const created = await context.sql`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (${randomUUID()}, ${email}, ${name}, ${hashPassword(password)})
      RETURNING id, email, name
    `;
    user = created[0];
  }

  await context.sql`
    INSERT INTO memberships (user_id, tenant_id, role)
    VALUES (${user.id}, ${tenantId}, ${role})
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
  `;

  const rows = await context.sql`
    SELECT m.user_id, u.email, u.name, m.role, m.created_at
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId} AND m.user_id = ${user.id}
    LIMIT 1
  `;

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "membership.upsert",
    entityType: "membership",
    entityId: user.id,
    payload: { role, email },
  });

  return json({ member: normalizeMember(rows[0]) }, 201);
}

export async function PATCH(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "members");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const userId = cleanString(payload.userId);
  const role = cleanString(payload.role);

  if (!userId) {
    return errorJson("userId is required", 400);
  }

  if (!isValidRole(role)) {
    return errorJson("Invalid role", 400);
  }

  const rows = await context.sql`
    UPDATE memberships
    SET role = ${role}
    WHERE tenant_id = ${tenantId} AND user_id = ${userId}
    RETURNING user_id, role, created_at
  `;

  if (!rows?.[0]) {
    return errorJson("Membership not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "membership.role.update",
    entityType: "membership",
    entityId: userId,
    payload: { role },
  });

  return json({ ok: true, membership: rows[0] });
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "members");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const userId = cleanString(payload.userId);

  if (!userId) {
    return errorJson("userId is required", 400);
  }

  if (userId === context.user.id) {
    const countRows = await context.sql`
      SELECT COUNT(*)::int AS count
      FROM memberships
      WHERE tenant_id = ${tenantId}
    `;
    const total = Number(countRows?.[0]?.count ?? 0);
    if (total <= 1) {
      return errorJson("Cannot remove the last member of a tenant", 400);
    }
  }

  const rows = await context.sql`
    DELETE FROM memberships
    WHERE tenant_id = ${tenantId} AND user_id = ${userId}
    RETURNING user_id
  `;

  if (!rows?.[0]) {
    return errorJson("Membership not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "membership.remove",
    entityType: "membership",
    entityId: userId,
    payload: {},
  });

  return json({ ok: true });
}
