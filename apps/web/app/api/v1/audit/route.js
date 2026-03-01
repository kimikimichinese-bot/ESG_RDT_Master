import { normalizeAudit, parsePagination, requireAuthContext } from "../_lib/enterprise-api.js";
import { errorJson, json } from "../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return auth.response;
  }

  const { context } = auth;
  const url = new URL(request.url);
  const requestedTenantId = url.searchParams.get("tenantId") || context.activeTenantId;

  if (!context.memberships.some((item) => item.tenantId === requestedTenantId)) {
    return errorJson("Forbidden for tenant", 403);
  }

  const { limit } = parsePagination(request, { limit: 150, max: 500 });
  const rows = await context.sql`
    SELECT id, tenant_id, actor_user_id, action, entity_type, entity_id, payload, created_at
    FROM audit_log
    WHERE tenant_id = ${requestedTenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return json({
    tenantId: requestedTenantId,
    entries: rows.map((row) => normalizeAudit(row)),
  });
}
