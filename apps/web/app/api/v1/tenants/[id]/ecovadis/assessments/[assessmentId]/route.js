import { writeAuditLog } from "../../../../../_lib/audit.js";
import { ensureEcoVadisSchema } from "../../../../../_lib/db.js";
import { evaluateEcoVadisAssessment, normalizeAssessmentStatus } from "../../../../../_lib/ecovadis-api.js";
import { errorJson, json, parseJsonBody } from "../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;

  await ensureEcoVadisSchema();
  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  if (!evaluated) {
    return errorJson("Assessment not found", 404);
  }

  return json(evaluated);
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;

  await ensureEcoVadisSchema();
  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const status = normalizeAssessmentStatus(payload.status);

  const rows = await context.sql`
    UPDATE ecovadis_assessments
    SET status = ${status}, updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND id = ${assessmentId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Assessment not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "ecovadis.assessment.status.update",
    entityType: "ecovadis_assessment",
    entityId: assessmentId,
    payload: {
      status,
    },
  });

  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  return json(evaluated);
}
