import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeEvidence, requireTenantContext } from "../../../../_lib/enterprise-api.js";
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

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const evidenceId = params?.evidenceId;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    SELECT id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, created_at
    FROM evidence
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
    LIMIT 1
  `;

  if (!rows?.[0]) {
    return errorJson("Evidence not found", 404);
  }

  return json({ evidence: normalizeEvidence(rows[0]) });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const evidenceId = params?.evidenceId;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);

  const filename = cleanString(payload.filename);
  if (!filename) {
    return errorJson("filename is required", 400);
  }

  const siteId = await resolveSite(context.sql, tenantId, payload.siteId);
  const sizeBytes = Number(payload.sizeBytes);

  const rows = await context.sql`
    UPDATE evidence
    SET
      site_id = ${siteId},
      filename = ${filename},
      content_type = ${cleanString(payload.contentType) || "application/octet-stream"},
      size_bytes = ${Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0},
      sha256 = ${cleanString(payload.sha256) || null},
      blob_url = ${cleanString(payload.blobUrl) || null}
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
    RETURNING id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, created_at
  `;

  if (!rows?.[0]) {
    return errorJson("Evidence not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "evidence.update",
    entityType: "evidence",
    entityId: evidenceId,
    payload: { filename, siteId },
  });

  return json({ evidence: normalizeEvidence(rows[0]) });
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const evidenceId = params?.evidenceId;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const rows = await context.sql`
    DELETE FROM evidence
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
    RETURNING id
  `;

  if (!rows?.[0]) {
    return errorJson("Evidence not found", 404);
  }

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "evidence.delete",
    entityType: "evidence",
    entityId: evidenceId,
    payload: {},
  });

  return json({ ok: true });
}
