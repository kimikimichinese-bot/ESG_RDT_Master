import { readFile } from "node:fs/promises";
import { checkMonthlyQuota, incrementTenantUsage } from "../../../../_lib/db.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { exportAuditPack } from "../../../../../../../../../scripts/dev/export-audit-pack.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const payload = await parseJsonBody(request);
  if (!tenantId) {
    return errorJson("Tenant id is required", 400, { code: "missing_tenant" });
  }
  if (process.env.APP_ENV !== "local") {
    return errorJson("Audit pack export center wrapper is available only in local mode", 403, { code: "local_only" });
  }
  if (payload.confirm !== true) {
    return errorJson("Export confirmation is required", 400, { code: "confirmation_required" });
  }

  const scoped = await requireTenantContext(request, tenantId, "audit");
  if (scoped.response) {
    return scoped.response;
  }

  const quotaCheck = await checkMonthlyQuota(scoped.context.sql, tenantId, "exports", {
    increment: 1,
    isSuperadmin: scoped.context.isSuperadmin,
  });
  if (!quotaCheck.allowed) {
    return errorJson("Exports quota exceeded", 403, {
      code: quotaCheck.code || "quota_exceeded",
      usage: quotaCheck.usage,
      limit: quotaCheck.limit,
      projected: quotaCheck.projected,
    });
  }

  const url = new URL(request.url);
  const year = Number.parseInt(String(payload.year || url.searchParams.get("year") || new Date().getFullYear()), 10);
  const result = await exportAuditPack({
    sql: scoped.context.sql,
    baseUrl: url.origin,
    year,
    tenantId,
  });
  let snapshot = null;
  try {
    snapshot = JSON.parse(await readFile(`${result.exportDir}/snapshot.json`, "utf-8"));
  } catch (_error) {
    snapshot = null;
  }
  await incrementTenantUsage(scoped.context.sql, tenantId, {
    exportsCount: 1,
  });

  return json({
    ok: true,
    exportDir: result.exportDir,
    zipPath: result.zipPath,
    tenantId: result.tenantId,
    tenantName: result.tenantName,
    evidenceCoverage: snapshot?.evidenceCoverage || null,
    scope3Support: snapshot?.scope3Support || null,
  });
}
