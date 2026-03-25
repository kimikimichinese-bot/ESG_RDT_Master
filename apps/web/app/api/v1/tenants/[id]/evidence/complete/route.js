import { createHash, randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { checkEvidenceQuota, incrementTenantUsage } from "../../../../_lib/db.js";
import { normalizeEvidence, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { buildEvidenceAccess, getStorageAdapter, normalizeBlobToken, resolveTenantStorageConfig } from "../../../../_lib/storage-adapters.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { logRequest, resolveRequestId } from "../../../../_lib/observability.js";
import { buildRateLimitKey, consumeRateLimit } from "../../../../_lib/rate-limit.js";

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
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();
  let response = null;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    response = scoped.response;
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/evidence/complete", requestId, extra: { tenantId } });
    return response;
  }

  const { context } = scoped;
  const uploadLimit = consumeRateLimit({
    key: buildRateLimitKey({ tenantId, routeKey: "evidence_upload" }),
    limit: 10,
    windowMs: 60_000,
  });
  if (!uploadLimit.allowed) {
    response = errorJson("Too many evidence uploads. Please retry later.", 429, {
      code: "rate_limited",
      retryAfterSec: uploadLimit.retryAfterSec,
      requestId,
    });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/complete",
      requestId,
      extra: { retryAfterSec: uploadLimit.retryAfterSec },
    });
    return response;
  }
  const payload = await parseJsonBody(request);
  const filename = cleanString(payload.filename);

  if (!filename) {
    response = errorJson("filename is required", 400, { requestId });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/complete",
      requestId,
    });
    return response;
  }

  const contentType = cleanString(payload.contentType) || "application/octet-stream";
  const siteId = await resolveSite(context.sql, tenantId, payload.siteId);

  const blobToken = normalizeBlobToken(process.env.BLOB_READ_WRITE_TOKEN) || "";
  const fileBase64 = cleanString(payload.fileBase64);

  let blobUrl = cleanString(payload.blobUrl) || null;
  let sha256 = cleanString(payload.sha256) || null;
  let sizeBytes = Number.isFinite(Number(payload.sizeBytes)) ? Number(payload.sizeBytes) : 0;
  let fileBuffer = null;

  if (fileBase64) {
    try {
      fileBuffer = Buffer.from(fileBase64, "base64");
    } catch (_error) {
      response = errorJson("fileBase64 is not valid base64", 400, { requestId });
      logRequest({
        request,
        response,
        startedAt,
        context: { ...context, tenantId },
        route: "/api/v1/tenants/[id]/evidence/complete",
        requestId,
      });
      return response;
    }

    sizeBytes = fileBuffer.byteLength;
    sha256 = createHash("sha256").update(fileBuffer).digest("hex");
  }

  const evidenceId = randomUUID();

  const quotaCheck = await checkEvidenceQuota(context.sql, tenantId, sizeBytes, {
    isSuperadmin: context.isSuperadmin,
  });
  if (!quotaCheck.allowed) {
    response = errorJson("Evidence quota exceeded", 403, {
      code: quotaCheck.code,
      usage: quotaCheck.usage,
      limit: quotaCheck.limit,
      projected: quotaCheck.projected,
      requestId,
    });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/complete",
      requestId,
    });
    return response;
  }

  try {
    const storageConfig = await resolveTenantStorageConfig(context.sql, tenantId);
    const adapter = getStorageAdapter(storageConfig);
    const uploadResult =
      fileBuffer != null
        ? await adapter.uploadEvidence({
            config: storageConfig,
            tenantId,
            fileBuffer,
            filename,
            contentType,
            metadata: {
              siteId,
            },
          })
        : {
            blobUrl,
            storageKey: null,
            externalFileId: null,
            externalDriveId: null,
            externalParentId: null,
            externalWebUrl: blobUrl,
            sourceOfTruth: blobUrl ? "legacy_reference" : storageConfig.primaryBackend || "vercel_blob",
            storageStatus: blobUrl ? "reference_only" : "pending",
            lastVerifiedAt: blobUrl ? new Date().toISOString() : null,
          };

    blobUrl = uploadResult?.blobUrl || blobUrl;

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
      storage_backend,
      storage_key,
      external_file_id,
      external_drive_id,
      external_parent_id,
      external_web_url,
      source_of_truth,
      storage_status,
      last_verified_at
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
      ${storageConfig.primaryBackend || "vercel_blob"},
      ${uploadResult?.storageKey || null},
      ${uploadResult?.externalFileId || null},
      ${uploadResult?.externalDriveId || null},
      ${uploadResult?.externalParentId || null},
      ${uploadResult?.externalWebUrl || null},
      ${uploadResult?.sourceOfTruth || storageConfig.primaryBackend || "vercel_blob"},
      ${uploadResult?.storageStatus || "available"},
      ${uploadResult?.lastVerifiedAt || null}
    )
    RETURNING
      id,
      tenant_id,
      site_id,
      filename,
      content_type,
      size_bytes,
      sha256,
      blob_url,
      storage_backend,
      storage_key,
      external_file_id,
      external_drive_id,
      external_parent_id,
      external_web_url,
      source_of_truth,
      storage_status,
      last_verified_at,
      created_at
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
        storageBackend: storageConfig.primaryBackend || "vercel_blob",
      },
    });

    await incrementTenantUsage(context.sql, tenantId, {
      evidenceBytes: sizeBytes,
    });

    response = json({
      blobEnabled: Boolean(blobToken),
      evidence: {
        ...normalizeEvidence(rows[0]),
        ...buildEvidenceAccess(tenantId, rows[0]),
      },
    });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/complete",
      requestId,
    });
    return response;
  } catch (error) {
    response = errorJson("Failed to complete evidence upload", 500, {
      code: typeof error?.code === "string" ? error.code : "storage_upload_failed",
      message: error instanceof Error ? error.message : "Unexpected error",
      requestId,
    });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/complete",
      requestId,
    });
    return response;
  }
}
