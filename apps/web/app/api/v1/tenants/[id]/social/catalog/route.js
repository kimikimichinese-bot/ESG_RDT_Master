import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureSocialSchema, ensureStandardsSchema, seedSocialMetricDefinitionsForTenant } from "../../../../_lib/db.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody, parseJsonColumn } from "../../../../_lib/http.js";
import { filterDefinitionsByCompanyEnabled, isUuid } from "../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (code, message) => json({ ok: false, code, message }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const normalizeDefinition = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  key: row.key,
  name: row.name,
  groupKey: row.group_key,
  unit: row.unit,
  method: row.method,
  inputSchema: parseJsonColumn(row.input_schema) || {},
  formula: parseJsonColumn(row.formula),
  sdgs: Array.isArray(parseJsonColumn(row.sdgs)) ? parseJsonColumn(row.sdgs) : [],
  evidenceRequired: Boolean(row.evidence_required),
  isSystem: row.is_system === true,
  isActive: Boolean(row.is_active),
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  sortOrder: Number(row.sort_order || 0),
  custom: row.is_system !== true,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

const normalizeInput = (payload) => {
  const key = cleanString(payload?.key).toLowerCase();
  const name = cleanString(payload?.name);
  const unit = cleanString(payload?.unit);
  const method = cleanString(payload?.method || "manual").toLowerCase();
  const groupKey = cleanString(payload?.groupKey || payload?.group_key || "S").toUpperCase();

  if (!key) {
    return { error: { code: "missing_key", message: "key is required" } };
  }
  if (!name) {
    return { error: { code: "missing_name", message: "name is required" } };
  }
  if (!unit) {
    return { error: { code: "missing_unit", message: "unit is required" } };
  }
  if (!["manual", "computed"].includes(method)) {
    return { error: { code: "invalid_method", message: "method must be manual or computed" } };
  }

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

  const inputSchema = payload?.inputSchema ?? payload?.input_schema ?? {};
  const formula = payload?.formula ?? null;

  return {
    item: {
      key,
      name,
      unit,
      method,
      groupKey: groupKey || "S",
      inputSchema: inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema) ? inputSchema : {},
      formula: formula && typeof formula === "object" && !Array.isArray(formula) ? formula : null,
      sdgs: normalizedSdgs,
      evidenceRequired: payload?.evidenceRequired === true,
      isActive: payload?.isActive !== false,
      sortOrder: Number.isFinite(Number(payload?.sortOrder)) ? Number(payload.sortOrder) : 0,
    },
  };
};

const readDefinitions = async (sql, tenantId) => {
  return sql`
    SELECT
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
    FROM social_metric_definitions
    WHERE tenant_id = ${tenantId}
      AND is_active = TRUE
      AND deleted_at IS NULL
    ORDER BY is_active DESC, sort_order ASC, key ASC
  `;
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "social");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureSocialSchema();
    await ensureStandardsSchema();
    const url = new URL(request.url);
    const companyId = cleanString(url.searchParams.get("companyId"));
    if (companyId && !isUuid(companyId)) {
      return badRequest("invalid_company_id", "companyId must be a valid UUID");
    }

    let rows = await readDefinitions(context.sql, tenantId);
    if (!rows || rows.length === 0) {
      await seedSocialMetricDefinitionsForTenant(context.sql, tenantId);
      rows = await readDefinitions(context.sql, tenantId);
    }

    let metrics = rows.map((row) => normalizeDefinition(row));
    if (companyId) {
      metrics = await filterDefinitionsByCompanyEnabled({
        sql: context.sql,
        tenantId,
        companyId,
        defType: "social_metric",
        definitions: metrics,
        keyField: "key",
      });
    }

    return json({
      ok: true,
      metrics,
    });
  } catch (error) {
    return serverError(
      requestId,
      "social_catalog_fetch_failed",
      error instanceof Error ? error.message : "Unable to load social catalog",
    );
  }
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "social");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureSocialSchema();

    const payload = await parseJsonBody(request);
    const normalized = normalizeInput(payload);
    if (normalized.error) {
      return badRequest(normalized.error.code, normalized.error.message);
    }

    const item = normalized.item;
    const rows = await context.sql`
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
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${item.key},
        ${item.name},
        ${item.groupKey},
        ${item.unit},
        ${item.method},
        ${JSON.stringify(item.inputSchema)}::jsonb,
        ${JSON.stringify(item.formula)}::jsonb,
        ${JSON.stringify(item.sdgs)}::jsonb,
        ${item.evidenceRequired},
        FALSE,
        ${item.isActive},
        NULL,
        ${item.sortOrder},
        NOW()
      )
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        name = EXCLUDED.name,
        group_key = EXCLUDED.group_key,
        unit = EXCLUDED.unit,
        method = EXCLUDED.method,
        input_schema = EXCLUDED.input_schema,
        formula = EXCLUDED.formula,
        sdgs = EXCLUDED.sdgs,
        evidence_required = EXCLUDED.evidence_required,
        is_system = social_metric_definitions.is_system,
        is_active = EXCLUDED.is_active,
        deleted_at = NULL,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
      RETURNING
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
    `;

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "social.catalog.upsert",
      entityType: "social_metric_definition",
      entityId: rows[0].id,
      payload: {
        key: item.key,
        method: item.method,
      },
    });

    return json({ ok: true, metric: normalizeDefinition(rows[0]) }, 201);
  } catch (error) {
    return serverError(
      requestId,
      "social_catalog_upsert_failed",
      error instanceof Error ? error.message : "Unable to upsert social catalog metric",
    );
  }
}
