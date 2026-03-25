import { ensureEnterpriseSchema } from "../../../_lib/db.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { errorJson, json, parseJsonBody } from "../../../_lib/http.js";
import {
  APPROVAL_ENTITY_TYPES,
  buildApprovalEntityKey,
  isValidApprovalStatus,
  loadApprovalStates,
  normalizeApprovalRow,
  upsertApprovalState,
} from "../../../_lib/approval-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const resolveResource = (entityType) => {
  if (entityType === APPROVAL_ENTITY_TYPES.MATERIALITY_SET) {
    return "materiality";
  }
  return "audit";
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  await ensureEnterpriseSchema();
  const scoped = await requireTenantContext(request, tenantId, "audit");
  if (scoped.response) {
    return scoped.response;
  }

  const url = new URL(request.url);
  const entityType = String(url.searchParams.get("entityType") || "").trim() || null;
  const companyId = String(url.searchParams.get("companyId") || "").trim() || null;
  const reportingYearRaw = url.searchParams.get("reportingYear");
  const reportingYear = reportingYearRaw ? Number.parseInt(reportingYearRaw, 10) : null;

  const approvals = await loadApprovalStates({
    sql: scoped.context.sql,
    tenantId,
    entityType,
    companyId,
    reportingYear: Number.isInteger(reportingYear) ? reportingYear : null,
  });

  return json({
    ok: true,
    approvals,
  });
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const payload = await parseJsonBody(request);
  const entityType = String(payload.entityType || "").trim();
  const resource = resolveResource(entityType);

  if (!tenantId) {
    return errorJson("Tenant id is required", 400, { code: "missing_tenant" });
  }
  if (!Object.values(APPROVAL_ENTITY_TYPES).includes(entityType)) {
    return errorJson("Unsupported approval entity type", 400, { code: "invalid_entity_type" });
  }
  if (!isValidApprovalStatus(payload.status)) {
    return errorJson("Approval status must be draft, in_review or approved", 400, { code: "invalid_status" });
  }

  await ensureEnterpriseSchema();
  const scoped = await requireTenantContext(request, tenantId, resource);
  if (scoped.response) {
    return scoped.response;
  }

  const reportingYear = payload.reportingYear == null ? null : Number.parseInt(String(payload.reportingYear), 10);
  const companyId = typeof payload.companyId === "string" && payload.companyId.trim() ? payload.companyId.trim() : null;
  const row = await upsertApprovalState({
    sql: scoped.context.sql,
    tenantId,
    entityType,
    companyId,
    reportingYear: Number.isInteger(reportingYear) ? reportingYear : null,
    status: payload.status,
    actorUserId: scoped.context.user?.id,
    notes: typeof payload.notes === "string" ? payload.notes.trim() : "",
  });

  if (!row) {
    return errorJson("Unable to update approval state", 500, { code: "approval_update_failed" });
  }

  const approvals = await loadApprovalStates({
    sql: scoped.context.sql,
    tenantId,
    entityType,
    companyId,
    reportingYear: Number.isInteger(reportingYear) ? reportingYear : null,
  });
  const entityKey = buildApprovalEntityKey({
    entityType,
    companyId,
    reportingYear: Number.isInteger(reportingYear) ? reportingYear : null,
  });

  return json({
    ok: true,
    approval: approvals.find((item) => item.entityKey === entityKey) || normalizeApprovalRow(row),
  });
}
