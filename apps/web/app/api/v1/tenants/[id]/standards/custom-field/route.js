import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import {
  ensureGhgSchema,
  ensureMetricsSchema,
  ensureSocialSchema,
  ensureStandardsSchema,
} from "../../../../_lib/db.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
import { normalizeDefinitionType, toRequestId } from "../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const resolveCompany = async (sql, tenantId, companyId) => {
  const rows = await sql`
    SELECT id
    FROM companies
    WHERE tenant_id = ${tenantId}
      AND id = ${companyId}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

const sanitizeKey = (value) => cleanString(value).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

export async function POST(request, { params }) {
  const requestId = toRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant", "tenant id is required");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureStandardsSchema();
    await ensureMetricsSchema();
    await ensureGhgSchema();
    await ensureSocialSchema();

    const payload = await parseJsonBody(request);
    const companyId = cleanString(payload.companyId);
    const name = cleanString(payload.name);
    const rawDefType = cleanString(payload.defType || payload.def_type);
    const defType = normalizeDefinitionType(rawDefType);
    const unit = cleanString(payload.unit) || "unit";
    const category = cleanString(payload.category) || "Custom";
    const scope = cleanString(payload.scope).toLowerCase() || "scope3";
    const method = cleanString(payload.method).toLowerCase() || "activity";

    if (!companyId) {
      return badRequest(requestId, "missing_company_id", "companyId is required");
    }
    if (!defType) {
      return badRequest(
        requestId,
        "invalid_def_type",
        "defType must be environment_metric, ghg_activity, social_metric, or governance_field",
      );
    }
    if (!name) {
      return badRequest(requestId, "missing_name", "name is required");
    }

    const validCompanyId = await resolveCompany(context.sql, tenantId, companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const keyPrefix =
      defType === "environment_metric"
        ? "env_custom"
        : defType === "ghg_activity"
          ? "ghg_custom"
          : defType === "social_metric"
            ? "social_custom"
            : "gov_custom";
    const defKey = sanitizeKey(payload.defKey || payload.def_key || `${keyPrefix}_${name}`);
    if (!defKey) {
      return badRequest(requestId, "invalid_def_key", "defKey is invalid");
    }

    if (defType === "environment_metric") {
      await context.sql`
        INSERT INTO metric_definitions (
          key,
          tenant_id,
          category,
          label,
          unit,
          description,
          is_required,
          validation,
          is_system,
          is_active,
          deleted_at,
          updated_at
        )
        VALUES (
          ${defKey},
          ${tenantId},
          ${category},
          ${name},
          ${unit},
          ${cleanString(payload.description) || null},
          FALSE,
          '{}'::jsonb,
          FALSE,
          TRUE,
          NULL,
          NOW()
        )
        ON CONFLICT (key)
        DO UPDATE SET
          tenant_id = COALESCE(metric_definitions.tenant_id, EXCLUDED.tenant_id),
          category = EXCLUDED.category,
          label = EXCLUDED.label,
          unit = EXCLUDED.unit,
          description = EXCLUDED.description,
          validation = EXCLUDED.validation,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = NOW()
      `;
    } else if (defType === "ghg_activity") {
      const normalizedScope = ["scope1", "scope2", "scope3"].includes(scope) ? scope : "scope3";
      const normalizedMethod = ["activity", "spend", "supplier_specific", "direct_tco2e"].includes(method)
        ? method
        : "activity";
      const scope3Category = normalizedScope === "scope3" ? Number(payload.scope3Category || payload.scope3_category || 15) : null;

      await context.sql`
        INSERT INTO ghg_activity_definitions (
          id,
          tenant_id,
          scope,
          scope3_category,
          key,
          name,
          group_key,
          sub_group,
          method,
          unit,
          requires_factor,
          default_factor_key,
          input_schema,
          sdgs,
          evidence_required,
          is_system,
          is_active,
          deleted_at,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${normalizedScope},
          ${scope3Category},
          ${defKey},
          ${name},
          'GHG',
          ${category},
          ${normalizedMethod},
          ${unit},
          TRUE,
          ${cleanString(payload.defaultFactorKey || payload.default_factor_key) || null},
          '{}'::jsonb,
          '[]'::jsonb,
          TRUE,
          FALSE,
          TRUE,
          NULL,
          999,
          NOW(),
          NOW()
        )
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET
          scope = EXCLUDED.scope,
          scope3_category = EXCLUDED.scope3_category,
          name = EXCLUDED.name,
          sub_group = EXCLUDED.sub_group,
          method = EXCLUDED.method,
          unit = EXCLUDED.unit,
          default_factor_key = EXCLUDED.default_factor_key,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = NOW()
      `;
    } else if (defType === "social_metric") {
      await context.sql`
        INSERT INTO social_metric_definitions (
          id,
          tenant_id,
          key,
          name,
          group_key,
          unit,
          method,
          input_schema,
          formula,
          sdgs,
          evidence_required,
          is_system,
          is_active,
          deleted_at,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${defKey},
          ${name},
          'S',
          ${unit},
          'manual',
          '{}'::jsonb,
          'null'::jsonb,
          '[]'::jsonb,
          FALSE,
          FALSE,
          TRUE,
          NULL,
          999,
          NOW(),
          NOW()
        )
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET
          name = EXCLUDED.name,
          unit = EXCLUDED.unit,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = NOW()
      `;
    } else if (defType === "governance_field") {
      const fieldType = cleanString(payload.fieldType || payload.field_type || "text").toLowerCase();
      const normalizedFieldType = ["boolean", "number", "text", "select"].includes(fieldType) ? fieldType : "text";
      const options = Array.isArray(payload.options)
        ? payload.options.map((item) => cleanString(item)).filter(Boolean)
        : normalizedFieldType === "select"
          ? ["yes", "no", "in_progress"]
          : [];
      await context.sql`
        INSERT INTO governance_field_definitions (
          id,
          tenant_id,
          key,
          label,
          field_type,
          unit,
          options,
          sdgs,
          evidence_required,
          is_system,
          is_active,
          deleted_at,
          created_at,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${defKey},
          ${name},
          ${normalizedFieldType},
          ${unit || null},
          ${JSON.stringify(options)}::jsonb,
          '[]'::jsonb,
          FALSE,
          FALSE,
          TRUE,
          NULL,
          NOW(),
          NOW()
        )
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET
          label = EXCLUDED.label,
          field_type = EXCLUDED.field_type,
          unit = EXCLUDED.unit,
          options = EXCLUDED.options,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = NOW()
      `;
    }

    await context.sql`
      INSERT INTO company_enabled_definitions (
        tenant_id,
        company_id,
        def_type,
        def_key,
        enabled,
        required,
        updated_at
      )
      VALUES (${tenantId}, ${validCompanyId}, ${defType}, ${defKey}, TRUE, FALSE, NOW())
      ON CONFLICT (tenant_id, company_id, def_type, def_key)
      DO UPDATE SET
        enabled = TRUE,
        updated_at = NOW()
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "standards.custom_field.create",
      entityType: "company",
      entityId: validCompanyId,
      payload: { defType, defKey, name, unit },
    });

    return json({ ok: true, defType, defKey }, 201);
  } catch (error) {
    return serverError(
      requestId,
      "standards_custom_field_failed",
      error instanceof Error ? error.message : "Unable to create custom field",
    );
  }
}
