import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizeActivity, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

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
  const scoped = await requireTenantContext(request, tenantId, "activities");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const { limit } = parsePagination(request, { limit: 200, max: 500 });
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));

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
    WHERE tenant_id = ${tenantId}
      AND (${siteId} = '' OR site_id::text = ${siteId})
      AND (
        ${companyId} = ''
        OR site_id IN (
          SELECT s.id
          FROM sites s
          WHERE s.tenant_id = ${tenantId}
            AND s.company_id::text = ${companyId}
        )
      )
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return json({ activities: rows.map((row) => normalizeActivity(row)) });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
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
  const activityId = randomUUID();

  const rows = await context.sql`
    INSERT INTO activities (
      id,
      tenant_id,
      site_id,
      activity_type,
      period_start,
      period_end,
      quantity,
      unit,
      notes,
      evidence_id
    )
    VALUES (
      ${activityId},
      ${tenantId},
      ${siteId},
      ${activityType},
      ${periodStart},
      ${periodEnd},
      ${quantity},
      ${unit},
      ${cleanString(payload.notes)},
      ${evidenceId}
    )
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

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "activity.create",
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

  return json({ activity: normalizeActivity(rows[0]) }, 201);
}
