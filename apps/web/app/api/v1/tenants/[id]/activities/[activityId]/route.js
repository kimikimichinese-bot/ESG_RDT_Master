import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeActivity, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveSite = async (sql, tenantId, siteId) => {
  if (!siteId || typeof siteId !== "string") {
    return null;
  }

  const rows = await sql`
    SELECT id
    FROM sites
    WHERE tenant_id = ${tenantId} AND id = ${siteId}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

const resolveEvidence = async (sql, tenantId, evidenceId) => {
  if (!evidenceId || typeof evidenceId !== "string") {
    return null;
  }

  const rows = await sql`
    SELECT id
    FROM evidence
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

const parseQuantity = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const activityId = params?.activityId;
  const scoped = await requireTenantContext(request, tenantId, "activities");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT
      id,
      tenant_id,
      site_id,
      activity_type,
      period_start,
      period_end,
      quantity,
      unit,
      notes,
      evidence_id,
      created_at,
      updated_at
    FROM activities
    WHERE tenant_id = ${tenantId} AND id = ${activityId}
    LIMIT 1
  `;

  if (!rows?.[0]) {
    return errorJson("Activity not found", 404);
  }

  return json({ activity: normalizeActivity(rows[0]) });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const activityId = params?.activityId;
  const scoped = await requireTenantContext(request, tenantId, "activities");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);

  const siteId = await resolveSite(context.sql, tenantId, payload.siteId);
  if (!siteId) {
    return errorJson("Valid siteId is required", 400);
  }

  const activityType = cleanString(payload.activityType);
  const periodStart = cleanString(payload.periodStart);
  const periodEnd = cleanString(payload.periodEnd);
  const quantity = parseQuantity(payload.quantity);
  const unit = cleanString(payload.unit);

  if (!activityType || !periodStart || !periodEnd || quantity === null || !unit) {
    return errorJson("activityType, periodStart, periodEnd, quantity and unit are required", 400);
  }

  const evidenceId = await resolveEvidence(context.sql, tenantId, payload.evidenceId);

  const rows = await context.sql`
    UPDATE activities
    SET
      site_id = ${siteId},
      activity_type = ${activityType},
      period_start = ${periodStart},
      period_end = ${periodEnd},
      quantity = ${quantity},
      unit = ${unit},
      notes = ${cleanString(payload.notes)},
      evidence_id = ${evidenceId},
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND id = ${activityId}
    RETURNING
      id,
      tenant_id,
      site_id,
      activity_type,
      period_start,
      period_end,
      quantity,
      unit,
      notes,
      evidence_id,
      created_at,
      updated_at
  `;

  if (!rows?.[0]) {
    return errorJson("Activity not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "activity.update",
    entityType: "activity",
    entityId: activityId,
    payload: {
      activityType,
      periodStart,
      periodEnd,
      quantity,
      unit,
      siteId,
      evidenceId,
    },
  });

  return json({ activity: normalizeActivity(rows[0]) });
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const activityId = params?.activityId;
  const scoped = await requireTenantContext(request, tenantId, "activities");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    DELETE FROM activities
    WHERE tenant_id = ${tenantId} AND id = ${activityId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Activity not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "activity.delete",
    entityType: "activity",
    entityId: activityId,
    payload: {},
  });

  return json({ ok: true });
}
