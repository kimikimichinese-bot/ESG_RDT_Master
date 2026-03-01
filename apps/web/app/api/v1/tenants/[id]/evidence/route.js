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
      created_at
    FROM evidence
    WHERE tenant_id = ${tenantId}
      AND (${siteId} = '' OR site_id = ${siteId})
      AND (
        ${companyId} = ''
        OR site_id IN (
          SELECT s.id
          FROM sites s
          WHERE s.tenant_id = ${tenantId}
            AND s.company_id = ${companyId}
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
    INSERT INTO evidence (id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url)
    VALUES (
      ${evidenceId},
      ${tenantId},
      ${siteId},
      ${filename},
      ${contentType},
      ${Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0},
      ${cleanString(payload.sha256) || null},
      ${cleanString(payload.blobUrl) || null}
    )
    RETURNING id, tenant_id, site_id, filename, content_type, size_bytes, sha256, blob_url, created_at
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
    },
  });

  return json({ evidence: normalizeEvidence(rows[0]) }, 201);
}
