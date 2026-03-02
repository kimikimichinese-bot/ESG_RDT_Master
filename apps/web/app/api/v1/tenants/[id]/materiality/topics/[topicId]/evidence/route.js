import { writeAuditLog } from "../../../../../../_lib/audit.js";
import { ensureMaterialitySchema } from "../../../../../../_lib/db.js";
import { fetchEntityEvidenceMap, replaceEntityEvidence } from "../../../../../../_lib/esg-api.js";
import { errorJson, json, parseJsonBody } from "../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveTopic = async (sql, tenantId, topicId) => {
  const rows = await sql`
    SELECT id
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
      AND id = ${topicId}
    LIMIT 1
  `;

  return rows?.[0]?.id || null;
};

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const topicId = params?.topicId;

  await ensureMaterialitySchema();
  const scoped = await requireTenantContext(request, tenantId, "materiality");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const validTopicId = await resolveTopic(context.sql, tenantId, topicId);
  if (!validTopicId) {
    return errorJson("Topic not found", 404);
  }

  const payload = await parseJsonBody(request);
  const evidenceIds = Array.isArray(payload.evidenceIds) ? payload.evidenceIds : [];

  await replaceEntityEvidence({
    sql: context.sql,
    tenantId,
    entityType: "materiality_topic",
    entityId: validTopicId,
    evidenceIds,
  });

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "materiality_topic",
    entityIds: [validTopicId],
  });

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "materiality.topic.evidence.update",
    entityType: "materiality_topic",
    entityId: validTopicId,
    payload: {
      evidenceIds: evidenceMap.get(validTopicId) || [],
    },
  });

  return json({
    ok: true,
    topicId: validTopicId,
    evidenceIds: evidenceMap.get(validTopicId) || [],
  });
}
