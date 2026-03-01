import { writeAuditLog } from "../../../_lib/audit.js";
import {
  fetchEntityEvidenceMap,
  getMetricRowsForSiteYear,
  getStrictWaterDischargeConfig,
  normalizeMetricDefinition,
  normalizeMetricRow,
  resolveSite,
  upsertMetricRow,
  validateAndNormalizeMetricEntries,
} from "../../../_lib/esg-api.js";
import { METRIC_DEFINITIONS, asMetricValueMap, parseYear } from "../../../_lib/esg-domain.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const url = new URL(request.url);

  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));
  const reportingYear = parseYear(url.searchParams.get("year"));
  const category = cleanString(url.searchParams.get("category"));
  const metricKey = cleanString(url.searchParams.get("metricKey"));

  const rows = await context.sql`
    SELECT
      m.id,
      m.tenant_id,
      m.company_id,
      m.site_id,
      m.reporting_year,
      m.metric_key,
      m.value,
      m.unit,
      m.created_at,
      m.updated_at
    FROM site_metrics m
    JOIN metric_definitions d ON d.key = m.metric_key
    WHERE m.tenant_id = ${tenantId}
      AND (${companyId} = '' OR m.company_id = ${companyId})
      AND (${siteId} = '' OR m.site_id = ${siteId})
      AND (${reportingYear || null}::int IS NULL OR m.reporting_year = ${reportingYear || null}::int)
      AND (${metricKey} = '' OR m.metric_key = ${metricKey})
      AND (${category} = '' OR d.category = ${category})
    ORDER BY m.reporting_year DESC, m.metric_key ASC
  `;

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "metric",
    entityIds: rows.map((row) => row.id),
  });

  return json({
    definitions: METRIC_DEFINITIONS.map((item) => normalizeMetricDefinition(item)),
    metrics: rows.map((row) => normalizeMetricRow(row, evidenceMap.get(row.id) || [])),
  });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);

  const site = await resolveSite(context.sql, tenantId, payload.siteId);
  if (!site) {
    return errorJson("Valid siteId is required", 400);
  }

  const reportingYear = parseYear(payload.reportingYear);
  if (!reportingYear) {
    return errorJson("Valid reportingYear is required", 400);
  }

  const existingRows = await getMetricRowsForSiteYear({
    sql: context.sql,
    tenantId,
    siteId: site.id,
    reportingYear,
  });

  const existingMap = asMetricValueMap(existingRows);
  const strictWaterDischarge = getStrictWaterDischargeConfig();
  const validation = validateAndNormalizeMetricEntries({
    entries: [payload],
    existingMap,
    strictWaterDischarge,
  });

  if (validation.errors.length > 0) {
    return errorJson("Metric validation failed", 400, {
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const entry = validation.normalizedEntries[0];
  const row = await upsertMetricRow({
    sql: context.sql,
    tenantId,
    companyId: site.company_id,
    siteId: site.id,
    reportingYear,
    metricKey: entry.metricKey,
    value: entry.value,
    unit: entry.unit,
  });

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "metric.upsert",
    entityType: "metric",
    entityId: row.id,
    payload: {
      siteId: site.id,
      companyId: site.company_id,
      reportingYear,
      metricKey: entry.metricKey,
      value: entry.value,
      unit: entry.unit,
      warnings: validation.warnings,
    },
  });

  return json(
    {
      metric: normalizeMetricRow(row, []),
      warnings: validation.warnings,
    },
    201,
  );
}
