import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { errorJson, getRequestId, json, parseJsonBody } from "../../../_lib/http.js";
import {
  getStorageAccessProfile,
  getTenantStorageConfigBundle,
  saveTenantStorageConfig,
} from "../../../_lib/storage-config.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "storage");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const access = getStorageAccessProfile(context);
  if (!access.canView) {
    return errorJson("Storage configuration is not available for this role.", 403, {
      code: "storage_access_denied",
      requestId,
    });
  }

  const bundle = await getTenantStorageConfigBundle(context.sql, tenantId);
  if (access.summaryOnly) {
    return json({
      ok: true,
      config: null,
      companyOverrides: [],
      summary: bundle.summary,
      access: {
        canView: true,
        canEdit: false,
        summaryOnly: true,
      },
    });
  }

  return json({
    ok: true,
    config: bundle.config,
    companyOverrides: bundle.companyOverrides,
    summary: bundle.summary,
    access: {
      canView: true,
      canEdit: access.canEdit,
      summaryOnly: false,
    },
  });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "storage");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const access = getStorageAccessProfile(context);
  if (!access.canEdit) {
    return errorJson("Storage configuration is read-only for the current session.", 403, {
      code: context.impersonationReadOnly ? "impersonation_read_only" : "storage_read_only",
      requestId,
    });
  }

  const payload = await parseJsonBody(request);
  const activationMode = typeof payload.activationMode === "string" ? payload.activationMode : "draft";
  const result = await saveTenantStorageConfig(context.sql, tenantId, payload, {
    activate: activationMode === "activate" ? true : activationMode === "draft" ? false : undefined,
  });

  if (!result.ok) {
    return errorJson(result.message, 400, {
      code: result.code || "validation_failed",
      validation: result.validation || null,
      requestId,
    });
  }

  return json({
    ok: true,
    config: result.config,
    summary: result.summary,
  });
}
