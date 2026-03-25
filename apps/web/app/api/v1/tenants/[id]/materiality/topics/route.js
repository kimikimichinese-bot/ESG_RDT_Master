import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import { fetchEntityEvidenceMap } from "../../../../_lib/esg-api.js";
import {
  ensureMaterialityDefaults,
  getMaterialityThresholds,
  normalizeMaterialityTopic,
  parseCustomTopicPayload,
} from "../../../../_lib/materiality-api.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) => request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const loadTopics = async ({ sql, tenantId }) => {
  const rows = await sql`
    SELECT id, tenant_id, code, name, category, group_key, sdgs, parent_topic_id, description, created_at, updated_at
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
    ORDER BY
      CASE COALESCE(group_key, '')
        WHEN 'E' THEN 1
        WHEN 'S' THEN 2
        WHEN 'G' THEN 3
        WHEN 'GEN' THEN 4
        WHEN 'CUSTOM' THEN 5
        ELSE 99
      END,
      code ASC,
      name ASC,
      created_at ASC
  `;

  const evidenceMap = await fetchEntityEvidenceMap({
    sql,
    tenantId,
    entityType: "materiality_topic",
    entityIds: rows.map((row) => row.id),
  });

  return rows.map((row) => normalizeMaterialityTopic(row, evidenceMap.get(row.id) || []));
};

const resolveParentTopicId = async ({ sql, tenantId, parentTopicId }) => {
  if (!parentTopicId) {
    return null;
  }

  const rows = await sql`
    SELECT id
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
      AND id = ${parentTopicId}
    LIMIT 1
  `;

  return rows?.[0]?.id || null;
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

    const topics = await loadTopics({ sql: context.sql, tenantId });
    const thresholds = await getMaterialityThresholds({ sql: context.sql, tenantId });

    return json({
      ok: true,
      topics,
      thresholds,
    });
  } catch (error) {
    return serverError(
      requestId,
      "materiality_topics_fetch_failed",
      error instanceof Error ? error.message : "Unable to load materiality topics",
    );
  }
}

export async function POST(request, { params }) {
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
    const rawTopics = Array.isArray(payload.topics) ? payload.topics : [payload];
    if (rawTopics.length === 0) {
      return badRequest(requestId, "invalid_payload", "name is required");
    }

    const createdTopicIds = [];

    for (const rawTopic of rawTopics) {
      const parsed = parseCustomTopicPayload(rawTopic);
      if (parsed.error) {
        return badRequest(requestId, "invalid_topic", parsed.error);
      }

      const parentTopicId = await resolveParentTopicId({
        sql: context.sql,
        tenantId,
        parentTopicId: cleanString(parsed.topic.parentTopicId),
      });
      if (parsed.topic.parentTopicId && !parentTopicId) {
        return badRequest(requestId, "invalid_parent_topic", "parentTopicId is invalid for this tenant");
      }

      const fallbackCode = parsed.topic.groupKey === "CUSTOM" ? "CUSTOM" : `${parsed.topic.groupKey}-CUSTOM`;
      const code = cleanString(parsed.topic.code) || fallbackCode;

      const insertedRows = await context.sql`
        INSERT INTO materiality_topics (
          id,
          tenant_id,
          code,
          name,
          category,
          group_key,
          sdgs,
          parent_topic_id,
          description,
          created_at,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${code},
          ${parsed.topic.name},
          ${parsed.topic.category},
          ${parsed.topic.groupKey},
          ${JSON.stringify(parsed.topic.sdgs)}::jsonb,
          ${parentTopicId},
          ${parsed.topic.description},
          NOW(),
          NOW()
        )
        RETURNING id
      `;

      if (insertedRows?.[0]?.id) {
        createdTopicIds.push(insertedRows[0].id);
      }
    }

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "materiality.topics.create",
      entityType: "materiality_topic",
      entityId: createdTopicIds.length === 1 ? createdTopicIds[0] : "bulk",
      payload: {
        count: createdTopicIds.length,
      },
    });

    const topics = await loadTopics({ sql: context.sql, tenantId });
    const thresholds = await getMaterialityThresholds({ sql: context.sql, tenantId });

    return json({
      ok: true,
      createdTopicIds,
      topics,
      thresholds,
    });
  } catch (error) {
    return serverError(
      requestId,
      "materiality_topics_create_failed",
      error instanceof Error ? error.message : "Unable to create materiality topic",
    );
  }
}
