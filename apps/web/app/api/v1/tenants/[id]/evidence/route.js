import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { normalizeEvidence, parsePagination, requireTenantContext } from "../../../_lib/enterprise-api.js";
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
  const scoped = await requireTenantContext(request, tenantId, "evidence");
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
      filename,
      content_type,
      size_bytes,
      sha256,
      blob_url,
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

  return json({
    blobEnabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    evidence: rows.map((row) => normalizeEvidence(row)),
  });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);

  const filename = cleanString(payload.filename);
  const contentType = cleanString(payload.contentType) || "application/octet-stream";
  const sizeBytes = Number(payload.sizeBytes);

  if (!filename) {
    return errorJson("filename is required", 400);
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
      ${Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0},
      ${cleanString(payload.sha256) || null},
      ${cleanString(payload.blobUrl) || null},
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
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      issueDate: normalizeIssueDate(payload.issueDate),
      docType: normalizeDocType(payload.docType),
      scopeCoverage: normalizeCoverage(payload.scopeCoverage),
      isEncrypted: payload.isEncrypted === true,
      language: cleanString(payload.language) || null,
    },
  });

  return json({ evidence: normalizeEvidence(rows[0]) }, 201);
}
