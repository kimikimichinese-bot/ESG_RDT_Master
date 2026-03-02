import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../../../_lib/audit.js";
import { ensureEcoVadisSchema } from "../../../../../../_lib/db.js";
import { evaluateEcoVadisAssessment } from "../../../../../../_lib/ecovadis-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveAssessment = async (sql, tenantId, assessmentId) => {
  const rows = await sql`
    SELECT id
    FROM ecovadis_assessments
    WHERE tenant_id = ${tenantId}
      AND id = ${assessmentId}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export async function PUT(request, { params }) {
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
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length === 0) {
    return errorJson("rows[] is required", 400);
  }

  const optionIds = [...new Set(rows.map((row) => cleanString(row.optionId)).filter(Boolean))];
  if (optionIds.length === 0) {
    return errorJson("rows[] must include optionId", 400);
  }

  const validOptionRows = await context.sql`
    SELECT o.id
    FROM ecovadis_options o
    JOIN ecovadis_questions q ON q.id = o.question_id
    WHERE o.tenant_id = ${tenantId}
      AND q.tenant_id = ${tenantId}
      AND q.assessment_id = ${assessmentId}
      AND o.id = ANY(${optionIds})
  `;

  const validOptionIds = new Set(validOptionRows.map((row) => row.id));
  for (const optionId of optionIds) {
    if (!validOptionIds.has(optionId)) {
      return errorJson(`Invalid optionId for this assessment: ${optionId}`, 400);
    }
  }

  const touchedAnswerIds = [];
  for (const row of rows) {
    const optionId = cleanString(row.optionId);
    if (!optionId) {
      continue;
    }

    const selected = row.selected === true;
    const freeText = cleanString(row.freeText) || null;

    const upserted = await context.sql`
      INSERT INTO ecovadis_answers (id, tenant_id, option_id, selected, free_text, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, ${optionId}, ${selected}, ${freeText}, NOW(), NOW())
      ON CONFLICT (tenant_id, option_id)
      DO UPDATE SET
        selected = EXCLUDED.selected,
        free_text = EXCLUDED.free_text,
        updated_at = NOW()
      RETURNING id
    `;

    const answerId = upserted?.[0]?.id;
    if (!answerId) {
      continue;
    }

    touchedAnswerIds.push(answerId);

    if (!selected) {
      await context.sql`
        DELETE FROM ecovadis_answer_evidence
        WHERE tenant_id = ${tenantId}
          AND answer_id = ${answerId}
      `;
    }
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "ecovadis.answers.bulk.upsert",
    entityType: "ecovadis_assessment",
    entityId: assessmentId,
    payload: {
      rowCount: rows.length,
      touchedAnswerIds,
    },
  });

  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  return json({
    ok: true,
    assessmentId,
    updatedAnswers: touchedAnswerIds.length,
    check: evaluated?.check || null,
  });
}
