import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../../../_lib/audit.js";
import { ensureGovernanceSchema } from "../../../../../../_lib/db.js";
import { fetchEntityEvidenceMap, replaceEntityEvidence } from "../../../../../../_lib/esg-api.js";
import { json, parseJsonBody } from "../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";

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
      error: "governance_policy_evidence_failed",
      requestId,
    },
    500,
  );

export async function PUT(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;
  const policyId = params?.policyId;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant");
  }
  if (!policyId) {
    return badRequest(requestId, "missing_policy");
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
      FROM governance_policies
      WHERE tenant_id = ${tenantId}
        AND id = ${policyId}
      LIMIT 1
    `;

    if (!rows?.[0]) {
      return badRequest(requestId, "invalid_policy");
    }

    await replaceEntityEvidence({
      sql: context.sql,
      tenantId,
      entityType: "governance_policy",
      entityId: policyId,
      evidenceIds,
    });

    const evidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "governance_policy",
      entityIds: [policyId],
    });

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "governance.policy.evidence.update",
      entityType: "governance_policy",
      entityId: policyId,
      payload: {
        evidenceIds: evidenceMap.get(policyId) || [],
      },
    });

    return json({
      ok: true,
      policyId,
      evidenceIds: evidenceMap.get(policyId) || [],
      requestId,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "governance.policy.evidence",
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
