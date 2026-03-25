import { requireTenantContext } from "../../../../../_lib/enterprise-api.js";
import { getStorageAdapter, inferEvidenceStorageBackend, resolveTenantStorageConfig } from "../../../../../_lib/storage-adapters.js";
import { cleanString, errorJson } from "../../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const loadEvidenceRow = async (sql, tenantId, evidenceId) => {
  const rows = await sql`
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
      AND id = ${evidenceId}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const evidenceId = params?.evidenceId;
  const scoped = await requireTenantContext(request, tenantId, "evidence");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const evidence = await loadEvidenceRow(context.sql, tenantId, evidenceId);
  if (!evidence) {
    return errorJson("Evidence not found", 404);
  }

  const mode = cleanString(new URL(request.url).searchParams.get("mode")) === "download" ? "download" : "preview";
  const backend = inferEvidenceStorageBackend(evidence);

  try {
    if (backend !== "vercel_blob") {
      const storageConfig = await resolveTenantStorageConfig(context.sql, tenantId, { preferBackend: backend });
      const adapter = getStorageAdapter(storageConfig);
      return adapter.streamEvidence({
        config: storageConfig,
        evidence,
        disposition: mode === "download" ? "attachment" : "inline",
      });
    }

    const blobUrl = cleanString(evidence.blob_url);
    if (!blobUrl) {
      return errorJson("Evidence file is not available for preview/download.", 404, {
        code: "evidence_file_unavailable",
      });
    }
    return Response.redirect(blobUrl, 302);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Unable to access evidence file.", 502, {
      code: typeof error?.code === "string" ? error.code : "storage_access_failed",
    });
  }
}
