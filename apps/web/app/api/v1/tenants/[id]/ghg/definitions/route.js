import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureGhgSchema, ensureStandardsSchema, seedGhgActivityDefinitionsForTenant } from "../../../../_lib/db.js";
import { normalizeGhgDefinitionRow, parseMethod, parseScope, parseScope3Category } from "../../../../_lib/ghg-api.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
import { filterDefinitionsByCompanyEnabled, isUuid } from "../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (code, message) => json({ ok: false, code, message }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const normalizeDefinitionInput = (payload) => {
  const key = cleanString(payload?.key).toLowerCase();
  const name = cleanString(payload?.name);
  const scope = parseScope(payload?.scope);
  const method = parseMethod(payload?.method);
  const unit = cleanString(payload?.unit);
  const groupKey = cleanString(payload?.groupKey || payload?.group_key || "GHG").toUpperCase();
  const subGroup = cleanString(payload?.subGroup || payload?.sub_group) || null;
  const scope3Category = parseScope3Category(payload?.scope3Category ?? payload?.scope3_category);
  const defaultFactorKey = cleanString(payload?.defaultFactorKey || payload?.default_factor_key) || null;

  if (!key) {
    return { error: { code: "missing_key", message: "key is required" } };
  }
  if (!name) {
    return { error: { code: "missing_name", message: "name is required" } };
  }
  if (!scope) {
    return { error: { code: "invalid_scope", message: "scope must be one of scope1/scope2/scope3" } };
  }
  if (!method) {
    return {
      error: {
        code: "invalid_method",
        message: "method must be one of activity/spend/supplier_specific/direct_tco2e",
      },
    };
  }
  if (!unit) {
    return { error: { code: "missing_unit", message: "unit is required" } };
  }

  if (scope === "scope3" && scope3Category == null) {
    return { error: { code: "missing_scope3_category", message: "scope3Category is required for scope3" } };
  }
  if (scope !== "scope3" && scope3Category != null) {
    return {
      error: {
        code: "invalid_scope3_category",
        message: "scope3Category is only allowed when scope=scope3",
      },
    };
  }

  const inputSchema = payload?.inputSchema ?? payload?.input_schema ?? {};
  const sdgs = Array.isArray(payload?.sdgs) ? payload.sdgs : [];
  const normalizedSdgs = [];
  for (const item of sdgs) {
    const parsed = Number.parseInt(String(item), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 17) {
      return { error: { code: "invalid_sdgs", message: "sdgs values must be integers 1..17" } };
    }
    if (!normalizedSdgs.includes(parsed)) {
      normalizedSdgs.push(parsed);
    }
  }

  return {
    definition: {
      key,
      name,
      scope,
      scope3Category: scope3Category ?? null,
      method,
      unit,
      groupKey: groupKey || "GHG",
      subGroup,
      requiresFactor: payload?.requiresFactor !== false,
      defaultFactorKey,
      inputSchema: inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema) ? inputSchema : {},
      sdgs: normalizedSdgs,
      evidenceRequired: payload?.evidenceRequired !== false,
      isActive: payload?.isActive !== false,
      sortOrder: Number.isFinite(Number(payload?.sortOrder)) ? Number(payload.sortOrder) : 0,
    },
  };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureGhgSchema();
    await ensureStandardsSchema();

    const url = new URL(request.url);
    const scopeFilter = parseScope(url.searchParams.get("scope"));
    const companyId = cleanString(url.searchParams.get("companyId"));
    const includeInactive = cleanString(url.searchParams.get("includeInactive")).toLowerCase() === "true";
    if (companyId && !isUuid(companyId)) {
      return badRequest("invalid_company_id", "companyId must be a valid UUID");
    }

    let rows = await context.sql`
      SELECT
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
      FROM ghg_activity_definitions
      WHERE tenant_id = ${tenantId}
      ORDER BY scope ASC, scope3_category ASC NULLS FIRST, sort_order ASC, key ASC
    `;

    if (!rows || rows.length === 0) {
      await seedGhgActivityDefinitionsForTenant(context.sql, tenantId);
      rows = await context.sql`
        SELECT
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
        FROM ghg_activity_definitions
        WHERE tenant_id = ${tenantId}
        ORDER BY scope ASC, scope3_category ASC NULLS FIRST, sort_order ASC, key ASC
      `;
    }

    let definitions = rows.map((row) => normalizeGhgDefinitionRow(row));
    if (!includeInactive) {
      definitions = definitions.filter((item) => item.isActive && !item.deletedAt);
    }
    if (scopeFilter) {
      definitions = definitions.filter((item) => item.scope === scopeFilter);
    }
    if (companyId) {
      definitions = await filterDefinitionsByCompanyEnabled({
        sql: context.sql,
        tenantId,
        companyId,
        defType: "ghg_activity",
        definitions,
        keyField: "key",
      });
    }

    return json({
      ok: true,
      definitions,
    });
  } catch (error) {
    return serverError(
      requestId,
      "ghg_definitions_fetch_failed",
      error instanceof Error ? error.message : "Unable to load GHG definitions",
    );
  }
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureGhgSchema();

    const payload = await parseJsonBody(request);
    const parsed = normalizeDefinitionInput(payload);
    if (parsed.error) {
      return badRequest(parsed.error.code, parsed.error.message);
    }

    const definitionId = cleanString(payload?.id);
    if (definitionId && !UUID_PATTERN.test(definitionId)) {
      return badRequest("invalid_id", "id must be a valid UUID when provided");
    }

    const id = definitionId || randomUUID();
    const item = parsed.definition;

    const rows = await context.sql`
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
        is_active,
        sort_order,
        updated_at
      )
      VALUES (
        ${id},
        ${tenantId},
        ${item.scope},
        ${item.scope3Category},
        ${item.key},
        ${item.name},
        ${item.groupKey},
        ${item.subGroup},
        ${item.method},
        ${item.unit},
        ${item.requiresFactor},
        ${item.defaultFactorKey},
        ${JSON.stringify(item.inputSchema)}::jsonb,
        ${JSON.stringify(item.sdgs)}::jsonb,
        ${item.evidenceRequired},
        ${item.isActive},
        ${item.sortOrder},
        NOW()
      )
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        scope = EXCLUDED.scope,
        scope3_category = EXCLUDED.scope3_category,
        name = EXCLUDED.name,
        group_key = EXCLUDED.group_key,
        sub_group = EXCLUDED.sub_group,
        method = EXCLUDED.method,
        unit = EXCLUDED.unit,
        requires_factor = EXCLUDED.requires_factor,
        default_factor_key = EXCLUDED.default_factor_key,
        input_schema = EXCLUDED.input_schema,
        sdgs = EXCLUDED.sdgs,
        evidence_required = EXCLUDED.evidence_required,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
      RETURNING
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
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "ghg.definition.upsert",
      entityType: "ghg_definition",
      entityId: rows[0].id,
      payload: {
        key: item.key,
        scope: item.scope,
        scope3Category: item.scope3Category,
      },
    });

    return json({ ok: true, definition: normalizeGhgDefinitionRow(rows[0]) }, 201);
  } catch (error) {
    return serverError(
      requestId,
      "ghg_definition_upsert_failed",
      error instanceof Error ? error.message : "Unable to save GHG definition",
    );
  }
}
