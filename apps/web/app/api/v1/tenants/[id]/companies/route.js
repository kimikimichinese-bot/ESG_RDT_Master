import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizeCompany, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseBoolean = (value) => value === true || String(value).trim().toLowerCase() === "true";

const getHoldingCompanyId = async (sql, tenantId) => {
  const rows = await sql`
    SELECT id
    FROM companies
    WHERE tenant_id = ${tenantId} AND is_holding = TRUE
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const { limit } = parsePagination(request, { limit: 300, max: 1000 });

  const rows = await context.sql`
    SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    FROM companies
    WHERE tenant_id = ${tenantId}
    ORDER BY is_holding DESC, created_at ASC
    LIMIT ${limit}
  `;

  return json({ companies: rows.map((row) => normalizeCompany(row)) });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const name = cleanString(payload.name);

  if (!name) {
    return errorJson("Company name is required", 400);
  }

  const requestedHolding = parseBoolean(payload.isHolding);
  if (requestedHolding) {
    const existingHoldingId = await getHoldingCompanyId(context.sql, tenantId);
    if (existingHoldingId) {
      return errorJson("Holding company already exists for this tenant", 409);
    }
  }

  const companyId = randomUUID();

  try {
    const rows = await context.sql`
      INSERT INTO companies (id, tenant_id, name, legal_name, country, is_holding)
      VALUES (
        ${companyId},
        ${tenantId},
        ${name},
        ${cleanString(payload.legalName) || null},
        ${cleanString(payload.country) || null},
        ${requestedHolding}
      )
      RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "company.create",
      entityType: "company",
      entityId: companyId,
      payload: {
        name,
        legalName: cleanString(payload.legalName) || null,
        country: cleanString(payload.country) || null,
        isHolding: requestedHolding,
      },
    });

    return json({ company: normalizeCompany(rows[0]) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("Company name already exists in this tenant", 409);
    }
    return errorJson("Failed to create company", 500, { message });
  }
}
