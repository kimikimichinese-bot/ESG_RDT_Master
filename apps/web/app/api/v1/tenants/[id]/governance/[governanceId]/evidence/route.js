import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../../_lib/audit.js";
import { ensureGovernanceSchema } from "../../../../../_lib/db.js";
import { fetchEntityEvidenceMap, replaceEntityEvidence } from "../../../../../_lib/esg-api.js";
import { json, parseJsonBody } from "../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) =>
  request.headers.get("x-vercel-id") || request.headers.get("x-request-id") || randomUUID();

const badRequest = (requestId, error, extra = {}) =>
  json(
    {
      ok: false,
      error,
      requestId,
      ...extra,
    },
    400,
  );

const serverError = (requestId) =>
  json(
    {
      ok: false,
      error: "governance_evidence_failed",
      requestId,
    },
    500,
  );

export async function PUT(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;
  const governanceId = params?.governanceId;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant");
  }
  if (!governanceId) {
    return badRequest(requestId, "missing_governance");
  }

  try {
    await ensureGovernanceSchema();

    const scoped = await requireTenantContext(request, tenantId, "governance");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    const payload = await parseJsonBody(request);
    const evidenceIds = Array.isArray(payload.evidenceIds) ? payload.evidenceIds : [];

    const rows = await context.sql`
      SELECT id
      FROM governance_yearly
      WHERE tenant_id = ${tenantId}
        AND id = ${governanceId}
      LIMIT 1
    `;

    if (!rows?.[0]) {
      return badRequest(requestId, "invalid_governance");
    }

    await replaceEntityEvidence({
      sql: context.sql,
      tenantId,
      entityType: "governance_yearly",
      entityId: governanceId,
      evidenceIds,
    });

    const evidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "governance_yearly",
      entityIds: [governanceId],
    });

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "governance.evidence.update",
      entityType: "governance_yearly",
      entityId: governanceId,
      payload: {
        evidenceIds: evidenceMap.get(governanceId) || [],
      },
    });

    return json({
      ok: true,
      governanceId,
      evidenceIds: evidenceMap.get(governanceId) || [],
      requestId,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "governance.evidence",
        requestId,
        tenantId,
        method: "PUT",
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : null,
      }),
    );
    return serverError(requestId);
  }
}
