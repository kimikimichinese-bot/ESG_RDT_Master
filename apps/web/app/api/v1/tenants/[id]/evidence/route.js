import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { checkEvidenceQuota, incrementTenantUsage } from "../../../_lib/db.js";
import { normalizeEvidence, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
import { buildEvidenceAccess } from "../../../_lib/storage-adapters.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";
import { logRequest, resolveRequestId } from "../../../_lib/observability.js";
import { buildRateLimitKey, consumeRateLimit } from "../../../_lib/rate-limit.js";

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

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();
  let response = null;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    response = scoped.response;
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/evidence", requestId, extra: { tenantId } });
    return response;
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
    FROM evidence
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

  response = json({
    blobEnabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    evidence: rows.map((row) => ({
      ...normalizeEvidence(row),
      ...buildEvidenceAccess(tenantId, row),
    })),
  });
  logRequest({
    request,
    response,
    startedAt,
    context: { ...context, tenantId },
    route: "/api/v1/tenants/[id]/evidence",
    requestId,
  });
  return response;
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();
  let response = null;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    response = scoped.response;
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/evidence", requestId, extra: { tenantId } });
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
      route: "/api/v1/tenants/[id]/evidence",
      requestId,
      extra: { retryAfterSec: uploadLimit.retryAfterSec },
    });
    return response;
  }
  const payload = await parseJsonBody(request);

  const filename = cleanString(payload.filename);
  const contentType = cleanString(payload.contentType) || "application/octet-stream";
  const sizeBytes = Number(payload.sizeBytes);
  const normalizedSizeBytes = Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.floor(sizeBytes) : 0;

  if (!filename) {
    response = errorJson("filename is required", 400, { requestId });
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/evidence",
      requestId,
    });
    return response;
  }

  const quotaCheck = await checkEvidenceQuota(context.sql, tenantId, normalizedSizeBytes, {
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
      route: "/api/v1/tenants/[id]/evidence",
      requestId,
    });
    return response;
  }

  const siteId = await resolveSite(context.sql, tenantId, payload.siteId);
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
      ${normalizedSizeBytes},
      ${cleanString(payload.sha256) || null},
      ${cleanString(payload.blobUrl) || null},
      ${cleanString(payload.blobUrl) ? "vercel_blob" : null},
      ${cleanString(payload.blobUrl) ? "legacy_reference" : null},
      ${cleanString(payload.blobUrl) ? "reference_only" : null},
      ${cleanString(payload.blobUrl) ? new Date().toISOString() : null},
      ${normalizeIssueDate(payload.issueDate)},
      ${normalizeDocType(payload.docType)},
      ${normalizeCoverage(payload.scopeCoverage)},
      ${payload.isEncrypted === true},
      ${cleanString(payload.language) || null}
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
    action: "evidence.create",
    entityType: "evidence",
    entityId: evidenceId,
    payload: {
      filename,
      contentType,
      siteId,
      sizeBytes: normalizedSizeBytes,
      issueDate: normalizeIssueDate(payload.issueDate),
      docType: normalizeDocType(payload.docType),
      scopeCoverage: normalizeCoverage(payload.scopeCoverage),
      isEncrypted: payload.isEncrypted === true,
      language: cleanString(payload.language) || null,
    },
  });

  await incrementTenantUsage(context.sql, tenantId, {
    evidenceBytes: normalizedSizeBytes,
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
    route: "/api/v1/tenants/[id]/evidence",
    requestId,
  });
  return response;
}
