import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizePerson, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseSiteId = async (sql, tenantId, siteId) => {
  if (!siteId || typeof siteId !== "string") {
    return null;
  }

  const rows = await sql`
    SELECT id
    FROM sites
    WHERE id = ${siteId} AND tenant_id = ${tenantId}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const personId = params?.personId;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT id, tenant_id, site_id, full_name, email, title, created_at, updated_at
    FROM people
    WHERE tenant_id = ${tenantId} AND id = ${personId}
    LIMIT 1
  `;

  if (!rows?.[0]) {
    return errorJson("Person not found", 404);
  }

  return json({ person: normalizePerson(rows[0]) });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const personId = params?.personId;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const fullName = cleanString(payload.fullName);

  if (!fullName) {
    return errorJson("fullName is required", 400);
  }

  const siteId = await parseSiteId(context.sql, tenantId, payload.siteId);
  const email = cleanString(payload.email).toLowerCase() || null;

  try {
    const rows = await context.sql`
      UPDATE people
      SET
        site_id = ${siteId},
        full_name = ${fullName},
        email = ${email},
        title = ${cleanString(payload.title) || null},
        updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND id = ${personId}
      RETURNING id, tenant_id, site_id, full_name, email, title, created_at, updated_at
    `;

    if (!rows?.[0]) {
      return errorJson("Person not found", 404);
    }

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "person.update",
      entityType: "person",
      entityId: personId,
      payload: { fullName, siteId },
    });

    return json({ person: normalizePerson(rows[0]) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("Email already in use within tenant", 409);
    }
    return errorJson("Failed to update person", 500, { message });
  }
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const personId = params?.personId;
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  const rows = await context.sql`
    DELETE FROM people
    WHERE tenant_id = ${tenantId} AND id = ${personId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Person not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "person.delete",
    entityType: "person",
    entityId: personId,
    payload: {},
  });

  return json({ ok: true });
}
