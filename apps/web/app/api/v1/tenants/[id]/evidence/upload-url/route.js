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

  const blobEnabled = false;
  const uploadUrl = `/api/v1/tenants/${encodeURIComponent(tenantId)}/evidence/complete`;

  return json({
    blobEnabled,
    uploadUrl,
    method: "POST",
    expiresInSeconds: 300,
    note: "Upload complete endpoint stores file content in DB and persists metadata.",
  });
}
