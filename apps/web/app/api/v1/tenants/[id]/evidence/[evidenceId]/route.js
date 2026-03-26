import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeEvidence, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { buildEvidenceAccess, getStorageAdapter, resolveTenantStorageConfig } from "../../../../_lib/storage-adapters.js";
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
  const evidenceId = params?.evidenceId;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
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
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
    LIMIT 1
  `;

  if (!rows?.[0]) {
    return errorJson("Evidence not found", 404);
  }

  return json({
    evidence: {
      ...normalizeEvidence(rows[0]),
      ...buildEvidenceAccess(tenantId, rows[0]),
    },
  });
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
      blob_url = ${cleanString(payload.blobUrl) || null},
      storage_backend = ${cleanString(payload.storageBackend) || (cleanString(payload.blobUrl) ? "vercel_blob" : null)},
      issue_date = ${normalizeIssueDate(payload.issueDate)},
      doc_type = ${normalizeDocType(payload.docType)},
      scope_coverage = ${normalizeCoverage(payload.scopeCoverage)},
      is_encrypted = ${payload.isEncrypted === true},
      language = ${cleanString(payload.language) || null}
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
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

  return json({
    evidence: {
      ...normalizeEvidence(rows[0]),
      ...buildEvidenceAccess(tenantId, rows[0]),
    },
  });
}

export async function DELETE(request, { params }) {
  const tenantId = params?.id;
  const evidenceId = params?.evidenceId;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const evidenceRows = await context.sql`
    SELECT
      e.id,
      e.tenant_id,
      e.site_id,
      e.filename,
      e.content_type,
      e.size_bytes,
      e.sha256,
      e.blob_url,
      e.storage_backend,
      e.storage_key,
      e.external_file_id,
      e.external_drive_id,
      e.external_parent_id,
      e.external_web_url,
      e.source_of_truth,
      e.storage_status,
      e.last_verified_at,
      e.issue_date,
      e.doc_type,
      e.scope_coverage,
      e.is_encrypted,
      e.language,
      e.created_at,
      s.name AS site_name,
      c.id AS company_id,
      c.name AS company_name,
      t.name AS tenant_name
    FROM evidence e
    LEFT JOIN sites s
      ON s.id = e.site_id
     AND s.tenant_id = e.tenant_id
    LEFT JOIN companies c
      ON c.id = s.company_id
     AND c.tenant_id = e.tenant_id
    LEFT JOIN tenants t
      ON t.id = e.tenant_id
    WHERE e.tenant_id = ${tenantId} AND e.id = ${evidenceId}
    LIMIT 1
  `;

  const evidenceRow = evidenceRows?.[0];
  if (!evidenceRow) {
    return errorJson("Evidence not found", 404);
  }

  const storageBackend = cleanString(evidenceRow.storage_backend);
  if (storageBackend && storageBackend !== "vercel_blob") {
    const storageConfig = await resolveTenantStorageConfig(context.sql, tenantId, { preferBackend: storageBackend });
    const adapter = getStorageAdapter(storageConfig);
    const archiveResult = await adapter.archiveEvidence?.({
      config: storageConfig,
      tenantId,
      evidence: evidenceRow,
      metadata: {
        tenantName: evidenceRow.tenant_name || null,
        companyId: evidenceRow.company_id || null,
        companyName: evidenceRow.company_name || null,
        siteId: evidenceRow.site_id || null,
        siteName: evidenceRow.site_name || null,
        issueDate: evidenceRow.issue_date || null,
        docType: evidenceRow.doc_type || null,
        scopeCoverage: evidenceRow.scope_coverage || null,
        filename: evidenceRow.filename || null,
      },
    });

    if (!archiveResult?.archivedExternally) {
      return errorJson("External evidence archive is not supported for this storage backend.", 409, {
        code: archiveResult?.reason || "external_archive_not_supported",
        storageBackend,
      });
    }
  }

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
