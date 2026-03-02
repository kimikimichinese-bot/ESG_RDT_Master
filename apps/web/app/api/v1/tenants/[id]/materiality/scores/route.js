import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import {
  buildMaterialityReport,
  ensureMaterialityDefaults,
  getMaterialityThresholds,
  normalizeMaterialityScore,
  parseReportQuery,
  parseScoreRowsPayload,
  parseThresholdPayload,
} from "../../../../_lib/materiality-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

const loadTopicsMap = async (sql, tenantId) => {
  const rows = await sql`
    SELECT id, tenant_id, code, name, category, description, created_at, updated_at
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
    ORDER BY category ASC, code ASC
  `;

  return {
    rows,
    map: new Map(rows.map((row) => [row.id, row])),
  };
};

const loadNormalizedScores = async ({ sql, tenantId, companyId, reportingYear }) => {
  const thresholds = await getMaterialityThresholds({ sql, tenantId });
  const topicData = await loadTopicsMap(sql, tenantId);

  const scoreRows = await sql`
    SELECT
      tenant_id,
      company_id,
      reporting_year,
      topic_id,
      impact_severity,
      impact_scope,
      impact_irremediability,
      impact_likelihood,
      financial_magnitude,
      financial_likelihood,
      notes,
      updated_at
    FROM materiality_scores
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND reporting_year = ${reportingYear}
  `;

  const scoreByTopic = new Map(scoreRows.map((row) => [row.topic_id, row]));

  const normalized = topicData.rows.map((topic) => {
    const row = scoreByTopic.get(topic.id) || {
      tenant_id: tenantId,
      company_id: companyId,
      reporting_year: reportingYear,
      topic_id: topic.id,
      impact_severity: 3,
      impact_scope: 3,
      impact_irremediability: 3,
      impact_likelihood: 3,
      financial_magnitude: 3,
      financial_likelihood: 3,
      notes: "",
      updated_at: null,
    };

    return normalizeMaterialityScore({
      row,
      topic,
      thresholds,
    });
  });

  return {
    thresholds,
    topics: topicData.rows,
    topicMap: topicData.map,
    scores: normalized,
    report: buildMaterialityReport({ scores: normalized, thresholds }),
  };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;

  await ensureMaterialitySchema();
  const scoped = await requireTenantContext(request, tenantId, "materiality");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  await ensureMaterialityDefaults({ sql: context.sql, tenantId });

  const parsed = parseReportQuery(request);
  if (parsed.error) {
    return errorJson(parsed.error, 400);
  }

  const validCompanyId = await resolveCompany(context.sql, tenantId, parsed.companyId);
  if (!validCompanyId) {
    return errorJson("companyId is invalid for this tenant", 400);
  }

  const normalized = await loadNormalizedScores({
    sql: context.sql,
    tenantId,
    companyId: validCompanyId,
    reportingYear: parsed.reportingYear,
  });

  return json({
    companyId: validCompanyId,
    reportingYear: parsed.reportingYear,
    thresholds: normalized.thresholds,
    scores: normalized.scores,
  });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;

  await ensureMaterialitySchema();
  const scoped = await requireTenantContext(request, tenantId, "materiality");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  await ensureMaterialityDefaults({ sql: context.sql, tenantId });

  const payload = await parseJsonBody(request);
  const companyId = cleanString(payload.companyId);
  const reportingYear = Number.parseInt(String(payload.reportingYear || "").trim(), 10);

  if (!companyId) {
    return errorJson("companyId is required", 400);
  }
  if (!Number.isInteger(reportingYear)) {
    return errorJson("reportingYear is required", 400);
  }

  const validCompanyId = await resolveCompany(context.sql, tenantId, companyId);
  if (!validCompanyId) {
    return errorJson("companyId is invalid for this tenant", 400);
  }

  const parsedRows = parseScoreRowsPayload(payload.rows);
  if (parsedRows.error) {
    return errorJson(parsedRows.error, 400);
  }

  const topicData = await loadTopicsMap(context.sql, tenantId);
  for (const row of parsedRows.rows) {
    if (!topicData.map.has(row.topicId)) {
      return errorJson(`Invalid topicId in rows: ${row.topicId}`, 400);
    }
  }

  for (const row of parsedRows.rows) {
    await context.sql`
      INSERT INTO materiality_scores (
        tenant_id,
        company_id,
        reporting_year,
        topic_id,
        impact_severity,
        impact_scope,
        impact_irremediability,
        impact_likelihood,
        financial_magnitude,
        financial_likelihood,
        notes,
        updated_at
      )
      VALUES (
        ${tenantId},
        ${validCompanyId},
        ${reportingYear},
        ${row.topicId},
        ${row.impactSeverity},
        ${row.impactScope},
        ${row.impactIrremediability},
        ${row.impactLikelihood},
        ${row.financialMagnitude},
        ${row.financialLikelihood},
        ${row.notes},
        NOW()
      )
      ON CONFLICT (tenant_id, company_id, reporting_year, topic_id)
      DO UPDATE SET
        impact_severity = EXCLUDED.impact_severity,
        impact_scope = EXCLUDED.impact_scope,
        impact_irremediability = EXCLUDED.impact_irremediability,
        impact_likelihood = EXCLUDED.impact_likelihood,
        financial_magnitude = EXCLUDED.financial_magnitude,
        financial_likelihood = EXCLUDED.financial_likelihood,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `;
  }

  const parsedThresholds = parseThresholdPayload(payload.thresholds);
  if (parsedThresholds) {
    await context.sql`
      INSERT INTO materiality_thresholds (tenant_id, impact_threshold, financial_threshold, updated_at)
      VALUES (${tenantId}, ${parsedThresholds.impactThreshold}, ${parsedThresholds.financialThreshold}, NOW())
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        impact_threshold = EXCLUDED.impact_threshold,
        financial_threshold = EXCLUDED.financial_threshold,
        updated_at = NOW()
    `;
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "materiality.scores.bulk.upsert",
    entityType: "materiality_score",
    entityId: `${validCompanyId}:${reportingYear}`,
    payload: {
      rows: parsedRows.rows.length,
      thresholdsUpdated: Boolean(parsedThresholds),
    },
  });

  const normalized = await loadNormalizedScores({
    sql: context.sql,
    tenantId,
    companyId: validCompanyId,
    reportingYear,
  });

  return json({
    ok: true,
    companyId: validCompanyId,
    reportingYear,
    thresholds: normalized.thresholds,
    scores: normalized.scores,
    report: normalized.report,
  });
}
