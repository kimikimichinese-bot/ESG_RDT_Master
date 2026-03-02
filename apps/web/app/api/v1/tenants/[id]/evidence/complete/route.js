import { createHash, randomUUID } from "node:crypto";
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

export async function POST(request, { params }) {
  const tenantId = params?.id;
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

  const contentType = cleanString(payload.contentType) || "application/octet-stream";
  const siteId = await resolveSite(context.sql, tenantId, payload.siteId);

  const fileBase64Raw = cleanString(payload.fileBase64);
  const blobUrl = cleanString(payload.blobUrl) || null;

  let fileBase64 = null;
  let sha256 = cleanString(payload.sha256) || null;
  let sizeBytes = Number.isFinite(Number(payload.sizeBytes)) ? Number(payload.sizeBytes) : 0;

  if (fileBase64Raw) {
    try {
      const fileBuffer = Buffer.from(fileBase64Raw, "base64");
      sizeBytes = fileBuffer.byteLength;
      sha256 = createHash("sha256").update(fileBuffer).digest("hex");
      fileBase64 = fileBuffer.toString("base64");
    } catch (_error) {
      return errorJson("fileBase64 is not valid base64", 400);
    }
  }

  const storageKind = fileBase64 ? "db" : blobUrl ? "blob" : "db";
  const evidenceId = randomUUID();

  const rows = await context.sql`
    INSERT INTO evidence (
      id,
      tenant_id,
      site_id,
      filename,
      content_type,
      size_bytes,
      sha256,
      blob_url,
      file_base64,
      storage_kind
    )
    VALUES (
      ${evidenceId},
      ${tenantId},
      ${siteId},
      ${filename},
      ${contentType},
      ${sizeBytes},
      ${sha256},
      ${blobUrl},
      ${fileBase64},
      ${storageKind}
    )
    RETURNING id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, storage_kind, (file_base64 IS NOT NULL) AS has_file, created_at
  `;

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "evidence.complete",
    entityType: "evidence",
    entityId: evidenceId,
    payload: {
      filename,
      contentType,
      sizeBytes,
      hasBlobUrl: Boolean(blobUrl),
      storageKind,
    },
  });

  return json({
    blobEnabled: false,
    evidence: normalizeEvidence(rows[0]),
  });
}
