import { writeAuditLog } from "../../../../../../_lib/audit.js";
import { ensureStandardsSchema } from "../../../../../../_lib/db.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody } from "../../../../../../_lib/http.js";
import { applyRecommendedSetForCompany, isUuid, toRequestId } from "../../../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const resolveCompany = async (sql, tenantId, companyId) => {
  const rows = await sql`
    SELECT id
    FROM companies
    WHERE tenant_id = ${tenantId}
      AND id = ${companyId}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

export async function POST(request, { params }) {
  const requestId = toRequestId(request);
  const tenantId = params?.id;
  const companyId = params?.companyId;

  if (!tenantId || !companyId) {
    return badRequest(requestId, "missing_params", "tenant and company id are required");
  }
  if (!isUuid(companyId)) {
    return badRequest(requestId, "invalid_company_id", "companyId must be a valid UUID");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureStandardsSchema();

    const validCompanyId = await resolveCompany(context.sql, tenantId, companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const payload = await parseJsonBody(request);
    const framework = cleanString(payload.framework || payload.industryFramework).toUpperCase();
    const sasbIndustryCode = cleanString(payload.sasbIndustryCode || payload.sasb_industry_code) || null;

    const result = await applyRecommendedSetForCompany({
      sql: context.sql,
      tenantId,
      companyId: validCompanyId,
      framework,
      sasbIndustryCode,
    });

    if (result.error) {
      return badRequest(requestId, "invalid_framework", result.error);
    }

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "standards.company.apply_recommended",
      entityType: "company",
      entityId: validCompanyId,
      payload: {
        framework: result.framework,
        industryCode: result.industryCode,
        enabledCount: result.enabledCount,
      },
    });

    return json({ ok: true, result }, 200);
  } catch (error) {
    return serverError(
      requestId,
      "standards_apply_recommended_failed",
      error instanceof Error ? error.message : "Unable to apply recommended set",
    );
  }
}
