import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureStandardsSchema } from "../../../../_lib/db.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { json, parseJsonBody } from "../../../../_lib/http.js";
import { logRequest } from "../../../../_lib/observability.js";
import { buildRateLimitKey, consumeRateLimit } from "../../../../_lib/rate-limit.js";
import {
  ensureStandardsFrameworks,
  importStandardsCsv,
  parseStandardsImportCsv,
  toRequestId,
} from "../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

export async function POST(request, { params }) {
  const requestId = toRequestId(request);
  const startedAt = Date.now();
  let response = null;
  const tenantId = params?.id;

  if (!tenantId) {
    response = badRequest(requestId, "missing_tenant", "Tenant id is required");
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/standards/import-csv", requestId });
    return response;
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    response = scoped.response;
    logRequest({ request, response, startedAt, route: "/api/v1/tenants/[id]/standards/import-csv", requestId, extra: { tenantId } });
    return response;
  }

  const { context } = scoped;
  const importLimit = consumeRateLimit({
    key: buildRateLimitKey({ tenantId, routeKey: "standards_import_csv" }),
    limit: 5,
    windowMs: 60_000,
  });
  if (!importLimit.allowed) {
    response = json(
      {
        ok: false,
        code: "rate_limited",
        message: "Too many standards CSV imports. Please retry later.",
        requestId,
        retryAfterSec: importLimit.retryAfterSec,
      },
      429,
    );
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/standards/import-csv",
      requestId,
      extra: { retryAfterSec: importLimit.retryAfterSec },
    });
    return response;
  }

  try {
    await ensureStandardsSchema();
    await ensureStandardsFrameworks(context.sql);

    const payload = await parseJsonBody(request);
    const csvText = typeof payload.csv === "string" ? payload.csv : typeof payload.text === "string" ? payload.text : "";

    const parsed = parseStandardsImportCsv(csvText);
    if (parsed.error) {
      response = badRequest(requestId, "invalid_csv", parsed.error);
      logRequest({
        request,
        response,
        startedAt,
        context: { ...context, tenantId },
        route: "/api/v1/tenants/[id]/standards/import-csv",
        requestId,
      });
      return response;
    }

    const summary = await importStandardsCsv({
      sql: context.sql,
      tenantId,
      rows: parsed.rows,
    });

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "standards.import_csv",
      entityType: "standards_metric",
      entityId: "bulk",
      payload: {
        rows: parsed.rows.length,
        ...summary,
      },
    });

    response = json({ ok: true, summary }, 201);
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/standards/import-csv",
      requestId,
    });
    return response;
  } catch (error) {
    response = serverError(
      requestId,
      "standards_import_failed",
      error instanceof Error ? error.message : "Unable to import standards CSV",
    );
    logRequest({
      request,
      response,
      startedAt,
      context: { ...context, tenantId },
      route: "/api/v1/tenants/[id]/standards/import-csv",
      requestId,
    });
    return response;
  }
}
