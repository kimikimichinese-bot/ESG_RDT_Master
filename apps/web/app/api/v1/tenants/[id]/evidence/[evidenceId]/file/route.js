import { requireTenantContext } from "../../../../../_lib/enterprise-api.js";
import { errorJson } from "../../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const buildContentDisposition = (filename) => {
  const safe = String(filename || "evidence-file").replace(/[\r\n"]/g, "_");
  const encoded = encodeURIComponent(safe);
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`;
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
    SELECT id, filename, content_type, file_base64, blob_url
    FROM evidence
    WHERE tenant_id = ${tenantId} AND id = ${evidenceId}
    LIMIT 1
  `;

  const row = rows?.[0];
  if (!row) {
    return errorJson("Evidence not found", 404);
  }

  if (row.file_base64) {
    let buffer = null;
    try {
      buffer = Buffer.from(row.file_base64, "base64");
    } catch (_error) {
      return errorJson("Stored evidence payload is invalid", 500);
    }

    const headers = new Headers();
    headers.set("content-type", row.content_type || "application/octet-stream");
    headers.set("content-length", String(buffer.byteLength));
    headers.set("content-disposition", buildContentDisposition(row.filename));
    headers.set("cache-control", "private, no-store");
    return new Response(buffer, { status: 200, headers });
  }

  if (row.blob_url) {
    return Response.redirect(row.blob_url, 302);
  }

  return errorJson("No file payload available for this evidence", 404);
}
