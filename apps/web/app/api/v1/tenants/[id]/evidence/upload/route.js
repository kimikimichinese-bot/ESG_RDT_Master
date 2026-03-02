import { createHash, randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { normalizeEvidence, requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json } from "../../../../_lib/http.js";

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

const buildBlobKey = (tenantId, filename) => {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `evidence/${tenantId}/${safeFilename}`;
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
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const issueDate = normalizeIssueDate(formData.get("issueDate"));
    const docType = normalizeDocType(formData.get("docType"));
    const scopeCoverage = normalizeCoverage(formData.get("scopeCoverage"));
    const isEncrypted = cleanString(formData.get("isEncrypted")).toLowerCase() === "true";
    const language = cleanString(formData.get("language")) || null;

    const uploadOptions = {
      access: "public",
      addRandomSuffix: true,
      contentType,
    };
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      uploadOptions.token = process.env.BLOB_READ_WRITE_TOKEN;
    }

    const blob = await put(buildBlobKey(tenantId, filename), fileBuffer, uploadOptions);
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
        ${sizeBytes},
        ${sha256},
        ${blob?.url || null},
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
        issueDate,
        docType,
        scopeCoverage,
        isEncrypted,
        language,
      },
    });

    return json({ evidence: normalizeEvidence(rows[0]) }, 201);
  } catch (error) {
    return errorJson("Failed to upload evidence", 500, {
      message: error instanceof Error ? error.message : "Unexpected error",
    });
  }
}
