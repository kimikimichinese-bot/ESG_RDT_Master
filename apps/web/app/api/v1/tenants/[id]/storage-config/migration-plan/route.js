import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { errorJson, getRequestId, json } from "../../../../_lib/http.js";
import {
  generateStorageMigrationPlan,
  getStorageAccessProfile,
  getTenantStorageConfigBundle,
} from "../../../../_lib/storage-config.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "storage");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const access = getStorageAccessProfile(context);
  if (!access.canEdit) {
    return errorJson("Only tenant admins and superadmins can generate migration plans.", 403, {
      code: context.impersonationReadOnly ? "impersonation_read_only" : "storage_read_only",
      requestId,
    });
  }

  const bundle = await getTenantStorageConfigBundle(context.sql, tenantId);
  const plan = await generateStorageMigrationPlan(context.sql, tenantId, bundle.config);
  return json({
    ok: true,
    plan,
  });
}
