import { randomUUID } from "node:crypto";
import { cleanString, parseJsonColumn } from "./http.js";

export const STANDARDS_FRAMEWORKS = ["GRI", "SASB"];
export const DEF_TYPES = ["environment_metric", "ghg_activity", "social_metric", "governance_field"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value) => UUID_PATTERN.test(String(value || "").trim());

export const toRequestId = (request) =>
  request?.headers?.get?.("x-request-id") || request?.headers?.get?.("x-vercel-id") || randomUUID();

const normalizeFramework = (value) => {
  const framework = cleanString(value).toUpperCase();
  return STANDARDS_FRAMEWORKS.includes(framework) ? framework : null;
};

const normalizeDefType = (value) => {
  const defType = cleanString(value);
  return DEF_TYPES.includes(defType) ? defType : null;
};

const safeJson = (value, fallback) => {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  return fallback;
};

const parseSdgs = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => Number.parseInt(String(item), 10)).filter((item) => Number.isInteger(item) && item >= 1 && item <= 17))].sort((a, b) => a - b);
  }

  const text = cleanString(value);
  if (!text) {
    return [];
  }

  return [...new Set(text.split(/[|;\s]+/g).map((item) => Number.parseInt(item, 10)).filter((item) => Number.isInteger(item) && item >= 1 && item <= 17))].sort((a, b) => a - b);
};

export const GOVERNANCE_FIELD_DEFINITIONS = [
  { key: "board_total", label: "Board total members", unit: "count" },
  { key: "board_women", label: "Women on board", unit: "count" },
  { key: "board_independent", label: "Independent board members", unit: "count" },
  { key: "board_meetings", label: "Board meetings", unit: "count" },
  { key: "anti_corruption_policy", label: "Anti-corruption policy", unit: "boolean" },
  { key: "whistleblowing_channel", label: "Whistleblowing channel", unit: "boolean" },
  { key: "data_privacy_policy", label: "Data privacy policy", unit: "boolean" },
  { key: "supplier_code_of_conduct", label: "Supplier code of conduct", unit: "boolean" },
  { key: "gdpr_training", label: "GDPR training", unit: "boolean" },
  { key: "data_breaches_count", label: "Data breaches", unit: "count" },
  { key: "corruption_incidents_count", label: "Corruption incidents", unit: "count" },
  { key: "fines_amount_eur", label: "Fines amount", unit: "EUR" },
  { key: "policy_anti_corruption", label: "Policy: anti-corruption", unit: "status" },
  { key: "policy_whistleblowing", label: "Policy: whistleblowing", unit: "status" },
  { key: "policy_data_privacy", label: "Policy: data privacy", unit: "status" },
  { key: "policy_supplier_code", label: "Policy: supplier code", unit: "status" },
  { key: "policy_grievance_mechanism", label: "Policy: grievance mechanism", unit: "status" },
];

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
};

export const parseStandardsImportCsv = (csvText) => {
  const text = String(csvText || "").replace(/\r/g, "").trim();
  if (!text) {
    return { error: "csv text is required" };
  }

  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { error: "csv requires header and at least one row" };
  }

  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const idx = (name) => header.indexOf(name);

  if (idx("framework") < 0 || idx("code") < 0 || idx("title") < 0) {
    return { error: "csv must include framework, code, title columns" };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const read = (name) => {
      const position = idx(name);
      return position >= 0 ? cells[position] || "" : "";
    };

    const framework = normalizeFramework(read("framework"));
    if (!framework) {
      return { error: `invalid framework at row ${i + 1}` };
    }

    const code = cleanString(read("code"));
    const title = cleanString(read("title"));
    if (!code || !title) {
      return { error: `code/title required at row ${i + 1}` };
    }

    const internalTypeRaw = cleanString(read("internal_type"));
    const internalKeyRaw = cleanString(read("internal_key"));
    const internalType = internalTypeRaw ? normalizeDefType(internalTypeRaw) : null;
    if (internalTypeRaw && !internalType) {
      return { error: `invalid internal_type at row ${i + 1}` };
    }
    if (internalType && !internalKeyRaw) {
      return { error: `internal_key required when internal_type is set at row ${i + 1}` };
    }

    rows.push({
      framework,
      industryCode: cleanString(read("industry_code")) || null,
      code,
      title,
      unit: cleanString(read("unit")) || null,
      methodHint: cleanString(read("method_hint")) || null,
      sdgs: parseSdgs(read("sdgs")),
      referenceUrl: cleanString(read("reference_url")) || null,
      internalType,
      internalKey: internalKeyRaw || null,
      notes: cleanString(read("notes")) || null,
    });
  }

  return { rows };
};

export const ensureStandardsFrameworks = async (sql) => {
  for (const framework of STANDARDS_FRAMEWORKS) {
    await sql`
      INSERT INTO standards_frameworks (id, name)
      VALUES (${framework}, ${framework})
      ON CONFLICT (id) DO NOTHING
    `;
  }
};

export const normalizeCompanyProfile = (row) => {
  if (!row) {
    return {
      industryFramework: "GRI",
      sasbIndustryCode: null,
      griProfile: {},
      region: null,
      country: null,
      updatedAt: null,
    };
  }

  return {
    industryFramework: normalizeFramework(row.industry_framework) || "GRI",
    sasbIndustryCode: row.sasb_industry_code || null,
    griProfile: safeJson(row.gri_profile, {}),
    region: row.region || null,
    country: row.country || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};

export const loadCompanyProfile = async ({ sql, tenantId, companyId }) => {
  const rows = await sql`
    SELECT tenant_id, company_id, industry_framework, sasb_industry_code, gri_profile, region, country, updated_at
    FROM company_profiles
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
    LIMIT 1
  `;
  return normalizeCompanyProfile(rows?.[0]);
};

export const upsertCompanyProfile = async ({ sql, tenantId, companyId, profile }) => {
  const framework = normalizeFramework(profile?.industryFramework || profile?.industry_framework || "GRI") || "GRI";
  const sasbIndustryCode = cleanString(profile?.sasbIndustryCode || profile?.sasb_industry_code) || null;
  const region = cleanString(profile?.region) || null;
  const country = cleanString(profile?.country) || null;
  const griProfileRaw = profile?.griProfile ?? profile?.gri_profile ?? {};
  const griProfile = griProfileRaw && typeof griProfileRaw === "object" && !Array.isArray(griProfileRaw) ? griProfileRaw : {};

  await sql`
    INSERT INTO company_profiles (
      tenant_id,
      company_id,
      industry_framework,
      sasb_industry_code,
      gri_profile,
      region,
      country,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${companyId},
      ${framework},
      ${sasbIndustryCode},
      ${JSON.stringify(griProfile)}::jsonb,
      ${region},
      ${country},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id)
    DO UPDATE SET
      industry_framework = EXCLUDED.industry_framework,
      sasb_industry_code = EXCLUDED.sasb_industry_code,
      gri_profile = EXCLUDED.gri_profile,
      region = EXCLUDED.region,
      country = EXCLUDED.country,
      updated_at = NOW()
  `;

  return loadCompanyProfile({ sql, tenantId, companyId });
};

export const parseEnabledDefinitionsPayload = (payload) => {
  const raw = Array.isArray(payload?.definitions)
    ? payload.definitions
    : Array.isArray(payload?.enabledDefinitions)
      ? payload.enabledDefinitions
      : null;

  if (!raw) {
    return { error: "definitions must be an array" };
  }

  const normalized = [];
  for (const item of raw) {
    const defType = normalizeDefType(item?.defType || item?.def_type);
    const defKey = cleanString(item?.defKey || item?.def_key);
    if (!defType || !defKey) {
      return { error: "each definition requires valid defType and defKey" };
    }
    normalized.push({
      defType,
      defKey,
      enabled: item?.enabled !== false,
      required: item?.required === true,
    });
  }

  return { definitions: normalized };
};

export const replaceCompanyEnabledDefinitions = async ({ sql, tenantId, companyId, definitions }) => {
  await sql`
    DELETE FROM company_enabled_definitions
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
  `;

  for (const item of definitions) {
    await sql`
      INSERT INTO company_enabled_definitions (
        tenant_id,
        company_id,
        def_type,
        def_key,
        enabled,
        required,
        updated_at
      )
      VALUES (
        ${tenantId},
        ${companyId},
        ${item.defType},
        ${item.defKey},
        ${item.enabled},
        ${item.required},
        NOW()
      )
      ON CONFLICT (tenant_id, company_id, def_type, def_key)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        required = EXCLUDED.required,
        updated_at = NOW()
    `;
  }
};

export const loadCompanyEnabledDefinitions = async ({ sql, tenantId, companyId }) => {
  const rows = await sql`
    SELECT def_type, def_key, enabled, required, updated_at
    FROM company_enabled_definitions
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
    ORDER BY def_type ASC, def_key ASC
  `;

  const byType = new Map();
  for (const type of DEF_TYPES) {
    byType.set(type, new Map());
  }

  for (const row of rows || []) {
    if (!byType.has(row.def_type)) {
      continue;
    }
    byType.get(row.def_type).set(row.def_key, {
      enabled: row.enabled === true,
      required: row.required === true,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    });
  }

  return byType;
};

export const loadInternalDefinitionCatalog = async ({ sql, tenantId, includeInactive = false }) => {
  const [envRows, ghgRows, socialRows, governanceRows] = await Promise.all([
    sql`
      SELECT key, tenant_id, category, label, unit, description, is_required, validation, is_system, is_active, deleted_at
      FROM metric_definitions
      WHERE (tenant_id IS NULL OR tenant_id = ${tenantId})
        AND (${includeInactive} = TRUE OR (is_active = TRUE AND deleted_at IS NULL))
      ORDER BY category ASC, key ASC
    `,
    sql`
      SELECT id, key, name, scope, scope3_category, unit, method, is_system, is_active, deleted_at, sort_order
      FROM ghg_activity_definitions
      WHERE tenant_id = ${tenantId}
        AND (${includeInactive} = TRUE OR (is_active = TRUE AND deleted_at IS NULL))
      ORDER BY scope ASC, scope3_category ASC NULLS FIRST, sort_order ASC, key ASC
    `,
    sql`
      SELECT id, key, name, unit, method, is_system, is_active, deleted_at, sort_order
      FROM social_metric_definitions
      WHERE tenant_id = ${tenantId}
        AND (${includeInactive} = TRUE OR (is_active = TRUE AND deleted_at IS NULL))
      ORDER BY is_active DESC, sort_order ASC, key ASC
    `,
    sql`
      SELECT id, key, label, field_type, unit, options, sdgs, evidence_required, is_system, is_active, deleted_at, updated_at
      FROM governance_field_definitions
      WHERE tenant_id = ${tenantId}
        AND (${includeInactive} = TRUE OR (is_active = TRUE AND deleted_at IS NULL))
      ORDER BY key ASC
    `,
  ]);

  const governanceSource = governanceRows && governanceRows.length > 0
    ? governanceRows
    : GOVERNANCE_FIELD_DEFINITIONS.map((row) => ({
        id: row.key,
        key: row.key,
        label: row.label,
        field_type: row.unit === "boolean" ? "boolean" : row.unit === "status" ? "select" : "number",
        unit: row.unit || null,
        options: row.unit === "status" ? ["yes", "no", "in_progress"] : [],
        sdgs: [],
        evidence_required: false,
        is_system: true,
        is_active: true,
        deleted_at: null,
      }));

  return {
    environment_metric: (envRows || []).map((row) => ({
      key: row.key,
      name: row.label,
      unit: row.unit,
      category: row.category,
      requiredByDefault: row.is_required === true,
      validation: parseJsonColumn(row.validation) || {},
      description: row.description || "",
      isSystem: row.is_system === true,
      isActive: row.is_active !== false,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      custom: row.is_system !== true,
    })),
    ghg_activity: (ghgRows || []).map((row) => ({
      key: row.key,
      id: row.id,
      name: row.name,
      unit: row.unit,
      scope: row.scope,
      scope3Category: row.scope3_category == null ? null : Number(row.scope3_category),
      method: row.method,
      isActive: row.is_active !== false,
      isSystem: row.is_system === true,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      custom: row.is_system !== true,
    })),
    social_metric: (socialRows || []).map((row) => ({
      key: row.key,
      id: row.id,
      name: row.name,
      unit: row.unit,
      method: row.method,
      isActive: row.is_active !== false,
      isSystem: row.is_system === true,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      custom: row.is_system !== true,
    })),
    governance_field: governanceSource.map((row) => ({
      id: row.id || row.key,
      key: row.key,
      name: row.label,
      label: row.label,
      unit: row.unit || null,
      fieldType: row.field_type || "text",
      options: Array.isArray(parseJsonColumn(row.options)) ? parseJsonColumn(row.options) : [],
      sdgs: Array.isArray(parseJsonColumn(row.sdgs)) ? parseJsonColumn(row.sdgs) : [],
      evidenceRequired: row.evidence_required === true,
      isActive: row.is_active !== false,
      isSystem: row.is_system === true,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      custom: row.is_system !== true,
    })),
  };
};

export const buildDefinitionsWithEnabledState = ({ catalog, enabledByType }) => {
  const output = {};
  for (const [type, definitions] of Object.entries(catalog)) {
    const enabledMap = enabledByType.get(type) || new Map();
    const knownKeys = new Set();
    output[type] = definitions.map((item) => {
      knownKeys.add(item.key);
      const state = enabledMap.get(item.key);
      return {
        ...item,
        enabled: state ? state.enabled : true,
        required: state ? state.required : false,
      };
    });

    for (const [defKey, state] of enabledMap.entries()) {
      if (knownKeys.has(defKey)) {
        continue;
      }
      output[type].push({
        key: defKey,
        name: defKey,
        unit: "unit",
        category: "Custom",
        description: "Custom enabled field",
        enabled: state.enabled,
        required: state.required,
        isSystem: false,
        custom: true,
      });
    }
  }
  return output;
};

export const filterDefinitionsByCompanyEnabled = async ({ sql, tenantId, companyId, defType, definitions, keyField = "key" }) => {
  const type = normalizeDefType(defType);
  if (!type || !companyId) {
    return definitions;
  }

  const rows = await sql`
    SELECT def_key, enabled
    FROM company_enabled_definitions
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND def_type = ${type}
  `;

  if (!rows || rows.length === 0) {
    return definitions;
  }

  const stateByKey = new Map(rows.map((row) => [row.def_key, row.enabled === true]));
  return definitions.filter((item) => {
    const key = String(item?.[keyField] || "");
    if (!stateByKey.has(key)) {
      return true;
    }
    return stateByKey.get(key) === true;
  });
};

export const listStandardsMetrics = async ({ sql, tenantId, framework = null, industryCode = null, limit = 500 }) => {
  const normalizedFramework = framework ? normalizeFramework(framework) : null;
  const normalizedIndustry = cleanString(industryCode) || null;

  return sql`
    SELECT
      sm.id,
      sm.framework,
      sm.industry_code,
      sm.code,
      sm.title,
      sm.unit,
      sm.method_hint,
      sm.sdgs,
      sm.reference_url,
      sm.created_at,
      sm.updated_at,
      (
        SELECT COUNT(*)::int
        FROM standards_mappings map
        WHERE map.tenant_id = ${tenantId}
          AND map.standards_metric_id = sm.id
      ) AS mappings_count
    FROM standards_metrics sm
    WHERE (${normalizedFramework || ""} = '' OR sm.framework = ${normalizedFramework || ""})
      AND (${normalizedIndustry || ""} = '' OR sm.industry_code = ${normalizedIndustry || ""})
    ORDER BY sm.framework ASC, sm.industry_code ASC NULLS FIRST, sm.code ASC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 500, 2000))}
  `;
};

export const normalizeStandardsMetric = (row) => ({
  id: row.id,
  framework: row.framework,
  industryCode: row.industry_code || null,
  code: row.code,
  title: row.title,
  unit: row.unit || null,
  methodHint: row.method_hint || null,
  sdgs: parseSdgs(parseJsonColumn(row.sdgs) || []),
  referenceUrl: row.reference_url || null,
  mappingsCount: Number(row.mappings_count || 0),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const importStandardsCsv = async ({ sql, tenantId, rows }) => {
  let inserted = 0;
  let updated = 0;
  let mapped = 0;

  for (const item of rows) {
    const existingRows = await sql`
      SELECT id
      FROM standards_metrics
      WHERE framework = ${item.framework}
        AND code = ${item.code}
        AND (
          (${item.industryCode || ""} = '' AND industry_code IS NULL)
          OR industry_code = ${item.industryCode}
        )
      LIMIT 1
    `;

    let metricId = existingRows?.[0]?.id || null;
    if (metricId) {
      await sql`
        UPDATE standards_metrics
        SET
          title = ${item.title},
          unit = ${item.unit},
          method_hint = ${item.methodHint},
          sdgs = ${JSON.stringify(item.sdgs)}::jsonb,
          reference_url = ${item.referenceUrl},
          updated_at = NOW()
        WHERE id = ${metricId}
      `;
      updated += 1;
    } else {
      metricId = randomUUID();
      await sql`
        INSERT INTO standards_metrics (
          id,
          framework,
          industry_code,
          code,
          title,
          unit,
          method_hint,
          sdgs,
          reference_url,
          created_at,
          updated_at
        )
        VALUES (
          ${metricId},
          ${item.framework},
          ${item.industryCode},
          ${item.code},
          ${item.title},
          ${item.unit},
          ${item.methodHint},
          ${JSON.stringify(item.sdgs)}::jsonb,
          ${item.referenceUrl},
          NOW(),
          NOW()
        )
      `;
      inserted += 1;
    }

    if (!metricId) {
      continue;
    }

    if (item.internalType && item.internalKey) {
      await sql`
        INSERT INTO standards_mappings (
          tenant_id,
          framework,
          standards_metric_id,
          internal_type,
          internal_key,
          notes,
          updated_at
        )
        VALUES (
          ${tenantId},
          ${item.framework},
          ${metricId},
          ${item.internalType},
          ${item.internalKey},
          ${item.notes},
          NOW()
        )
        ON CONFLICT (tenant_id, framework, standards_metric_id, internal_type, internal_key)
        DO UPDATE SET
          notes = EXCLUDED.notes,
          updated_at = NOW()
      `;
      mapped += 1;
    }
  }

  return {
    inserted,
    updated,
    mapped,
    total: rows.length,
  };
};

export const applyRecommendedSetForCompany = async ({ sql, tenantId, companyId, framework, sasbIndustryCode }) => {
  const normalizedFramework = normalizeFramework(framework);
  if (!normalizedFramework) {
    return { error: "framework must be GRI or SASB" };
  }

  const industryCode = cleanString(sasbIndustryCode) || null;
  const mappings = await sql`
    SELECT DISTINCT m.internal_type, m.internal_key
    FROM standards_mappings m
    INNER JOIN standards_metrics sm ON sm.id = m.standards_metric_id
    WHERE m.tenant_id = ${tenantId}
      AND m.framework = ${normalizedFramework}
      AND sm.framework = ${normalizedFramework}
      AND (
        ${industryCode || ""} = ''
        OR sm.industry_code IS NULL
        OR sm.industry_code = ${industryCode || ""}
      )
  `;

  let target = [];
  if (mappings.length > 0) {
    target = mappings
      .map((row) => ({
        defType: normalizeDefType(row.internal_type),
        defKey: cleanString(row.internal_key),
        enabled: true,
        required: false,
      }))
      .filter((item) => item.defType && item.defKey);
  } else {
    const catalog = await loadInternalDefinitionCatalog({ sql, tenantId });
    target = DEF_TYPES.flatMap((defType) =>
      (catalog[defType] || []).map((item) => ({
        defType,
        defKey: item.key,
        enabled: true,
        required: false,
      })),
    );
  }

  await replaceCompanyEnabledDefinitions({
    sql,
    tenantId,
    companyId,
    definitions: target,
  });

  return {
    framework: normalizedFramework,
    industryCode,
    enabledCount: target.length,
  };
};

export const normalizeStandardsFramework = normalizeFramework;
export const normalizeDefinitionType = normalizeDefType;
