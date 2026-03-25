import { ensureStandardsSchema } from "../../../_lib/db.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, json } from "../../../_lib/http.js";
import {
  STANDARDS_FRAMEWORKS,
  listStandardsMetrics,
  normalizeStandardsMetric,
  toRequestId,
} from "../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

export async function GET(request, { params }) {
  const requestId = toRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant", "Tenant id is required");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureStandardsSchema();

    const url = new URL(request.url);
    const framework = cleanString(url.searchParams.get("framework")).toUpperCase() || null;
    const industryCode = cleanString(url.searchParams.get("industryCode")) || null;
    const limit = Number.parseInt(url.searchParams.get("limit") || "200", 10);

    if (framework && !STANDARDS_FRAMEWORKS.includes(framework)) {
      return badRequest(requestId, "invalid_framework", "framework must be GRI or SASB");
    }

    const rows = await listStandardsMetrics({
      sql: context.sql,
      tenantId,
      framework,
      industryCode,
      limit,
    });

    return json({
      ok: true,
      frameworks: STANDARDS_FRAMEWORKS,
      metrics: (rows || []).map((row) => normalizeStandardsMetric(row)),
    });
  } catch (error) {
    return serverError(
      requestId,
      "standards_catalog_fetch_failed",
      error instanceof Error ? error.message : "Unable to load standards catalog",
    );
  }
}
