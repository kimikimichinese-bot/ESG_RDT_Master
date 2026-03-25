import { randomUUID } from "node:crypto";
import { checkMonthlyQuota, ensureMaterialitySchema, incrementTenantUsage } from "../../../../_lib/db.js";
import {
  buildMaterialityReport,
  ensureMaterialityDefaults,
  getCachedMaterialityReport,
  getMaterialityThresholds,
  normalizeMaterialityScore,
  parseReportQuery,
  setCachedMaterialityReport,
} from "../../../../_lib/materiality-api.js";
import { json } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) => request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message, extra = {}) => json({ ok: false, code, message, requestId, ...extra }, 400);
const forbidden = (requestId, code, message, extra = {}) => json({ ok: false, code, message, requestId, ...extra }, 403);
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

const loadSelectedTopicsWithScores = async ({ sql, tenantId, companyId, reportingYear }) => {
  const rows = await sql`
    SELECT
      t.id,
      t.tenant_id,
      t.code,
      t.name,
      t.category,
      t.group_key,
      t.sdgs,
      t.parent_topic_id,
      t.description,
      t.created_at,
      t.updated_at,
      sc.impact_severity,
      sc.impact_scope,
      sc.impact_irremediability,
      sc.impact_likelihood,
      sc.financial_magnitude,
      sc.financial_likelihood,
      sc.notes AS score_notes,
      sc.updated_at AS score_updated_at
    FROM materiality_selected_topics s
    INNER JOIN materiality_topics t
      ON t.tenant_id = s.tenant_id
     AND t.id = s.topic_id
    LEFT JOIN materiality_scores sc
      ON sc.tenant_id = s.tenant_id
     AND sc.company_id = s.company_id
     AND sc.reporting_year = s.reporting_year
     AND sc.topic_id = s.topic_id
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
    topicIds: rows.map((row) => row.id),
    topicMap: new Map(rows.map((row) => [row.id, row])),
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
    const quotaCheck = await checkMonthlyQuota(context.sql, tenantId, "exports", {
      increment: 1,
      isSuperadmin: context.isSuperadmin,
    });
    if (!quotaCheck.allowed) {
      return forbidden(requestId, quotaCheck.code || "quota_exceeded", "Exports quota exceeded", {
        usage: quotaCheck.usage,
        limit: quotaCheck.limit,
        projected: quotaCheck.projected,
      });
    }

    await ensureMaterialityDefaults({ sql: context.sql, tenantId });

    const parsed = parseReportQuery(request);
    if (parsed.error) {
      return badRequest(requestId, "invalid_query", parsed.error);
    }

    const cacheKey = `${tenantId}:${parsed.companyId}:${parsed.reportingYear}`;
    const cached = getCachedMaterialityReport(cacheKey);
    if (cached) {
      return json(cached);
    }

    const validCompanyId = await resolveCompany(context.sql, tenantId, parsed.companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const selectedTopics = await loadSelectedTopicsWithScores({
      sql: context.sql,
      tenantId,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
    });

    const thresholds = await getMaterialityThresholds({ sql: context.sql, tenantId });
    let normalizedScores = [];

    if (selectedTopics.topicIds.length > 0) {
      normalizedScores = selectedTopics.rows.map((topic) => {
        const row =
          topic.impact_severity == null
            ? {
          tenant_id: tenantId,
          company_id: validCompanyId,
          reporting_year: parsed.reportingYear,
          topic_id: topic.id,
          impact_severity: 3,
          impact_scope: 3,
          impact_irremediability: 3,
          impact_likelihood: 3,
          financial_magnitude: 3,
          financial_likelihood: 3,
          notes: "",
          updated_at: null,
            }
            : {
                tenant_id: tenantId,
                company_id: validCompanyId,
                reporting_year: parsed.reportingYear,
                topic_id: topic.id,
                impact_severity: topic.impact_severity,
                impact_scope: topic.impact_scope,
                impact_irremediability: topic.impact_irremediability,
                impact_likelihood: topic.impact_likelihood,
                financial_magnitude: topic.financial_magnitude,
                financial_likelihood: topic.financial_likelihood,
                notes: topic.score_notes || "",
                updated_at: topic.score_updated_at || null,
              };

        return normalizeMaterialityScore({
          row,
          topic: selectedTopics.topicMap.get(topic.id),
          thresholds,
        });
      });
    }

    const report = buildMaterialityReport({
      scores: normalizedScores,
      thresholds,
    });

    await incrementTenantUsage(context.sql, tenantId, {
      exportsCount: 1,
    });

    const responsePayload = {
      ok: true,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
      selectedTopicIds: selectedTopics.topicIds,
      ...report,
    };

    return json(setCachedMaterialityReport(cacheKey, responsePayload));
  } catch (error) {
    return serverError(
      requestId,
      "materiality_report_failed",
      error instanceof Error ? error.message : "Unable to generate materiality report",
    );
  }
}
