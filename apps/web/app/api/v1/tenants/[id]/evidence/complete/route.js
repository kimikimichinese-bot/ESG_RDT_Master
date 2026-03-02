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

const sanitizeBlobKey = (tenantId, filename) => {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `evidence/${tenantId}/${Date.now()}-${safe}`;
};

const normalizeBlobToken = (value) => {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const withoutQuotes = raw.replace(/^['"]+|['"]+$/g, "").trim();
  const withoutBearer = withoutQuotes.replace(/^bearer\s+/i, "").trim();
  const asciiOnly = withoutBearer.replace(/[^\x20-\x7E]/g, "");
  const compact = asciiOnly.replace(/\s+/g, "").trim();
  if (!compact) {
    return null;
  }
  return compact;
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

  const blobToken = normalizeBlobToken(process.env.BLOB_READ_WRITE_TOKEN) || "";
  const fileBase64 = cleanString(payload.fileBase64);

  let blobUrl = cleanString(payload.blobUrl) || null;
  let sha256 = cleanString(payload.sha256) || null;
  let sizeBytes = Number.isFinite(Number(payload.sizeBytes)) ? Number(payload.sizeBytes) : 0;

  if (blobToken && fileBase64) {
    let fileBuffer = null;
    try {
      fileBuffer = Buffer.from(fileBase64, "base64");
    } catch (_error) {
      return errorJson("fileBase64 is not valid base64", 400);
    }

    sizeBytes = fileBuffer.byteLength;
    sha256 = createHash("sha256").update(fileBuffer).digest("hex");

    const { put } = await import("@vercel/blob");
    const putResult = await put(sanitizeBlobKey(tenantId, filename), fileBuffer, {
      access: "public",
      token: blobToken,
      contentType,
    });
    blobUrl = putResult?.url || blobUrl;
  } else if (fileBase64) {
    let fileBuffer = null;
    try {
      fileBuffer = Buffer.from(fileBase64, "base64");
      sizeBytes = fileBuffer.byteLength;
      sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    } catch (_error) {
      return errorJson("fileBase64 is not valid base64", 400);
    }
  }

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
      blob_url
    )
    VALUES (
      ${evidenceId},
      ${tenantId},
      ${siteId},
      ${filename},
      ${contentType},
      ${sizeBytes},
      ${sha256},
      ${blobUrl}
    )
    RETURNING id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, created_at
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
      blobEnabled: Boolean(blobToken),
    },
  });

  return json({
    blobEnabled: Boolean(blobToken),
    evidence: normalizeEvidence(rows[0]),
  });
}
