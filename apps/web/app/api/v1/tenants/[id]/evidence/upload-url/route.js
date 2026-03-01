import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const payload = await parseJsonBody(request);
  const filename = cleanString(payload.filename);
  if (!filename) {
    return errorJson("filename is required", 400);
  }

  const blobEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const uploadUrl = `/api/v1/tenants/${encodeURIComponent(tenantId)}/evidence/complete`;

  return json({
    blobEnabled,
    uploadUrl,
    method: "POST",
    expiresInSeconds: 300,
    note: blobEnabled
      ? "Upload complete endpoint will store file in Vercel Blob and persist metadata."
      : "Uploads disabled until BLOB_READ_WRITE_TOKEN is set. Metadata-only flow remains available.",
  });
}
