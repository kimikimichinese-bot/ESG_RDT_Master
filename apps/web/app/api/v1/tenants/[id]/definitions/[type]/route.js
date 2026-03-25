import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import {
  ensureGhgSchema,
  ensureGovernanceSchema,
  ensureMetricsSchema,
  ensureSocialSchema,
  ensureStandardsSchema,
} from "../../../../_lib/db.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, errorJson, getRequestId, json, parseJsonBody, parseJsonColumn } from "../../../../_lib/http.js";
import {
  filterDefinitionsByCompanyEnabled,
  isUuid,
  loadInternalDefinitionCatalog,
  normalizeDefinitionType,
} from "../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TYPE_CONFIG = {
  environment: { defType: "environment_metric", label: "environment definition" },
  ghg: { defType: "ghg_activity", label: "GHG definition" },
  social: { defType: "social_metric", label: "social definition" },
  governance: { defType: "governance_field", label: "governance definition" },
};

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const GHG_METHODS = new Set(["activity", "spend", "supplier_specific", "direct_tco2e"]);
const GHG_SCOPES = new Set(["scope1", "scope2", "scope3"]);
const GOVERNANCE_FIELD_TYPES = new Set(["boolean", "number", "text", "select"]);

const badRequest = (requestId, code, message, status = 400) => errorJson(message, status, { code, requestId });
const conflict = (requestId, code, message) => badRequest(requestId, code, message, 409);
const forbidden = (requestId, code, message) => badRequest(requestId, code, message, 403);

const normalizeType = (value) => TYPE_CONFIG[cleanString(value).toLowerCase()] || null;

const parseBoolean = (value, fallback = false) => {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return fallback;
};

const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseSdgs = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = [];
  for (const item of value) {
    const parsed = Number.parseInt(String(item), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 17) {
      return null;
    }
    if (!normalized.includes(parsed)) {
      normalized.push(parsed);
    }
  }
  return normalized.sort((a, b) => a - b);
};

const sanitizeKey = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const assertKey = (requestId, rawKey) => {
  const key = sanitizeKey(rawKey);
  if (!key || !KEY_PATTERN.test(key)) {
    return { error: badRequest(requestId, "invalid_key", "key must be snake_case and start with a letter") };
  }
  return { key };
};

const parseScope3Category = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15) {
    return null;
  }
  return parsed;
};

const normalizeEnvironmentRow = (row) => {
  const validation = parseJsonColumn(row.validation) || {};
  return {
    id: row.key,
    key: row.key,
    name: row.label,
    label: row.label,
    category: row.category,
    unit: row.unit,
    description: row.description || "",
    validation,
    sdgs: Array.isArray(validation.sdgs) ? validation.sdgs : [],
    evidenceRequired: validation.evidenceRequired === true,
    isRequired: row.is_required === true,
    isSystem: row.is_system === true,
    isActive: row.is_active !== false,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    custom: row.is_system !== true,
  };
};

const normalizeGhgRow = (row) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  scope: row.scope,
  scope3Category: row.scope3_category == null ? null : Number(row.scope3_category),
  groupKey: row.group_key || "GHG",
  subGroup: row.sub_group || null,
  method: row.method,
  unit: row.unit,
  requiresFactor: row.requires_factor !== false,
  defaultFactorKey: row.default_factor_key || null,
  inputSchema: parseJsonColumn(row.input_schema) || {},
  sdgs: Array.isArray(parseJsonColumn(row.sdgs)) ? parseJsonColumn(row.sdgs) : [],
  evidenceRequired: row.evidence_required === true,
  isSystem: row.is_system === true,
  isActive: row.is_active !== false,
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  sortOrder: Number(row.sort_order || 0),
  custom: row.is_system !== true,
});

const normalizeSocialRow = (row) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  groupKey: row.group_key || "S",
  unit: row.unit,
  method: row.method,
  inputSchema: parseJsonColumn(row.input_schema) || {},
  formula: parseJsonColumn(row.formula),
  sdgs: Array.isArray(parseJsonColumn(row.sdgs)) ? parseJsonColumn(row.sdgs) : [],
  evidenceRequired: row.evidence_required === true,
  isSystem: row.is_system === true,
  isActive: row.is_active !== false,
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  sortOrder: Number(row.sort_order || 0),
  custom: row.is_system !== true,
});

const normalizeGovernanceRow = (row) => ({
  id: row.id,
  key: row.key,
  name: row.label,
  label: row.label,
  fieldType: row.field_type,
  unit: row.unit || null,
  options: Array.isArray(parseJsonColumn(row.options)) ? parseJsonColumn(row.options) : [],
  sdgs: Array.isArray(parseJsonColumn(row.sdgs)) ? parseJsonColumn(row.sdgs) : [],
  evidenceRequired: row.evidence_required === true,
  isSystem: row.is_system === true,
  isActive: row.is_active !== false,
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  custom: row.is_system !== true,
});

const ensureSchemasForType = async (type) => {
  await ensureStandardsSchema();
  if (type.defType === "environment_metric") {
    await ensureMetricsSchema();
  } else if (type.defType === "ghg_activity") {
    await ensureGhgSchema();
  } else if (type.defType === "social_metric") {
    await ensureSocialSchema();
  } else if (type.defType === "governance_field") {
    await ensureGovernanceSchema();
  }
};

const readDefinitionByKey = async ({ sql, tenantId, type, key }) => {
  if (type.defType === "environment_metric") {
    const rows = await sql`
      SELECT key, tenant_id, category, label, unit, description, is_required, validation, is_system, is_active, deleted_at
      FROM metric_definitions
      WHERE key = ${key}
        AND (tenant_id IS NULL OR tenant_id = ${tenantId})
      ORDER BY CASE WHEN tenant_id = ${tenantId} THEN 0 ELSE 1 END ASC
      LIMIT 1
    `;
    return rows?.[0] ? normalizeEnvironmentRow(rows[0]) : null;
  }

  if (type.defType === "ghg_activity") {
    const rows = await sql`
      SELECT
        id, key, name, scope, scope3_category, group_key, sub_group, method, unit,
        requires_factor, default_factor_key, input_schema, sdgs, evidence_required,
        is_system, is_active, deleted_at, sort_order
      FROM ghg_activity_definitions
      WHERE tenant_id = ${tenantId}
        AND key = ${key}
      LIMIT 1
    `;
    return rows?.[0] ? normalizeGhgRow(rows[0]) : null;
  }

  if (type.defType === "social_metric") {
    const rows = await sql`
      SELECT
        id, key, name, group_key, unit, method, input_schema, formula, sdgs,
        evidence_required, is_system, is_active, deleted_at, sort_order
      FROM social_metric_definitions
      WHERE tenant_id = ${tenantId}
        AND key = ${key}
      LIMIT 1
    `;
    return rows?.[0] ? normalizeSocialRow(rows[0]) : null;
  }

  const rows = await sql`
    SELECT
      id, key, label, field_type, unit, options, sdgs, evidence_required, is_system, is_active, deleted_at
    FROM governance_field_definitions
    WHERE tenant_id = ${tenantId}
      AND key = ${key}
    LIMIT 1
  `;
  return rows?.[0] ? normalizeGovernanceRow(rows[0]) : null;
};

const assertSystemEditable = (requestId, definition, payload, disallowedFields) => {
  if (!definition?.isSystem) {
    return null;
  }
  for (const field of disallowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && payload[field] != null && String(payload[field]).trim() !== "") {
      return forbidden(requestId, "system_definition_locked", `${field} cannot be changed for system definitions`);
    }
  }
  return null;
};

const cleanupMappings = async ({ sql, tenantId, defType, key }) => {
  await sql`
    DELETE FROM company_enabled_definitions
    WHERE tenant_id = ${tenantId}
      AND def_type = ${defType}
      AND def_key = ${key}
  `;
  await sql`
    DELETE FROM standards_mappings
    WHERE tenant_id = ${tenantId}
      AND internal_type = ${defType}
      AND internal_key = ${key}
  `;
  await sql`
    DELETE FROM topic_to_metric
    WHERE tenant_id = ${tenantId}
      AND metric_key = ${key}
  `;
};

const hasReferences = async ({ sql, tenantId, type, definition }) => {
  if (type.defType === "environment_metric") {
    const rows = await sql`
      SELECT 1
      FROM site_metrics
      WHERE tenant_id = ${tenantId}
        AND metric_key = ${definition.key}
      LIMIT 1
    `;
    return rows.length > 0;
  }
  if (type.defType === "ghg_activity") {
    const rows = await sql`
      SELECT 1
      FROM ghg_activity_records
      WHERE tenant_id = ${tenantId}
        AND activity_def_id = ${definition.id}
      LIMIT 1
    `;
    return rows.length > 0;
  }
  if (type.defType === "social_metric") {
    const rows = await sql`
      SELECT 1
      FROM social_records
      WHERE tenant_id = ${tenantId}
        AND metric_def_id = ${definition.id}
      LIMIT 1
    `;
    return rows.length > 0;
  }
  const rows = await sql`
    SELECT 1
    FROM governance_yearly
    WHERE tenant_id = ${tenantId}
      AND custom_values ? ${definition.key}
    LIMIT 1
  `;
  return rows.length > 0;
};

const summarizeDefinitionImpact = async ({ sql, tenantId, type, definition }) => {
  const companyEnablements = await sql`
    SELECT c.id, c.name, e.enabled, e.required
    FROM company_enabled_definitions e
    INNER JOIN companies c
      ON c.id = e.company_id
     AND c.tenant_id = e.tenant_id
    WHERE e.tenant_id = ${tenantId}
      AND e.def_type = ${type.defType}
      AND e.def_key = ${definition.key}
    ORDER BY c.name ASC
  `;

  const standardsMappings = await sql`
    SELECT framework, standards_metric_id
    FROM standards_mappings
    WHERE tenant_id = ${tenantId}
      AND internal_type = ${type.defType}
      AND internal_key = ${definition.key}
  `;

  const topicMappings = await sql`
    SELECT topic_id
    FROM topic_to_metric
    WHERE tenant_id = ${tenantId}
      AND metric_key = ${definition.key}
  `;

  let recordCount = 0;
  if (type.defType === "environment_metric") {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM site_metrics
      WHERE tenant_id = ${tenantId}
        AND metric_key = ${definition.key}
    `;
    recordCount = Number(rows?.[0]?.count || 0);
  } else if (type.defType === "ghg_activity") {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM ghg_activity_records
      WHERE tenant_id = ${tenantId}
        AND activity_def_id = ${definition.id}
    `;
    recordCount = Number(rows?.[0]?.count || 0);
  } else if (type.defType === "social_metric") {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM social_records
      WHERE tenant_id = ${tenantId}
        AND metric_def_id = ${definition.id}
    `;
    recordCount = Number(rows?.[0]?.count || 0);
  } else {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM governance_yearly
      WHERE tenant_id = ${tenantId}
        AND custom_values ? ${definition.key}
    `;
    recordCount = Number(rows?.[0]?.count || 0);
  }

  return {
    companyEnablementCount: companyEnablements.length,
    companyEnablements: companyEnablements.map((row) => ({
      companyId: row.id,
      companyName: row.name,
      enabled: row.enabled !== false,
      required: row.required === true,
    })),
    standardsMappingCount: standardsMappings.length,
    standardsFrameworks: [...new Set(standardsMappings.map((row) => cleanString(row.framework)).filter(Boolean))],
    topicMappingCount: topicMappings.length,
    recordCount,
    usedInRecords: recordCount > 0,
    mapped: standardsMappings.length > 0 || topicMappings.length > 0,
  };
};

export async function GET(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;
  const type = normalizeType(params?.type);
  if (!tenantId || !type) {
    return badRequest(requestId, "invalid_type", "type must be environment, ghg, social, or governance");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureSchemasForType(type);
    const url = new URL(request.url);
    const includeInactive = cleanString(url.searchParams.get("includeInactive")).toLowerCase() === "true";
    const companyId = cleanString(url.searchParams.get("companyId"));

    if (companyId && !isUuid(companyId)) {
      return badRequest(requestId, "invalid_company_id", "companyId must be a UUID");
    }

    const catalog = await loadInternalDefinitionCatalog({
      sql: context.sql,
      tenantId,
      includeInactive: includeInactive && context.isSuperadmin,
    });

    const defType = normalizeDefinitionType(type.defType);
    let definitions = Array.isArray(catalog[defType]) ? catalog[defType] : [];
    if (companyId) {
      definitions = await filterDefinitionsByCompanyEnabled({
        sql: context.sql,
        tenantId,
        companyId,
        defType,
        definitions,
        keyField: "key",
      });
    }

    const enrichedDefinitions = await Promise.all(
      definitions.map(async (definition) => ({
        ...definition,
        impact: await summarizeDefinitionImpact({ sql: context.sql, tenantId, type, definition }),
      })),
    );

    return json({ ok: true, type: params.type, definitions: enrichedDefinitions });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Unable to list definitions", 500, {
      code: "definitions_fetch_failed",
      requestId,
    });
  }
}

export async function POST(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;
  const type = normalizeType(params?.type);
  if (!tenantId || !type) {
    return badRequest(requestId, "invalid_type", "type must be environment, ghg, social, or governance");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }
  const { context } = scoped;

  try {
    await ensureSchemasForType(type);
    const payload = await parseJsonBody(request);
    const keyCheck = assertKey(requestId, payload.key);
    if (keyCheck.error) {
      return keyCheck.error;
    }
    const key = keyCheck.key;

    const existing = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    if (existing) {
      return conflict(requestId, "definition_key_conflict", "key already exists");
    }

    let definition = null;
    if (type.defType === "environment_metric") {
      const name = cleanString(payload.name || payload.label);
      const unit = cleanString(payload.unit);
      const category = cleanString(payload.category) || "Custom";
      if (!name || !unit) {
        return badRequest(requestId, "missing_fields", "name/label and unit are required");
      }
      const sdgs = payload.sdgs == null ? [] : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const validation = payload.validation && typeof payload.validation === "object" && !Array.isArray(payload.validation)
        ? payload.validation
        : {};

      await context.sql`
        INSERT INTO metric_definitions (
          key, tenant_id, category, label, unit, description, is_required, validation, is_system, is_active, deleted_at, updated_at
        )
        VALUES (
          ${key},
          ${tenantId},
          ${category},
          ${name},
          ${unit},
          ${cleanString(payload.description) || null},
          ${parseBoolean(payload.isRequired, false)},
          ${JSON.stringify({
            ...validation,
            sdgs,
            evidenceRequired: parseBoolean(payload.evidenceRequired, false),
          })}::jsonb,
          FALSE,
          TRUE,
          NULL,
          NOW()
        )
      `;
      definition = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    } else if (type.defType === "ghg_activity") {
      const name = cleanString(payload.name || payload.label);
      const scope = cleanString(payload.scope).toLowerCase();
      const method = cleanString(payload.method).toLowerCase();
      const unit = cleanString(payload.unit);
      if (!name || !GHG_SCOPES.has(scope) || !GHG_METHODS.has(method) || !unit) {
        return badRequest(requestId, "invalid_payload", "name, scope, method and unit are required");
      }
      const scope3Category = parseScope3Category(payload.scope3Category ?? payload.scope3_category);
      if (scope === "scope3" && scope3Category == null) {
        return badRequest(requestId, "missing_scope3_category", "scope3Category is required for scope3");
      }
      if (scope !== "scope3" && scope3Category != null) {
        return badRequest(requestId, "invalid_scope3_category", "scope3Category is only valid for scope3");
      }
      const sdgs = payload.sdgs == null ? [] : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const inputSchema = payload.inputSchema && typeof payload.inputSchema === "object" && !Array.isArray(payload.inputSchema)
        ? payload.inputSchema
        : {};
      await context.sql`
        INSERT INTO ghg_activity_definitions (
          id, tenant_id, scope, scope3_category, key, name, group_key, sub_group, method, unit,
          requires_factor, default_factor_key, input_schema, sdgs, evidence_required, is_system, is_active, deleted_at, sort_order, updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${scope},
          ${scope3Category},
          ${key},
          ${name},
          ${cleanString(payload.groupKey || payload.group_key || "GHG").toUpperCase() || "GHG"},
          ${cleanString(payload.subGroup || payload.sub_group) || null},
          ${method},
          ${unit},
          ${parseBoolean(payload.requiresFactor, true)},
          ${cleanString(payload.defaultFactorKey || payload.default_factor_key) || null},
          ${JSON.stringify(inputSchema)}::jsonb,
          ${JSON.stringify(sdgs)}::jsonb,
          ${parseBoolean(payload.evidenceRequired, true)},
          FALSE,
          TRUE,
          NULL,
          ${parseNumber(payload.sortOrder, 0)},
          NOW()
        )
      `;
      definition = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    } else if (type.defType === "social_metric") {
      const name = cleanString(payload.name || payload.label);
      const unit = cleanString(payload.unit);
      const method = cleanString(payload.method || "manual").toLowerCase();
      if (!name || !unit || !["manual", "computed"].includes(method)) {
        return badRequest(requestId, "invalid_payload", "name, unit, and method(manual|computed) are required");
      }
      const sdgs = payload.sdgs == null ? [] : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const inputSchema = payload.inputSchema && typeof payload.inputSchema === "object" && !Array.isArray(payload.inputSchema)
        ? payload.inputSchema
        : {};
      const formula = payload.formula && typeof payload.formula === "object" && !Array.isArray(payload.formula)
        ? payload.formula
        : null;

      await context.sql`
        INSERT INTO social_metric_definitions (
          id, tenant_id, key, name, group_key, unit, method, input_schema, formula, sdgs,
          evidence_required, is_system, is_active, deleted_at, sort_order, updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${key},
          ${name},
          ${cleanString(payload.groupKey || payload.group_key || "S").toUpperCase() || "S"},
          ${unit},
          ${method},
          ${JSON.stringify(inputSchema)}::jsonb,
          ${JSON.stringify(formula)}::jsonb,
          ${JSON.stringify(sdgs)}::jsonb,
          ${parseBoolean(payload.evidenceRequired, false)},
          FALSE,
          TRUE,
          NULL,
          ${parseNumber(payload.sortOrder, 0)},
          NOW()
        )
      `;
      definition = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    } else {
      const label = cleanString(payload.label || payload.name);
      const fieldType = cleanString(payload.fieldType || payload.field_type || "text").toLowerCase();
      if (!label || !GOVERNANCE_FIELD_TYPES.has(fieldType)) {
        return badRequest(requestId, "invalid_payload", "label/name and valid fieldType are required");
      }
      const sdgs = payload.sdgs == null ? [] : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const options = Array.isArray(payload.options) ? payload.options.map((item) => cleanString(item)).filter(Boolean) : [];
      await context.sql`
        INSERT INTO governance_field_definitions (
          id, tenant_id, key, label, field_type, unit, options, sdgs, evidence_required,
          is_system, is_active, deleted_at, created_at, updated_at
        )
        VALUES (
          ${randomUUID()},
          ${tenantId},
          ${key},
          ${label},
          ${fieldType},
          ${cleanString(payload.unit) || null},
          ${JSON.stringify(options)}::jsonb,
          ${JSON.stringify(sdgs)}::jsonb,
          ${parseBoolean(payload.evidenceRequired, false)},
          FALSE,
          TRUE,
          NULL,
          NOW(),
          NOW()
        )
      `;
      definition = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    }

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "definitions.create",
      entityType: type.defType,
      entityId: definition?.id || key,
      payload: { type: type.defType, key },
    });

    return json({ ok: true, definition }, 201);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Unable to create definition", 500, {
      code: "definition_create_failed",
      requestId,
    });
  }
}

export async function PUT(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;
  const type = normalizeType(params?.type);
  if (!tenantId || !type) {
    return badRequest(requestId, "invalid_type", "type must be environment, ghg, social, or governance");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }
  const { context } = scoped;

  try {
    await ensureSchemasForType(type);
    const payload = await parseJsonBody(request);
    const keyCheck = assertKey(requestId, payload.key);
    if (keyCheck.error) {
      return keyCheck.error;
    }
    const key = keyCheck.key;
    const existing = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    if (!existing) {
      return badRequest(requestId, "definition_not_found", "definition not found", 404);
    }

    if (type.defType === "environment_metric") {
      const lockError = assertSystemEditable(requestId, existing, payload, ["unit"]);
      if (lockError) {
        return lockError;
      }
      const nextLabel = cleanString(payload.name || payload.label) || existing.label;
      const nextCategory = cleanString(payload.category) || existing.category || "Custom";
      const nextUnit = cleanString(payload.unit) || existing.unit;
      const nextDescription = cleanString(payload.description) || existing.description || null;
      const sdgs = payload.sdgs == null ? existing.sdgs : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const currentValidation = existing.validation && typeof existing.validation === "object" ? existing.validation : {};
      const validation = payload.validation && typeof payload.validation === "object" && !Array.isArray(payload.validation)
        ? payload.validation
        : currentValidation;

      await context.sql`
        UPDATE metric_definitions
        SET
          category = ${nextCategory},
          label = ${nextLabel},
          unit = ${nextUnit},
          description = ${nextDescription},
          is_required = ${payload.isRequired == null ? existing.isRequired : parseBoolean(payload.isRequired, false)},
          validation = ${JSON.stringify({
            ...validation,
            sdgs,
            evidenceRequired:
              payload.evidenceRequired == null ? existing.evidenceRequired : parseBoolean(payload.evidenceRequired, false),
          })}::jsonb,
          is_active = ${payload.isActive == null ? existing.isActive : parseBoolean(payload.isActive, true)},
          deleted_at = CASE
            WHEN ${payload.isActive === false} THEN NOW()
            WHEN ${payload.isActive === true} THEN NULL
            ELSE deleted_at
          END,
          updated_at = NOW()
        WHERE key = ${key}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
      `;
    } else if (type.defType === "ghg_activity") {
      const lockError = assertSystemEditable(requestId, existing, payload, ["scope", "scope3Category", "scope3_category", "method", "unit"]);
      if (lockError) {
        return lockError;
      }
      const sdgs = payload.sdgs == null ? existing.sdgs : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const scope = cleanString(payload.scope).toLowerCase() || existing.scope;
      const method = cleanString(payload.method).toLowerCase() || existing.method;
      const scope3CategoryRaw = payload.scope3Category ?? payload.scope3_category;
      const scope3Category = scope3CategoryRaw == null ? existing.scope3Category : parseScope3Category(scope3CategoryRaw);
      if (!GHG_SCOPES.has(scope) || !GHG_METHODS.has(method)) {
        return badRequest(requestId, "invalid_payload", "scope/method are invalid");
      }
      if (scope === "scope3" && scope3Category == null) {
        return badRequest(requestId, "missing_scope3_category", "scope3Category is required for scope3");
      }
      if (scope !== "scope3" && scope3Category != null) {
        return badRequest(requestId, "invalid_scope3_category", "scope3Category is only valid for scope3");
      }

      await context.sql`
        UPDATE ghg_activity_definitions
        SET
          name = ${cleanString(payload.name || payload.label) || existing.name},
          scope = ${scope},
          scope3_category = ${scope3Category},
          group_key = ${cleanString(payload.groupKey || payload.group_key || existing.groupKey).toUpperCase() || "GHG"},
          sub_group = ${cleanString(payload.subGroup || payload.sub_group) || existing.subGroup},
          method = ${method},
          unit = ${cleanString(payload.unit) || existing.unit},
          requires_factor = ${payload.requiresFactor == null ? existing.requiresFactor : parseBoolean(payload.requiresFactor, true)},
          default_factor_key = ${cleanString(payload.defaultFactorKey || payload.default_factor_key) || existing.defaultFactorKey},
          input_schema = ${JSON.stringify(
            payload.inputSchema && typeof payload.inputSchema === "object" && !Array.isArray(payload.inputSchema)
              ? payload.inputSchema
              : existing.inputSchema || {},
          )}::jsonb,
          sdgs = ${JSON.stringify(sdgs)}::jsonb,
          evidence_required = ${payload.evidenceRequired == null ? existing.evidenceRequired : parseBoolean(payload.evidenceRequired, true)},
          is_active = ${payload.isActive == null ? existing.isActive : parseBoolean(payload.isActive, true)},
          deleted_at = CASE WHEN ${payload.isActive === false} THEN NOW() WHEN ${payload.isActive === true} THEN NULL ELSE deleted_at END,
          sort_order = ${payload.sortOrder == null ? existing.sortOrder : parseNumber(payload.sortOrder, 0)},
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND key = ${key}
      `;
    } else if (type.defType === "social_metric") {
      const lockError = assertSystemEditable(requestId, existing, payload, ["method", "unit"]);
      if (lockError) {
        return lockError;
      }
      const sdgs = payload.sdgs == null ? existing.sdgs : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const method = cleanString(payload.method || existing.method).toLowerCase();
      if (!["manual", "computed"].includes(method)) {
        return badRequest(requestId, "invalid_method", "method must be manual or computed");
      }

      await context.sql`
        UPDATE social_metric_definitions
        SET
          name = ${cleanString(payload.name || payload.label) || existing.name},
          group_key = ${cleanString(payload.groupKey || payload.group_key || existing.groupKey).toUpperCase() || "S"},
          unit = ${cleanString(payload.unit) || existing.unit},
          method = ${method},
          input_schema = ${JSON.stringify(
            payload.inputSchema && typeof payload.inputSchema === "object" && !Array.isArray(payload.inputSchema)
              ? payload.inputSchema
              : existing.inputSchema || {},
          )}::jsonb,
          formula = ${JSON.stringify(
            payload.formula && typeof payload.formula === "object" && !Array.isArray(payload.formula)
              ? payload.formula
              : existing.formula || null,
          )}::jsonb,
          sdgs = ${JSON.stringify(sdgs)}::jsonb,
          evidence_required = ${payload.evidenceRequired == null ? existing.evidenceRequired : parseBoolean(payload.evidenceRequired, false)},
          is_active = ${payload.isActive == null ? existing.isActive : parseBoolean(payload.isActive, true)},
          deleted_at = CASE WHEN ${payload.isActive === false} THEN NOW() WHEN ${payload.isActive === true} THEN NULL ELSE deleted_at END,
          sort_order = ${payload.sortOrder == null ? existing.sortOrder : parseNumber(payload.sortOrder, 0)},
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND key = ${key}
      `;
    } else {
      const sdgs = payload.sdgs == null ? existing.sdgs : parseSdgs(payload.sdgs);
      if (sdgs == null) {
        return badRequest(requestId, "invalid_sdgs", "sdgs must contain integers 1..17");
      }
      const fieldType = cleanString(payload.fieldType || payload.field_type || existing.fieldType).toLowerCase();
      if (!GOVERNANCE_FIELD_TYPES.has(fieldType)) {
        return badRequest(requestId, "invalid_field_type", "fieldType must be boolean|number|text|select");
      }
      const lockError = assertSystemEditable(requestId, existing, payload, ["fieldType", "field_type"]);
      if (lockError) {
        return lockError;
      }
      const options = Array.isArray(payload.options)
        ? payload.options.map((item) => cleanString(item)).filter(Boolean)
        : existing.options || [];
      await context.sql`
        UPDATE governance_field_definitions
        SET
          label = ${cleanString(payload.label || payload.name) || existing.label || existing.name},
          field_type = ${fieldType},
          unit = ${cleanString(payload.unit) || existing.unit},
          options = ${JSON.stringify(options)}::jsonb,
          sdgs = ${JSON.stringify(sdgs)}::jsonb,
          evidence_required = ${payload.evidenceRequired == null ? existing.evidenceRequired : parseBoolean(payload.evidenceRequired, false)},
          is_active = ${payload.isActive == null ? existing.isActive : parseBoolean(payload.isActive, true)},
          deleted_at = CASE WHEN ${payload.isActive === false} THEN NOW() WHEN ${payload.isActive === true} THEN NULL ELSE deleted_at END,
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND key = ${key}
      `;
    }

    const definition = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "definitions.update",
      entityType: type.defType,
      entityId: definition?.id || key,
      payload: { type: type.defType, key },
    });
    return json({ ok: true, definition });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Unable to update definition", 500, {
      code: "definition_update_failed",
      requestId,
    });
  }
}

export async function DELETE(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;
  const type = normalizeType(params?.type);
  if (!tenantId || !type) {
    return badRequest(requestId, "invalid_type", "type must be environment, ghg, social, or governance");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }
  const { context } = scoped;

  try {
    await ensureSchemasForType(type);
    const url = new URL(request.url);
    const hard = cleanString(url.searchParams.get("hard")).toLowerCase() === "true";
    const key = sanitizeKey(url.searchParams.get("key"));
    if (!key) {
      return badRequest(requestId, "missing_key", "query param key is required");
    }

    const definition = await readDefinitionByKey({ sql: context.sql, tenantId, type, key });
    if (!definition) {
      return badRequest(requestId, "definition_not_found", "definition not found", 404);
    }
    if (definition.isSystem) {
      return forbidden(requestId, "system_definition_locked", "system definitions cannot be deleted");
    }

    const referenced = await hasReferences({ sql: context.sql, tenantId, type, definition });
    if (hard && referenced) {
      return badRequest(
        requestId,
        "definition_has_references",
        "hard delete is not allowed while referenced records exist",
      );
    }

    if (hard) {
      if (type.defType === "environment_metric") {
        await context.sql`
          DELETE FROM metric_definitions
          WHERE key = ${key}
            AND tenant_id = ${tenantId}
        `;
      } else if (type.defType === "ghg_activity") {
        await context.sql`
          DELETE FROM ghg_activity_definitions
          WHERE tenant_id = ${tenantId}
            AND key = ${key}
        `;
      } else if (type.defType === "social_metric") {
        await context.sql`
          DELETE FROM social_metric_definitions
          WHERE tenant_id = ${tenantId}
            AND key = ${key}
        `;
      } else {
        await context.sql`
          DELETE FROM governance_field_definitions
          WHERE tenant_id = ${tenantId}
            AND key = ${key}
        `;
      }
    } else if (type.defType === "environment_metric") {
      await context.sql`
        UPDATE metric_definitions
        SET
          is_active = FALSE,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE key = ${key}
          AND tenant_id = ${tenantId}
      `;
    } else if (type.defType === "ghg_activity") {
      await context.sql`
        UPDATE ghg_activity_definitions
        SET
          is_active = FALSE,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND key = ${key}
      `;
    } else if (type.defType === "social_metric") {
      await context.sql`
        UPDATE social_metric_definitions
        SET
          is_active = FALSE,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND key = ${key}
      `;
    } else {
      await context.sql`
        UPDATE governance_field_definitions
        SET
          is_active = FALSE,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND key = ${key}
      `;
    }

    if (type.defType === "governance_field") {
      await context.sql`
        UPDATE governance_yearly
        SET
          custom_values = CASE
            WHEN custom_values ? ${key} THEN custom_values - ${key}
            ELSE custom_values
          END,
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
      `;
    }

    await cleanupMappings({ sql: context.sql, tenantId, defType: type.defType, key });

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: hard ? "definitions.hard_delete" : "definitions.soft_delete",
      entityType: type.defType,
      entityId: definition.id || key,
      payload: { type: type.defType, key, hard, referenced },
    });

    return json({ ok: true, key, hard, referenced });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Unable to delete definition", 500, {
      code: "definition_delete_failed",
      requestId,
    });
  }
}
