import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import { fetchEntityEvidenceMap } from "../../../../_lib/esg-api.js";
import {
  ensureMaterialityDefaults,
  getMaterialityThresholds,
  normalizeMaterialityTopic,
} from "../../../../_lib/materiality-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;

  await ensureMaterialitySchema();
  const scoped = await requireTenantContext(request, tenantId, "materiality");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  await ensureMaterialityDefaults({ sql: context.sql, tenantId });

  const rows = await context.sql`
    SELECT id, tenant_id, code, name, category, description, created_at, updated_at
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
    ORDER BY category ASC, code ASC
  `;

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "materiality_topic",
    entityIds: rows.map((row) => row.id),
  });

  const thresholds = await getMaterialityThresholds({ sql: context.sql, tenantId });

  return json({
    topics: rows.map((row) => normalizeMaterialityTopic(row, evidenceMap.get(row.id) || [])),
    thresholds,
  });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;

  await ensureMaterialitySchema();
  const scoped = await requireTenantContext(request, tenantId, "materiality");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  await ensureMaterialityDefaults({ sql: context.sql, tenantId });

  const payload = await parseJsonBody(request);
  const topics = Array.isArray(payload.topics) ? payload.topics : [];

  for (const topic of topics) {
    const code = cleanString(topic.code).toUpperCase();
    const name = cleanString(topic.name);
    const category = cleanString(topic.category) || "General";

    if (!code || !name) {
      return errorJson("topics[] items require code and name", 400);
    }

    await context.sql`
      INSERT INTO materiality_topics (id, tenant_id, code, name, category, description, created_at, updated_at)
      VALUES (${randomUUID()}, ${tenantId}, ${code}, ${name}, ${category}, ${cleanString(topic.description) || null}, NOW(), NOW())
      ON CONFLICT (tenant_id, code)
      DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        updated_at = NOW()
    `;
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "materiality.topics.upsert",
    entityType: "materiality_topic",
    entityId: topics.length === 1 ? cleanString(topics[0]?.code) || "seed" : "bulk",
    payload: {
      count: topics.length,
      seededDefaults: true,
    },
  });

  const rows = await context.sql`
    SELECT id, tenant_id, code, name, category, description, created_at, updated_at
    FROM materiality_topics
    WHERE tenant_id = ${tenantId}
    ORDER BY category ASC, code ASC
  `;

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "materiality_topic",
    entityIds: rows.map((row) => row.id),
  });

  const thresholds = await getMaterialityThresholds({ sql: context.sql, tenantId });

  return json({
    ok: true,
    topics: rows.map((row) => normalizeMaterialityTopic(row, evidenceMap.get(row.id) || [])),
    thresholds,
  });
}
