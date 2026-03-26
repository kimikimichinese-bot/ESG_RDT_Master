import { createHash, randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { checkEvidenceQuota, incrementTenantUsage } from "../../../../_lib/db.js";
import { normalizeEvidence, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { buildEvidenceAccess, getStorageAdapter, resolveTenantStorageConfig } from "../../../../_lib/storage-adapters.js";
import { cleanString, errorJson, json } from "../../../../_lib/http.js";
import { logRequest, resolveRequestId } from "../../../../_lib/observability.js";
import { buildRateLimitKey, consumeRateLimit } from "../../../../_lib/rate-limit.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveSiteContext = async (sql, tenantId, siteId) => {
  if (!siteId || typeof siteId !== "string") {
    return null;
  }

  const rows = await sql`
    SELECT
      s.id,
      s.name,
      s.company_id,
      c.name AS company_name
    FROM sites s
    LEFT JOIN companies c
      ON c.id = s.company_id
     AND c.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${tenantId} AND s.id = ${siteId}
    LIMIT 1
  `;
  if (!rows?.[0]) {
    return null;
  }
  return {
    id: rows[0].id,
    siteName: rows[0].name || null,
    companyId: rows[0].company_id || null,
    companyName: rows[0].company_name || null,
  };
};

const normalizeDocType = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return ["policy", "action", "reporting", "audit", "certification", "other"].includes(normalized)
    ? normalized
    : null;
};

const normalizeCoverage = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return ["tenant", "company", "site"].includes(normalized) ? normalized : null;
};

const normalizeIssueDate = (value) => {
  const normalized = cleanString(value);
  if (!normalized) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
};

const buildEvidenceUploadStorageConfig = (config) => {
  if (!config || typeof config !== "object") {
    return config;
  }
  const next = { ...config };
  if (next.folderStrategy === "tenant_company_year" && !cleanString(next.customFolderPattern)) {
    next.folderStrategy = "custom";
    next.customFolderPattern = "{tenant}/{year}/{module}/{category}";
  }
  if (next.filenameStrategy === "timestamp_original") {
    next.filenameStrategy = "original_filename";
  }
  return next;
};

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();
  let response = null;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    response = scoped.response;
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/evidence/upload", requestId, extra: { tenantId } });
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
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
      extra: { retryAfterSec: uploadLimit.retryAfterSec },
    });
    return response;
  }

  let formData = null;
  try {
    formData = await request.formData();
  } catch (_error) {
    response = errorJson("Request must be multipart/form-data", 400, { requestId });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
    });
    return response;
  }

  const file = formData.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    response = errorJson("file is required", 400, { requestId });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
    });
    return response;
  }

  const filename = cleanString(file.name);
  if (!filename) {
    response = errorJson("Uploaded file must include a filename", 400, { requestId });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
    });
    return response;
  }

  const rawSiteId = cleanString(formData.get("siteId"));
  const siteContext = await resolveSiteContext(context.sql, tenantId, rawSiteId);
  const siteId = siteContext?.id || null;
  if (rawSiteId && !siteContext) {
    response = errorJson("siteId is invalid for this tenant", 400, { requestId });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
    });
    return response;
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentType = cleanString(file.type) || "application/octet-stream";
    const sizeBytes = fileBuffer.byteLength;
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
        route: "/api/v1/tenants/[id]/evidence/upload",
        requestId,
      });
      return response;
    }
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const issueDate = normalizeIssueDate(formData.get("issueDate"));
    const docType = normalizeDocType(formData.get("docType"));
    const scopeCoverage = normalizeCoverage(formData.get("scopeCoverage"));
    const reportingYear = cleanString(formData.get("reportingYear")) || null;
    const moduleName = cleanString(formData.get("module")) || cleanString(formData.get("moduleName")) || null;
    const categoryName = cleanString(formData.get("category")) || cleanString(formData.get("categoryName")) || null;
    const activityName = cleanString(formData.get("activity")) || cleanString(formData.get("activityName")) || null;
    const entityType = cleanString(formData.get("entityType")) || null;
    const isEncrypted = cleanString(formData.get("isEncrypted")).toLowerCase() === "true";
    const language = cleanString(formData.get("language")) || null;
    const storageConfig = buildEvidenceUploadStorageConfig(await resolveTenantStorageConfig(context.sql, tenantId));
    const adapter = getStorageAdapter(storageConfig);
    const uploadResult = await adapter.uploadEvidence({
      config: storageConfig,
      tenantId,
      fileBuffer,
      filename,
      contentType,
      metadata: {
        tenantName: context.membership?.tenantName || null,
        companyId: siteContext?.companyId || null,
        companyName: siteContext?.companyName || null,
        siteId,
        siteName: siteContext?.siteName || null,
        reportingYear,
        moduleName,
        categoryName,
        activityName,
        entityType,
        issueDate,
        docType,
        scopeCoverage,
        filename,
      },
    });
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
        storage_backend,
        storage_key,
        external_file_id,
        external_drive_id,
        external_parent_id,
        external_web_url,
        source_of_truth,
        storage_status,
        last_verified_at,
        issue_date,
        doc_type,
        scope_coverage,
        is_encrypted,
        language
      )
      VALUES (
        ${evidenceId},
        ${tenantId},
        ${siteId},
        ${filename},
        ${contentType},
        ${sizeBytes},
        ${sha256},
        ${uploadResult?.blobUrl || null},
        ${storageConfig.primaryBackend || "vercel_blob"},
        ${uploadResult?.storageKey || null},
        ${uploadResult?.externalFileId || null},
        ${uploadResult?.externalDriveId || null},
        ${uploadResult?.externalParentId || null},
        ${uploadResult?.externalWebUrl || null},
        ${uploadResult?.sourceOfTruth || storageConfig.primaryBackend || "vercel_blob"},
        ${uploadResult?.storageStatus || "available"},
        ${uploadResult?.lastVerifiedAt || new Date().toISOString()},
        ${issueDate},
        ${docType},
        ${scopeCoverage},
        ${isEncrypted},
        ${language}
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
        issue_date,
        doc_type,
        scope_coverage,
        is_encrypted,
        language,
        created_at
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
        storageBackend: storageConfig.primaryBackend || "vercel_blob",
        issueDate,
        docType,
        scopeCoverage,
        isEncrypted,
        language,
      },
    });

    await incrementTenantUsage(context.sql, tenantId, {
      evidenceBytes: sizeBytes,
    });

    response = json({
      evidence: {
        ...normalizeEvidence(rows[0]),
        ...buildEvidenceAccess(tenantId, rows[0]),
      },
    }, 201);
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (/bytestring|blob_read_write_token|token/i.test(message) || error?.code === "blob_token_missing") {
      response = errorJson("Storage backend configuration error", 502, {
        message,
        hint: "Verify the active storage backend configuration and required local secrets.",
        requestId,
      });
      logRequest({
        request,
        response,
        startedAt,
        context: { ...context, tenantId },
        route: "/api/v1/tenants/[id]/evidence/upload",
        requestId,
      });
      return response;
    }
    response = errorJson("Failed to upload evidence", 500, {
      message,
      requestId,
    });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence/upload",
      requestId,
    });
    return response;
  }
}
