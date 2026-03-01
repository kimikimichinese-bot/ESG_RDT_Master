import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeSite, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseBoolean = (value) => value === true || String(value).trim().toLowerCase() === "true";

const resolveCompanyId = async (sql, tenantId, companyId) => {
  const cleaned = cleanString(companyId);
  if (!cleaned) {
    return null;
  }

  const rows = await sql`
    SELECT id
    FROM companies
    WHERE tenant_id = ${tenantId} AND id = ${cleaned}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const siteId = params?.siteId;
  const scoped = await requireTenantContext(request, tenantId, "sites");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
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

  const companyId = await resolveCompanyId(context.sql, tenantId, payload.companyId);
  if (!companyId) {
    return errorJson("Valid companyId is required", 400);
  }

  const rows = await context.sql`
    UPDATE sites
    SET
      company_id = ${companyId},
      name = ${name},
      country = ${cleanString(payload.country) || null},
      address = ${cleanString(payload.address)},
      water_stressed = ${parseBoolean(payload.waterStressed)},
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND id = ${siteId}
    RETURNING id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
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
      companyId,
      country: cleanString(payload.country) || null,
      waterStressed: parseBoolean(payload.waterStressed),
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

  const activityRows = await context.sql`
    SELECT 1
    FROM activities
    WHERE tenant_id = ${tenantId} AND site_id = ${siteId}
    LIMIT 1
  `;
  if (activityRows?.[0]) {
    return errorJson("Cannot delete site with linked activities", 409);
  }

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
