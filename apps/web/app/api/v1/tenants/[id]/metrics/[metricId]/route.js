import { writeAuditLog } from "../../../../_lib/audit.js";
import { errorJson, json } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const metricId = params?.metricId;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    DELETE FROM site_metrics
    WHERE tenant_id = ${tenantId} AND id = ${metricId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Metric not found", 404);
  }

  await context.sql`
    DELETE FROM entity_evidence
    WHERE tenant_id = ${tenantId}
      AND entity_type = 'metric'
      AND entity_id = ${metricId}
  `;

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "metric.delete",
    entityType: "metric",
    entityId: metricId,
    payload: {},
  });

  return json({ ok: true });
}
