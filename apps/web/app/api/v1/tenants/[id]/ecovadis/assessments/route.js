import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureEcoVadisSchema } from "../../../../_lib/db.js";
import {
  evaluateEcoVadisAssessment,
  normalizeAssessmentRow,
  normalizeScopeType,
  resolveQuestionnaireSource,
} from "../../../../_lib/ecovadis-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseYear = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2200) {
    return null;
  }
  return parsed;
};

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

export async function GET(request, { params }) {
  const tenantId = params?.id;
  await ensureEcoVadisSchema();

  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const reportingYear = parseYear(url.searchParams.get("year"));

  const rows = await context.sql`
    SELECT id, tenant_id, company_id, scope_type, reporting_year, status, created_at, updated_at
    FROM ecovadis_assessments
    WHERE tenant_id = ${tenantId}
      AND (${companyId} = '' OR company_id = ${companyId})
      AND (${reportingYear || null}::int IS NULL OR reporting_year = ${reportingYear || null}::int)
    ORDER BY reporting_year DESC, updated_at DESC
  `;

  const assessments = [];
  for (const row of rows) {
    const normalized = normalizeAssessmentRow(row);
    const evaluated = await evaluateEcoVadisAssessment({
      sql: context.sql,
      tenantId,
      assessmentId: normalized.id,
    });
    assessments.push({
      ...normalized,
      check: evaluated?.check || null,
    });
  }

  const source = await resolveQuestionnaireSource().catch(() => null);

  return json({
    assessments,
    importSourceInRepo: source?.source || null,
  });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  await ensureEcoVadisSchema();

  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);

  const companyId = cleanString(payload.companyId);
  const reportingYear = parseYear(payload.reportingYear);
  const scopeType = normalizeScopeType(payload.scopeType);

  if (!companyId) {
    return errorJson("companyId is required", 400);
  }
  if (!reportingYear) {
    return errorJson("Valid reportingYear is required", 400);
  }

  const validCompanyId = await resolveCompany(context.sql, tenantId, companyId);
  if (!validCompanyId) {
    return errorJson("companyId is invalid for this tenant", 400);
  }

  const id = randomUUID();
  const rows = await context.sql`
    INSERT INTO ecovadis_assessments (id, tenant_id, company_id, scope_type, reporting_year, status, created_at, updated_at)
    VALUES (${id}, ${tenantId}, ${validCompanyId}, ${scopeType}, ${reportingYear}, 'draft', NOW(), NOW())
    ON CONFLICT (tenant_id, company_id, reporting_year, scope_type)
    DO UPDATE SET
      updated_at = NOW()
    RETURNING id, tenant_id, company_id, scope_type, reporting_year, status, created_at, updated_at
  `;

  const created = normalizeAssessmentRow(rows[0]);

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "ecovadis.assessment.upsert",
    entityType: "ecovadis_assessment",
    entityId: created.id,
    payload: {
      companyId: created.companyId,
      reportingYear: created.reportingYear,
      scopeType: created.scopeType,
    },
  });

  return json({
    assessment: created,
  }, 201);
}
