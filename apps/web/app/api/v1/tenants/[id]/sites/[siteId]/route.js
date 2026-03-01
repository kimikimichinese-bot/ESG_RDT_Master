import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeSite, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const siteId = params?.siteId;
  const scoped = await requireTenantContext(request, tenantId, "sites");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT id, tenant_id, name, country, address, created_at, updated_at
    FROM sites
    WHERE tenant_id = ${tenantId} AND id = ${siteId}
    LIMIT 1
  `;

  if (!rows?.[0]) {
    return errorJson("Site not found", 404);
  }

  return json({ site: normalizeSite(rows[0]) });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const siteId = params?.siteId;
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

  const rows = await context.sql`
    UPDATE sites
    SET
      name = ${name},
      country = ${cleanString(payload.country)},
      address = ${cleanString(payload.address)},
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND id = ${siteId}
    RETURNING id, tenant_id, name, country, address, created_at, updated_at
  `;

  if (!rows?.[0]) {
    return errorJson("Site not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "site.update",
    entityType: "site",
    entityId: siteId,
    payload: {
      name,
      country: cleanString(payload.country),
    },
  });

  return json({ site: normalizeSite(rows[0]) });
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const siteId = params?.siteId;
  const scoped = await requireTenantContext(request, tenantId, "sites");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  const rows = await context.sql`
    DELETE FROM sites
    WHERE tenant_id = ${tenantId} AND id = ${siteId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Site not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "site.delete",
    entityType: "site",
    entityId: siteId,
    payload: {},
  });

  return json({ ok: true });
}
