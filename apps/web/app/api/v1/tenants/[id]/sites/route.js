import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizeSite, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

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
  const scoped = await requireTenantContext(request, tenantId, "sites");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const { limit } = parsePagination(request, { limit: 200, max: 500 });
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));

  const rows = await context.sql`
    SELECT id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
    FROM sites
    WHERE tenant_id = ${tenantId}
      AND (${companyId} = '' OR company_id = ${companyId})
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

  const companyId = await resolveCompanyId(context.sql, tenantId, payload.companyId);
  if (!companyId) {
    return errorJson("Valid companyId is required", 400);
  }

  const siteId = randomUUID();

  try {
    const rows = await context.sql`
      INSERT INTO sites (id, tenant_id, company_id, name, country, address, water_stressed)
      VALUES (
        ${siteId},
        ${tenantId},
        ${companyId},
        ${name},
        ${cleanString(payload.country) || null},
        ${cleanString(payload.address)},
        ${parseBoolean(payload.waterStressed)}
      )
      RETURNING id, tenant_id, company_id, name, country, address, water_stressed, created_at, updated_at
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "site.create",
      entityType: "site",
      entityId: siteId,
      payload: {
        name,
        companyId,
        country: cleanString(payload.country) || null,
        waterStressed: parseBoolean(payload.waterStressed),
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
