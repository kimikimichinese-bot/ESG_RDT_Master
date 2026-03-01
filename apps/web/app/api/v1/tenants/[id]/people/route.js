import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizePerson, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

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
  const scoped = await requireTenantContext(request, tenantId, "people");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const { limit } = parsePagination(request, { limit: 200, max: 500 });

  const rows = await context.sql`
    SELECT id, tenant_id, site_id, full_name, email, title, created_at, updated_at
    FROM people
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return json({ people: rows.map((row) => normalizePerson(row)) });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
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
  const personId = randomUUID();

  try {
    const rows = await context.sql`
      INSERT INTO people (id, tenant_id, site_id, full_name, email, title)
      VALUES (${personId}, ${tenantId}, ${siteId}, ${fullName}, ${email}, ${cleanString(payload.title) || null})
      RETURNING id, tenant_id, site_id, full_name, email, title, created_at, updated_at
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "person.create",
      entityType: "person",
      entityId: personId,
      payload: { fullName, siteId },
    });

    return json({ person: normalizePerson(rows[0]) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("Email already in use within tenant", 409);
    }
    return errorJson("Failed to create person", 500, { message });
  }
}
