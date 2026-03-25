import { randomUUID } from "node:crypto";
import { toIso } from "./http.js";

export const APPROVAL_ENTITY_TYPES = {
  MATERIALITY_SET: "materiality_set",
  EMISSIONS_EXPORT: "emissions_export",
  AUDIT_PACK: "audit_pack",
};

export const APPROVAL_STATUSES = ["draft", "in_review", "approved"];

export const isValidApprovalStatus = (value) => APPROVAL_STATUSES.includes(String(value || "").trim());

export const buildApprovalEntityKey = ({ entityType, companyId = null, reportingYear = null }) => {
  const parts = [String(entityType || "").trim()];
  if (companyId) {
    parts.push(`company:${companyId}`);
  }
  if (reportingYear != null && String(reportingYear).trim()) {
    parts.push(`year:${Number(reportingYear)}`);
  }
  return parts.join("|");
};

export const normalizeApprovalRow = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  entityType: row.entity_type,
  entityKey: row.entity_key,
  companyId: row.company_id || null,
  reportingYear: row.reporting_year == null ? null : Number(row.reporting_year),
  status: row.status,
  notes: row.notes || "",
  approvedByUserId: row.approved_by_user_id || null,
  approvedByName: row.approved_by_name || null,
  approvedAt: toIso(row.approved_at),
  updatedByUserId: row.updated_by_user_id || null,
  updatedByName: row.updated_by_name || null,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const upsertApprovalState = async ({
  sql,
  tenantId,
  entityType,
  companyId = null,
  reportingYear = null,
  status,
  actorUserId,
  notes = "",
}) => {
  const entityKey = buildApprovalEntityKey({ entityType, companyId, reportingYear });
  const approvedAt = status === "approved" ? new Date().toISOString() : null;
  const approvedByUserId = status === "approved" ? actorUserId : null;
  const rows = await sql`
    INSERT INTO approval_states (
      id,
      tenant_id,
      entity_type,
      entity_key,
      company_id,
      reporting_year,
      status,
      notes,
      approved_by_user_id,
      approved_at,
      updated_by_user_id,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${tenantId},
      ${entityType},
      ${entityKey},
      ${companyId},
      ${reportingYear},
      ${status},
      ${notes || ""},
      ${approvedByUserId},
      ${approvedAt},
      ${actorUserId},
      NOW(),
      NOW()
    )
    ON CONFLICT (tenant_id, entity_type, entity_key) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      reporting_year = EXCLUDED.reporting_year,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      approved_by_user_id = EXCLUDED.approved_by_user_id,
      approved_at = EXCLUDED.approved_at,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = NOW()
    RETURNING id, tenant_id, entity_type, entity_key, company_id, reporting_year, status, notes, approved_by_user_id, approved_at, updated_by_user_id, created_at, updated_at
  `;
  return rows?.[0] || null;
};

export const loadApprovalStates = async ({ sql, tenantId, entityType = null, companyId = null, reportingYear = null }) => {
  const rows = await sql`
    SELECT
      a.id,
      a.tenant_id,
      a.entity_type,
      a.entity_key,
      a.company_id,
      a.reporting_year,
      a.status,
      a.notes,
      a.approved_by_user_id,
      approver.name AS approved_by_name,
      a.approved_at,
      a.updated_by_user_id,
      updater.name AS updated_by_name,
      a.created_at,
      a.updated_at
    FROM approval_states a
    LEFT JOIN users approver
      ON approver.id = a.approved_by_user_id
    LEFT JOIN users updater
      ON updater.id = a.updated_by_user_id
    WHERE a.tenant_id = ${tenantId}
      AND (${entityType || ""} = '' OR a.entity_type = ${entityType})
      AND (${companyId || ""} = '' OR a.company_id = ${companyId})
      AND (${reportingYear == null ? null : Number(reportingYear)} IS NULL OR a.reporting_year = ${reportingYear == null ? null : Number(reportingYear)})
    ORDER BY a.entity_type ASC, a.reporting_year DESC NULLS LAST, a.updated_at DESC
  `;
  return rows.map(normalizeApprovalRow);
};
