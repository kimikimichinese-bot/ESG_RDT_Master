import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import {
  buildMaterialityReport,
  ensureMaterialityDefaults,
  getMaterialityThresholds,
  normalizeMaterialityScore,
  parseReportQuery,
} from "../../../../_lib/materiality-api.js";
import { errorJson, json } from "../../../../_lib/http.js";
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

  const topicRows = await context.sql`
    SELECT id, tenant_id, code, name, category, description, created_at, updated_at
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
    ORDER BY category ASC, code ASC
  `;
  const topicMap = new Map(topicRows.map((row) => [row.id, row]));

  const scoreRows = await context.sql`
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
      AND company_id = ${validCompanyId}
      AND reporting_year = ${parsed.reportingYear}
  `;

  const thresholds = await getMaterialityThresholds({ sql: context.sql, tenantId });
  const scoreByTopic = new Map(scoreRows.map((row) => [row.topic_id, row]));

  const normalizedScores = topicRows.map((topic) => {
    const row = scoreByTopic.get(topic.id) || {
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
    };

    return normalizeMaterialityScore({
      row,
      topic: topicMap.get(topic.id),
      thresholds,
    });
  });

  const report = buildMaterialityReport({
    scores: normalizedScores,
    thresholds,
  });

  return json({
    companyId: validCompanyId,
    reportingYear: parsed.reportingYear,
    ...report,
  });
}
