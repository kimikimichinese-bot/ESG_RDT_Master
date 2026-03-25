import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import {
  buildMaterialityReport,
  ensureMaterialityDefaults,
  getMaterialityThresholds,
  normalizeMaterialityScore,
  parseScoreRowsPayload,
  parseThresholdPayload,
  parseYearValue,
} from "../../../../_lib/materiality-api.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) => request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

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

const loadTenantTopicsMap = async (sql, tenantId) => {
  const rows = await sql`
    SELECT id, tenant_id, code, name, category, group_key, sdgs, parent_topic_id, description, created_at, updated_at
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
  `;

  return {
    rows,
    map: new Map(rows.map((row) => [row.id, row])),
  };
};

const loadSelectedTopics = async ({ sql, tenantId, companyId, reportingYear }) => {
  const rows = await sql`
    SELECT t.id, t.tenant_id, t.code, t.name, t.category, t.group_key, t.sdgs, t.parent_topic_id, t.description, t.created_at, t.updated_at
    FROM materiality_selected_topics s
    INNER JOIN materiality_topics t
      ON t.tenant_id = s.tenant_id
     AND t.id = s.topic_id
    WHERE s.tenant_id = ${tenantId}
      AND s.company_id = ${companyId}
      AND s.reporting_year = ${reportingYear}
    ORDER BY
      CASE COALESCE(t.group_key, '')
        WHEN 'E' THEN 1
        WHEN 'S' THEN 2
        WHEN 'G' THEN 3
        WHEN 'GEN' THEN 4
        WHEN 'CUSTOM' THEN 5
        ELSE 99
      END,
      t.code ASC,
      t.name ASC,
      s.created_at ASC
  `;

  return {
    rows,
    ids: rows.map((row) => row.id),
    map: new Map(rows.map((row) => [row.id, row])),
  };
};

const loadNormalizedScores = async ({ sql, tenantId, companyId, reportingYear }) => {
  const thresholds = await getMaterialityThresholds({ sql, tenantId });
  const selectedTopics = await loadSelectedTopics({ sql, tenantId, companyId, reportingYear });

  if (selectedTopics.ids.length === 0) {
    const report = buildMaterialityReport({ scores: [], thresholds });
    return {
      thresholds,
      selectedTopicIds: [],
      scores: [],
      report,
    };
  }

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
      AND topic_id = ANY(${selectedTopics.ids})
  `;

  const scoreByTopic = new Map(scoreRows.map((row) => [row.topic_id, row]));

  const normalized = selectedTopics.rows.map((topic) => {
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
    selectedTopicIds: selectedTopics.ids,
    scores: normalized,
    report: buildMaterialityReport({ scores: normalized, thresholds }),
  };
};

const parseScoresQuery = (request) => {
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const reportingYear = parseYearValue(url.searchParams.get("year"));

  if (!companyId) {
    return { error: "companyId is required" };
  }
  if (!reportingYear) {
    return { error: "Valid year is required" };
  }

  return {
    companyId,
    reportingYear,
  };
};

export async function GET(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant", "tenant id is required");
  }

  try {
    await ensureMaterialitySchema();
    const scoped = await requireTenantContext(request, tenantId, "materiality");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    await ensureMaterialityDefaults({ sql: context.sql, tenantId });

    const parsed = parseScoresQuery(request);
    if (parsed.error) {
      return badRequest(requestId, "invalid_query", parsed.error);
    }

    const validCompanyId = await resolveCompany(context.sql, tenantId, parsed.companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const normalized = await loadNormalizedScores({
      sql: context.sql,
      tenantId,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
    });

    return json({
      ok: true,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
      selectedTopicIds: normalized.selectedTopicIds,
      thresholds: normalized.thresholds,
      scores: normalized.scores,
      report: normalized.report,
    });
  } catch (error) {
    return serverError(
      requestId,
      "materiality_scores_fetch_failed",
      error instanceof Error ? error.message : "Unable to load materiality scores",
    );
  }
}

export async function PUT(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant", "tenant id is required");
  }

  try {
    await ensureMaterialitySchema();
    const scoped = await requireTenantContext(request, tenantId, "materiality");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    await ensureMaterialityDefaults({ sql: context.sql, tenantId });

    const payload = await parseJsonBody(request);
    const companyId = cleanString(payload.companyId);
    const reportingYear = parseYearValue(payload.reportingYear);

    if (!companyId) {
      return badRequest(requestId, "missing_company", "companyId is required");
    }
    if (!reportingYear) {
      return badRequest(requestId, "missing_reporting_year", "reportingYear is required");
    }

    const validCompanyId = await resolveCompany(context.sql, tenantId, companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const parsedRows = parseScoreRowsPayload(payload.rows);
    if (parsedRows.error) {
      return badRequest(requestId, "invalid_rows", parsedRows.error);
    }

    const tenantTopics = await loadTenantTopicsMap(context.sql, tenantId);
    for (const row of parsedRows.rows) {
      if (!tenantTopics.map.has(row.topicId)) {
        return badRequest(requestId, "invalid_topic_id", `Invalid topicId in rows: ${row.topicId}`);
      }
    }

    for (const row of parsedRows.rows) {
      await context.sql`
        INSERT INTO materiality_selected_topics (
          tenant_id,
          company_id,
          reporting_year,
          topic_id,
          created_at
        )
        VALUES (${tenantId}, ${validCompanyId}, ${reportingYear}, ${row.topicId}, NOW())
        ON CONFLICT (tenant_id, company_id, reporting_year, topic_id) DO NOTHING
      `;

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
        autoSelectedTopics: parsedRows.rows.map((row) => row.topicId),
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
      selectedTopicIds: normalized.selectedTopicIds,
      thresholds: normalized.thresholds,
      scores: normalized.scores,
      report: normalized.report,
    });
  } catch (error) {
    return serverError(
      requestId,
      "materiality_scores_update_failed",
      error instanceof Error ? error.message : "Unable to save materiality scores",
    );
  }
}
