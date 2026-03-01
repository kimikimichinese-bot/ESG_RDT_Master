import { writeAuditLog } from "../../../../../_lib/audit.js";
import { fetchEntityEvidenceMap, replaceEntityEvidence } from "../../../../../_lib/esg-api.js";
import { errorJson, json, parseJsonBody } from "../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const metricId = params?.metricId;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);

  const metricRows = await context.sql`
    SELECT id
    FROM site_metrics
    WHERE tenant_id = ${tenantId}
      AND id = ${metricId}
    LIMIT 1
  `;
  if (!metricRows?.[0]) {
    return errorJson("Metric not found", 404);
  }

  const evidenceIds = Array.isArray(payload.evidenceIds) ? payload.evidenceIds : [];
  await replaceEntityEvidence({
    sql: context.sql,
    tenantId,
    entityType: "metric",
    entityId: metricId,
    evidenceIds,
  });

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "metric",
    entityIds: [metricId],
  });

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "metric.evidence.update",
    entityType: "metric",
    entityId: metricId,
    payload: {
      evidenceIds: evidenceMap.get(metricId) || [],
    },
  });

  return json({
    metricId,
    evidenceIds: evidenceMap.get(metricId) || [],
  });
}
