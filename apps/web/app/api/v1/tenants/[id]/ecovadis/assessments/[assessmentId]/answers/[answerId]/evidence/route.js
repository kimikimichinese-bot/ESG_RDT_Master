import { writeAuditLog } from "../../../../../../../../_lib/audit.js";
import { ensureEcoVadisSchema } from "../../../../../../../../_lib/db.js";
import {
  ECOVADIS_DOC_LIMIT,
  isEcoVadisEvidenceInScope,
  normalizeEcoVadisEvidenceRow,
  normalizePages,
  normalizeVisibility,
} from "../../../../../../../../_lib/ecovadis-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveAssessment = async (sql, tenantId, assessmentId) => {
  const rows = await sql`
    SELECT id, tenant_id, company_id, scope_type, reporting_year, status, created_at, updated_at
    FROM ecovadis_assessments
    WHERE tenant_id = ${tenantId}
      AND id = ${assessmentId}
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    scopeType: row.scope_type,
    reportingYear: Number(row.reporting_year),
    status: row.status,
  };
};

const resolveAnswer = async (sql, tenantId, assessmentId, answerId) => {
  const rows = await sql`
    SELECT
      a.id,
      a.selected,
      o.requires_evidence,
      o.label AS option_label,
      q.code AS question_code,
      q.text AS question_text
    FROM ecovadis_answers a
    JOIN ecovadis_options o ON o.id = a.option_id AND o.tenant_id = a.tenant_id
    JOIN ecovadis_questions q ON q.id = o.question_id AND q.tenant_id = o.tenant_id
    WHERE a.tenant_id = ${tenantId}
      AND a.id = ${answerId}
      AND q.assessment_id = ${assessmentId}
    LIMIT 1
  `;

  return rows?.[0] || null;
};

const normalizeIncomingEvidenceRows = (payload) => {
  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(payload.evidence)
      ? payload.evidence
      : Array.isArray(payload.attachments)
        ? payload.attachments
        : [];

  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const evidenceId = cleanString(row.evidenceId);
    if (!evidenceId || seen.has(evidenceId)) {
      continue;
    }
    seen.add(evidenceId);

    deduped.push({
      evidenceId,
      pages: normalizePages(row.pages),
      comment: cleanString(row.comment) || null,
      visibility: normalizeVisibility(row.visibility),
    });
  }

  return deduped;
};

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;
  const answerId = params?.answerId;

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

  const answer = await resolveAnswer(context.sql, tenantId, assessmentId, answerId);
  if (!answer) {
    return errorJson("Answer not found", 404);
  }

  if (!answer.selected) {
    return errorJson("Cannot attach evidence to an unselected answer", 400);
  }

  const payload = await parseJsonBody(request);
  const incomingRows = normalizeIncomingEvidenceRows(payload);

  if (answer.requires_evidence && incomingRows.length === 0) {
    return errorJson("Selected answer requires at least one evidence attachment", 400);
  }

  for (const row of incomingRows) {
    if (!row.pages) {
      return errorJson(`pages is required for evidence ${row.evidenceId}`, 400);
    }
  }

  const evidenceIds = incomingRows.map((row) => row.evidenceId);
  const evidenceRows =
    evidenceIds.length > 0
      ? await context.sql`
          SELECT
            e.id,
            e.tenant_id,
            e.site_id,
            s.company_id AS site_company_id,
            e.filename,
            e.content_type,
            e.size_bytes,
            e.issue_date,
            e.doc_type,
            e.scope_coverage,
            e.is_encrypted,
            e.language
          FROM evidence e
          LEFT JOIN sites s ON s.id = e.site_id
          WHERE e.tenant_id = ${tenantId}
            AND e.id = ANY(${evidenceIds})
        `
      : [];

  const normalizedEvidence = evidenceRows.map((row) => normalizeEcoVadisEvidenceRow(row));
  const evidenceById = new Map(normalizedEvidence.map((row) => [row.id, row]));

  for (const evidenceId of evidenceIds) {
    const row = evidenceById.get(evidenceId);
    if (!row) {
      return errorJson(`Evidence not found in tenant scope: ${evidenceId}`, 400);
    }

    if (!isEcoVadisEvidenceInScope({ assessment, evidence: row })) {
      return errorJson(`Evidence is out of scope for assessment: ${evidenceId}`, 400);
    }
  }

  const capRows = await context.sql`
    WITH other_links AS (
      SELECT DISTINCT ae.evidence_id
      FROM ecovadis_answer_evidence ae
      JOIN ecovadis_answers a ON a.id = ae.answer_id AND a.tenant_id = ae.tenant_id
      JOIN ecovadis_options o ON o.id = a.option_id AND o.tenant_id = a.tenant_id
      JOIN ecovadis_questions q ON q.id = o.question_id AND q.tenant_id = o.tenant_id
      WHERE ae.tenant_id = ${tenantId}
        AND q.assessment_id = ${assessmentId}
        AND a.id <> ${answerId}
    ),
    candidate AS (
      SELECT evidence_id FROM other_links
      UNION
      SELECT UNNEST(${evidenceIds}::uuid[]) AS evidence_id
    )
    SELECT COUNT(*)::int AS count
    FROM candidate
  `;

  const distinctEvidenceCount = Number(capRows?.[0]?.count || 0);
  if (distinctEvidenceCount > ECOVADIS_DOC_LIMIT) {
    return errorJson(`Distinct evidence limit exceeded (${distinctEvidenceCount}/${ECOVADIS_DOC_LIMIT})`, 400, {
      limit: ECOVADIS_DOC_LIMIT,
      distinctEvidenceCount,
    });
  }

  await context.sql`
    DELETE FROM ecovadis_answer_evidence
    WHERE tenant_id = ${tenantId}
      AND answer_id = ${answerId}
  `;

  for (const row of incomingRows) {
    await context.sql`
      INSERT INTO ecovadis_answer_evidence (tenant_id, answer_id, evidence_id, pages, comment, visibility, created_at)
      VALUES (${tenantId}, ${answerId}, ${row.evidenceId}, ${row.pages}, ${row.comment}, ${row.visibility}, NOW())
      ON CONFLICT (tenant_id, answer_id, evidence_id)
      DO UPDATE SET
        pages = EXCLUDED.pages,
        comment = EXCLUDED.comment,
        visibility = EXCLUDED.visibility
    `;
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "ecovadis.answer.evidence.replace",
    entityType: "ecovadis_answer",
    entityId: answerId,
    payload: {
      assessmentId,
      questionCode: answer.question_code,
      optionLabel: answer.option_label,
      evidenceIds,
      distinctEvidenceCount,
    },
  });

  const savedRows = await context.sql`
    SELECT evidence_id, pages, comment, visibility, created_at
    FROM ecovadis_answer_evidence
    WHERE tenant_id = ${tenantId}
      AND answer_id = ${answerId}
    ORDER BY created_at ASC
  `;

  return json({
    ok: true,
    answerId,
    evidence: savedRows.map((row) => ({
      evidenceId: row.evidence_id,
      pages: row.pages,
      comment: row.comment || null,
      visibility: row.visibility,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
    distinctEvidenceCount,
    limit: ECOVADIS_DOC_LIMIT,
  });
}
