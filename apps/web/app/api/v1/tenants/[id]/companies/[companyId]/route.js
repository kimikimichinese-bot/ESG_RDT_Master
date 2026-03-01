import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeCompany, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseBoolean = (value) => value === true || String(value).trim().toLowerCase() === "true";

const getCompany = async (sql, tenantId, companyId) => {
  const rows = await sql`
    SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    FROM companies
    WHERE tenant_id = ${tenantId} AND id = ${companyId}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const companyId = params?.companyId;
  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const company = await getCompany(context.sql, tenantId, companyId);
  if (!company) {
    return errorJson("Company not found", 404);
  }

  return json({ company: normalizeCompany(company) });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const companyId = params?.companyId;
  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const company = await getCompany(context.sql, tenantId, companyId);

  if (!company) {
    return errorJson("Company not found", 404);
  }

  const name = cleanString(payload.name);
  if (!name) {
    return errorJson("Company name is required", 400);
  }

  const nextHolding = parseBoolean(payload.isHolding);
  if (company.is_holding && !nextHolding) {
    return errorJson("Holding company cannot be downgraded", 400);
  }

  if (nextHolding && !company.is_holding) {
    const existingHoldingRows = await context.sql`
      SELECT id
      FROM companies
      WHERE tenant_id = ${tenantId}
        AND is_holding = TRUE
        AND id <> ${companyId}
      LIMIT 1
    `;
    if (existingHoldingRows?.[0]) {
      return errorJson("A holding company already exists", 409);
    }
  }

  try {
    const rows = await context.sql`
      UPDATE companies
      SET
        name = ${name},
        legal_name = ${cleanString(payload.legalName) || null},
        country = ${cleanString(payload.country) || null},
        is_holding = ${nextHolding || company.is_holding},
        updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND id = ${companyId}
      RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    `;

    if (!rows?.[0]) {
      return errorJson("Company not found", 404);
    }

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "company.update",
      entityType: "company",
      entityId: companyId,
      payload: {
        name,
        legalName: cleanString(payload.legalName) || null,
        country: cleanString(payload.country) || null,
        isHolding: nextHolding || company.is_holding,
      },
    });

    return json({ company: normalizeCompany(rows[0]) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.toLowerCase().includes("unique")) {
      return errorJson("Company name already exists in this tenant", 409);
    }
    return errorJson("Failed to update company", 500, { message });
  }
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const companyId = params?.companyId;
  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const company = await getCompany(context.sql, tenantId, companyId);
  if (!company) {
    return errorJson("Company not found", 404);
  }

  if (company.is_holding) {
    return errorJson("Holding company cannot be deleted", 400);
  }

  const siteRows = await context.sql`
    SELECT 1
    FROM sites
    WHERE tenant_id = ${tenantId} AND company_id = ${companyId}
    LIMIT 1
  `;
  if (siteRows?.[0]) {
    return errorJson("Cannot delete company with linked sites", 409);
  }

  const rows = await context.sql`
    DELETE FROM companies
    WHERE tenant_id = ${tenantId} AND id = ${companyId}
    RETURNING id
  `;
  if (!rows?.[0]) {
    return errorJson("Company not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "company.delete",
    entityType: "company",
    entityId: companyId,
    payload: {},
  });

  return json({ ok: true });
}
