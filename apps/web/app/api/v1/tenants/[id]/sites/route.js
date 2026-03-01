import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizeSite, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "sites");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const { limit } = parsePagination(request, { limit: 200, max: 500 });

  const rows = await context.sql`
    SELECT id, tenant_id, name, country, address, created_at, updated_at
    FROM sites
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return json({ sites: rows.map((row) => normalizeSite(row)) });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "sites");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const name = cleanString(payload.name);

  if (!name) {
    return errorJson("Site name is required", 400);
  }

  const siteId = randomUUID();

  try {
    const rows = await context.sql`
      INSERT INTO sites (id, tenant_id, name, country, address)
      VALUES (
        ${siteId},
        ${tenantId},
        ${name},
        ${cleanString(payload.country)},
        ${cleanString(payload.address)}
      )
      RETURNING id, tenant_id, name, country, address, created_at, updated_at
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "site.create",
      entityType: "site",
      entityId: siteId,
      payload: {
        name,
        country: cleanString(payload.country),
      },
    });

    return json({ site: normalizeSite(rows[0]) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("A site with this name already exists in this tenant", 409);
    }
    return errorJson("Failed to create site", 500, { message });
  }
}
