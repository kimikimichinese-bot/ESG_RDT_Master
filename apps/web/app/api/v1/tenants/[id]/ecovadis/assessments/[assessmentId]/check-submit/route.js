import { writeAuditLog } from "../../../../../../_lib/audit.js";
import { ensureEcoVadisSchema } from "../../../../../../_lib/db.js";
import { evaluateEcoVadisAssessment } from "../../../../../../_lib/ecovadis-api.js";
import { errorJson, json, parseJsonBody } from "../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveAssessment = async (sql, tenantId, assessmentId) => {
  const rows = await sql`
    SELECT id, status
    FROM ecovadis_assessments
    WHERE tenant_id = ${tenantId}
      AND id = ${assessmentId}
    LIMIT 1
  `;

  return rows?.[0] || null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;

  await ensureEcoVadisSchema();
  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const assessment = await resolveAssessment(context.sql, tenantId, assessmentId);
  if (!assessment) {
    return errorJson("Assessment not found", 404);
  }

  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  return json({
    ok: true,
    assessmentId,
    status: assessment.status,
    check: evaluated?.check || null,
  });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;

  await ensureEcoVadisSchema();
  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const assessment = await resolveAssessment(context.sql, tenantId, assessmentId);
  if (!assessment) {
    return errorJson("Assessment not found", 404);
  }

  const payload = await parseJsonBody(request);
  const submit = payload.submit === true;

  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  if (!evaluated) {
    return errorJson("Assessment not found", 404);
  }

  if (submit && !evaluated.check.canSubmit) {
    return errorJson("Assessment failed Check & Submit requirements", 400, {
      check: evaluated.check,
    });
  }

  const nextStatus = submit ? "submitted" : evaluated.check.canSubmit ? "ready" : "draft";

  await context.sql`
    UPDATE ecovadis_assessments
    SET status = ${nextStatus}, updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND id = ${assessmentId}
  `;

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: submit ? "ecovadis.check_submit.submit" : "ecovadis.check_submit.validate",
    entityType: "ecovadis_assessment",
    entityId: assessmentId,
    payload: {
      nextStatus,
      canSubmit: evaluated.check.canSubmit,
      blockerCount: evaluated.check.blockerCount,
    },
  });

  return json({
    ok: true,
    assessmentId,
    status: nextStatus,
    check: evaluated.check,
  });
}
