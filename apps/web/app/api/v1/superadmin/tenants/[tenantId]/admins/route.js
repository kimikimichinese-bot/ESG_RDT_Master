import { randomUUID } from "node:crypto";
import { hashPassword } from "../../../../_lib/auth.js";
import {
  PLATFORM_ROLES,
  checkUsersQuota,
  getTenantUsersCount,
  getUsagePeriod,
  setTenantUsersUsageSnapshot,
} from "../../../../_lib/db.js";
import { requirePlatformRole } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request, { params }) {
  const auth = await requirePlatformRole(request, [PLATFORM_ROLES.SUPERADMIN]);
  if (auth.response) {
    return auth.response;
  }

  const tenantId = params?.tenantId;
  const { context } = auth;
  const payload = await parseJsonBody(request);
  const email = cleanString(payload.email).toLowerCase();
  const name = cleanString(payload.name) || "Tenant Admin";
  const password = cleanString(payload.password);
  const overrideQuota = payload.overrideQuota === true;

  if (!email || !email.includes("@")) {
    return errorJson("Valid email is required", 400);
  }

  if (password.length < 8) {
    return errorJson("Password must be at least 8 characters", 400);
  }

  const tenantRows = await context.sql`
    SELECT id, name
    FROM tenants
    WHERE id = ${tenantId}
    LIMIT 1
  `;
  if (!tenantRows?.[0]) {
    return errorJson("Tenant not found", 404);
  }

  let userRows = await context.sql`
    SELECT id, email, name
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  let userId = userRows?.[0]?.id || null;
  let createdUser = false;

  if (!userId) {
    userId = randomUUID();
    await context.sql`
      INSERT INTO users (id, email, name, password_hash, platform_role)
      VALUES (${userId}, ${email}, ${name}, ${hashPassword(password)}, 'none')
    `;
    createdUser = true;
    userRows = await context.sql`
      SELECT id, email, name
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;
  }

  const existingMembershipRows = await context.sql`
    SELECT role
    FROM memberships
    WHERE user_id = ${userId}
      AND tenant_id = ${tenantId}
    LIMIT 1
  `;

  if (!existingMembershipRows?.[0]) {
    const currentUsers = await getTenantUsersCount(context.sql, tenantId);
    const quotaCheck = await checkUsersQuota(context.sql, tenantId, {
      nextUsersCount: currentUsers + 1,
      isSuperadmin: overrideQuota,
    });
    if (!quotaCheck.allowed) {
      return errorJson("Users quota exceeded for tenant", 403, {
        code: quotaCheck.code,
        usage: quotaCheck.usage,
        limit: quotaCheck.limit,
      });
    }
  }

  await context.sql`
    INSERT INTO memberships (user_id, tenant_id, role)
    VALUES (${userId}, ${tenantId}, 'TenantAdmin')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
  `;

  const nextUsersCount = await getTenantUsersCount(context.sql, tenantId);
  await setTenantUsersUsageSnapshot(context.sql, tenantId, nextUsersCount, getUsagePeriod());

  return json(
    {
      ok: true,
      tenantId,
      admin: {
        userId,
        email: userRows?.[0]?.email || email,
        name: userRows?.[0]?.name || name,
        role: "TenantAdmin",
        createdUser,
      },
    },
    201,
  );
}
