import { writeAuditLog } from "../../../../_lib/audit.js";
import {
  fetchEntityEvidenceMap,
  getMetricRowsForSiteYear,
  getStrictWaterDischargeConfig,
  normalizeMetricRow,
  replaceEntityEvidence,
  resolveSite,
  upsertMetricRow,
  validateAndNormalizeMetricEntries,
} from "../../../../_lib/esg-api.js";
import { asMetricValueMap, parseYear } from "../../../../_lib/esg-domain.js";
import { errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const readMetricDefinitionMap = async (sql, tenantId) => {
  const rows = await sql`
    SELECT key, unit, validation
    FROM metric_definitions
    WHERE (tenant_id IS NULL OR tenant_id = ${tenantId})
      AND is_active = TRUE
      AND deleted_at IS NULL
  `;
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.key, {
      key: row.key,
      unit: row.unit,
      validation: row.validation,
    });
  }
  return map;
};

export async function PUT(request, { params }) {
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

  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    return errorJson("entries[] is required", 400);
  }

  const existingRows = await getMetricRowsForSiteYear({
    sql: context.sql,
    tenantId,
    siteId: site.id,
    reportingYear,
  });

  const validation = validateAndNormalizeMetricEntries({
    entries: payload.entries,
    existingMap: asMetricValueMap(existingRows),
    strictWaterDischarge: getStrictWaterDischargeConfig(),
    definitionByKey: await readMetricDefinitionMap(context.sql, tenantId),
  });

  if (validation.errors.length > 0) {
    return errorJson("Metric validation failed", 400, {
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const upserted = [];
  for (const entry of validation.normalizedEntries) {
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

    if (entry.evidenceIds.length > 0) {
      await replaceEntityEvidence({
        sql: context.sql,
        tenantId,
        entityType: "metric",
        entityId: row.id,
        evidenceIds: entry.evidenceIds,
      });
    }

    upserted.push(row);

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "metric.bulk.upsert",
      entityType: "metric",
      entityId: row.id,
      payload: {
        siteId: site.id,
        companyId: site.company_id,
        reportingYear,
        metricKey: entry.metricKey,
        value: entry.value,
        unit: entry.unit,
      },
    });
  }

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "metric",
    entityIds: upserted.map((row) => row.id),
  });

  return json({
    metrics: upserted.map((row) => normalizeMetricRow(row, evidenceMap.get(row.id) || [])),
    warnings: validation.warnings,
  });
}
