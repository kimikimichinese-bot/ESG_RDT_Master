import { writeAuditLog } from "../../../../../../_lib/audit.js";
import { ensureEcoVadisSchema } from "../../../../../../_lib/db.js";
import {
  parseEcoVadisQuestionnaireBuffer,
  resolveQuestionnaireSource,
  upsertQuestionnaireFromParsed,
} from "../../../../../../_lib/ecovadis-api.js";
import { errorJson, json } from "../../../../../../_lib/http.js";
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

  let sourceLabel = "";
  let fileBuffer = null;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (file && typeof file === "object" && typeof file.arrayBuffer === "function") {
      fileBuffer = Buffer.from(await file.arrayBuffer());
      sourceLabel = file.name || "uploaded-questionnaire.docx";
    }
  }

  if (!fileBuffer) {
    const source = await resolveQuestionnaireSource();
    if (source?.buffer) {
      fileBuffer = source.buffer;
      sourceLabel = source.source;
    }
  }

  if (!fileBuffer) {
    return errorJson("No questionnaire source found. Upload a DOCX file.", 400);
  }

  let parsedQuestions = [];
  try {
    parsedQuestions = await parseEcoVadisQuestionnaireBuffer(fileBuffer);
  } catch (error) {
    return errorJson("Failed to parse questionnaire DOCX", 400, {
      message: error instanceof Error ? error.message : "Unknown parse error",
    });
  }

  if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) {
    return errorJson("No questions detected in questionnaire", 400);
  }

  await upsertQuestionnaireFromParsed({
    sql: context.sql,
    tenantId,
    assessmentId,
    questions: parsedQuestions,
  });

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "ecovadis.questionnaire.import",
    entityType: "ecovadis_assessment",
    entityId: assessmentId,
    payload: {
      source: sourceLabel,
      questionCount: parsedQuestions.length,
    },
  });

  return json({
    ok: true,
    assessmentId,
    importedQuestions: parsedQuestions.length,
    source: sourceLabel,
  });
}
