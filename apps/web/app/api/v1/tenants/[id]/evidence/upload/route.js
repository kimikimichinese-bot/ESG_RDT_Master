import { createHash, randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeEvidence, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

const formatUploadError = (error) => {
  if (!error) {
    return "Unexpected upload error";
  }
  if (error instanceof Error) {
    return error.message || "Unexpected upload error";
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Unexpected upload error";
};

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  let formData = null;
  try {
    formData = await request.formData();
  } catch (_error) {
    return errorJson("Request must be multipart/form-data", 400);
  }

  const file = formData.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return errorJson("file is required", 400);
  }

  const filename = cleanString(file.name);
  if (!filename) {
    return errorJson("Uploaded file must include a filename", 400);
  }

  const rawSiteId = cleanString(formData.get("siteId"));
  const siteId = await resolveSite(context.sql, tenantId, rawSiteId);
  if (rawSiteId && !siteId) {
    return errorJson("siteId is invalid for this tenant", 400);
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentType = cleanString(file.type) || "application/octet-stream";
    const sizeBytes = fileBuffer.byteLength;
    if (sizeBytes <= 0) {
      return errorJson("Uploaded file is empty", 400);
    }
    if (sizeBytes > MAX_FILE_BYTES) {
      return errorJson(`File too large. Max ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB`, 413);
    }

    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const fileBase64 = fileBuffer.toString("base64");
    const evidenceId = randomUUID();

    const rows = await context.sql`
      INSERT INTO evidence (id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, file_base64, storage_kind)
      VALUES (
        ${evidenceId},
        ${tenantId},
        ${siteId},
        ${filename},
        ${contentType},
        ${sizeBytes},
        ${sha256},
        NULL,
        ${fileBase64},
        'db'
      )
      RETURNING id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, storage_kind, (file_base64 IS NOT NULL) AS has_file, created_at
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "evidence.upload",
      entityType: "evidence",
      entityId: evidenceId,
      payload: {
        filename,
        contentType,
        siteId,
        sizeBytes,
        sha256,
        storageKind: "db",
      },
    });

    return json({ evidence: normalizeEvidence(rows[0]) }, 201);
  } catch (error) {
    const message = formatUploadError(error);
    console.error("evidence.upload.failed", {
      tenantId,
      siteId,
      filename,
      error: message,
    });
    return errorJson("Failed to upload evidence", 500, {
      message,
    });
  }
}
