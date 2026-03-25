import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { resolveTenantStorageConfig } from "../../../../_lib/storage-adapters.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const normalizeBlobToken = (value) => {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const withoutQuotes = raw.replace(/^['"]+|['"]+$/g, "").trim();
  const withoutBearer = withoutQuotes.replace(/^bearer\s+/i, "").trim();
  const asciiOnly = withoutBearer.replace(/[^\x20-\x7E]/g, "");
  const compact = asciiOnly.replace(/\s+/g, "").trim();
  return compact || null;
};

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

  const blobEnabled = Boolean(normalizeBlobToken(process.env.BLOB_READ_WRITE_TOKEN));
  const storageConfig = await resolveTenantStorageConfig(scoped.context.sql, tenantId);
  const uploadUrl = `/api/v1/tenants/${encodeURIComponent(tenantId)}/evidence/complete`;

  return json({
    blobEnabled,
    storageBackend: storageConfig.primaryBackend || "vercel_blob",
    uploadUrl,
    method: "POST",
    expiresInSeconds: 300,
    note:
      storageConfig.primaryBackend === "onedrive"
        ? "Upload complete endpoint will resolve tenant storage config and write to OneDrive."
        : blobEnabled
          ? "Upload complete endpoint will store file in Vercel Blob and persist metadata."
          : "Uploads disabled until BLOB_READ_WRITE_TOKEN is set. Metadata-only flow remains available.",
  });
}
