import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { ensureGhgSchema } from "../../../_lib/db.js";
import { SCOPE3_SUPPORT_MATRIX } from "../../../_lib/ghg-catalog.js";
import { getFactorDefaults, resolveCompany, resolveSite } from "../../../_lib/esg-api.js";
import { parseYear } from "../../../_lib/esg-domain.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FACTOR_LIBRARIES = new Set(["IPCC", "DEFRA", "EPA", "CUSTOM"]);
const DEFAULT_LIBRARY = "IPCC";
const DEFAULT_REFRIGERANT_TYPE = "R134A";
const IPCC_GWP_SOURCE_URL = "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_AnnexVII.pdf";

const REFRIGERANT_GWP100 = {
  R134A: 1430,
  R410A: 2088,
  R32: 675,
  R22: 1760,
  R407C: 1774,
  R404A: 3922,
};

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message, extra = {}) => errorJson(message, 400, { code, requestId, ...extra });
const serverError = (requestId, code, message) => errorJson(message, 500, { code, requestId });

const normalizeCountry = (value) => cleanString(value).toUpperCase();

const normalizeLibrary = (value) => {
  const normalized = cleanString(value).toUpperCase();
  if (!normalized) {
    return DEFAULT_LIBRARY;
  }
  return FACTOR_LIBRARIES.has(normalized) ? normalized : null;
};

const normalizeRefrigerantType = (value) => {
  const normalized = cleanString(value).toUpperCase();
  if (!normalized) {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(REFRIGERANT_GWP100, normalized) ? normalized : null;
};

const normalizeScope = (value) => {
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  return ["scope1", "scope2", "scope3"].includes(normalized) ? normalized : null;
};

const normalizeScope3Category = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15) {
    return null;
  }
  return parsed;
};

const normalizeMethod = (value) => {
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  return ["activity", "spend", "supplier_specific", "direct_tco2e"].includes(normalized) ? normalized : null;
};

const ensureCompanyAndSiteContext = async ({ sql, tenantId, companyId, siteId, requestId }) => {
  if (companyId && !UUID_PATTERN.test(companyId)) {
    return { error: badRequest(requestId, "invalid_company_id", "Query param companyId must be a valid UUID") };
  }
  if (siteId && !UUID_PATTERN.test(siteId)) {
    return { error: badRequest(requestId, "invalid_site_id", "Query param siteId must be a valid UUID") };
  }

  if (siteId) {
    const site = await resolveSite(sql, tenantId, siteId);
    if (!site) {
      return { error: badRequest(requestId, "invalid_site_id", "siteId is invalid for this tenant") };
    }
    if (companyId && site.company_id !== companyId) {
      return { error: badRequest(requestId, "site_company_mismatch", "siteId does not belong to companyId") };
    }
    return { site, companyId: site.company_id };
  }

  if (companyId) {
    const company = await resolveCompany(sql, tenantId, companyId);
    if (!company) {
      return { error: badRequest(requestId, "invalid_company_id", "companyId is invalid for this tenant") };
    }
  }

  return { site: null, companyId: companyId || null };
};

const chooseLibraryRows = ({
  rows,
  year,
  country,
  keySet,
  scope,
  scope3Category,
  method,
  spendCategory,
  transportMode,
  refrigerantType,
  region,
}) => {
  const bestByKey = new Map();

  for (const row of rows || []) {
    const key = cleanString(row.key);
    if (!keySet.has(key)) {
      continue;
    }

    const rowScope = cleanString(row.scope).toLowerCase();
    if (scope && rowScope && rowScope !== scope) {
      continue;
    }

    const rowScope3Category = row.scope3_category == null ? null : Number(row.scope3_category);
    if (scope3Category != null && rowScope3Category != null && rowScope3Category !== scope3Category) {
      continue;
    }

    const rowMethod = cleanString(row.method).toLowerCase();
    if (method && rowMethod && rowMethod !== method) {
      continue;
    }

    const rowSpendCategory = cleanString(row.spend_category).toLowerCase();
    if (spendCategory && rowSpendCategory && rowSpendCategory !== spendCategory) {
      continue;
    }

    const rowTransportMode = cleanString(row.transport_mode).toLowerCase();
    if (transportMode && rowTransportMode && rowTransportMode !== transportMode) {
      continue;
    }

    const rowRefrigerantType = cleanString(row.refrigerant_type).toUpperCase();
    if (refrigerantType && rowRefrigerantType && rowRefrigerantType !== refrigerantType) {
      continue;
    }

    const rowRegion = cleanString(row.region).toLowerCase();
    if (region && rowRegion && rowRegion !== region) {
      continue;
    }

    const rowCountry = cleanString(row.country).toUpperCase() || null;
    const rowYear = row.reporting_year == null ? row.year : row.reporting_year;

    const countryMatchScore = rowCountry === country ? 2 : rowCountry == null ? 1 : 0;
    const yearMatchScore = Number(rowYear) === year ? 2 : rowYear == null ? 1 : 0;
    const score = countryMatchScore * 10 + yearMatchScore;

    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { ...row, score });
    }
  }

  return bestByKey;
};

const normalizeSourceLabel = (row) => cleanString(row?.source_label) || cleanString(row?.source) || null;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "factors");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureGhgSchema();

    const url = new URL(request.url);
    const year = parseYear(url.searchParams.get("year"));
    const country = normalizeCountry(url.searchParams.get("country"));
    const companyId = cleanString(url.searchParams.get("companyId"));
    const siteId = cleanString(url.searchParams.get("siteId"));
    const library = normalizeLibrary(url.searchParams.get("library"));
    const requestedRefrigerantType = normalizeRefrigerantType(url.searchParams.get("refrigerantType"));
    const scope = normalizeScope(url.searchParams.get("scope"));
    const scope3Category = normalizeScope3Category(url.searchParams.get("scope3Category"));
    const method = normalizeMethod(url.searchParams.get("method"));
    const spendCategory = cleanString(url.searchParams.get("spendCategory")).toLowerCase() || null;
    const transportMode = cleanString(url.searchParams.get("transportMode")).toLowerCase() || null;
    const region = cleanString(url.searchParams.get("region")).toLowerCase() || null;
    const includeAllKeys = cleanString(url.searchParams.get("includeAll")).toLowerCase() === "true";

    if (!year) {
      return badRequest(requestId, "missing_year", "Query param year is required and must be a valid integer year");
    }
    if (!country) {
      return badRequest(requestId, "missing_country", "Query param country is required");
    }
    if (!library) {
      return badRequest(requestId, "invalid_library", "Query param library must be one of IPCC/DEFRA/EPA/CUSTOM");
    }
    if (url.searchParams.has("scope") && !scope) {
      return badRequest(requestId, "invalid_scope", "scope must be one of scope1/scope2/scope3");
    }
    if (url.searchParams.has("scope3Category") && scope3Category == null) {
      return badRequest(requestId, "invalid_scope3_category", "scope3Category must be an integer between 1 and 15");
    }
    if (url.searchParams.has("method") && !method) {
      return badRequest(
        requestId,
        "invalid_method",
        "method must be one of activity/spend/supplier_specific/direct_tco2e",
      );
    }

    const scopeCheck = await ensureCompanyAndSiteContext({
      sql: context.sql,
      tenantId,
      companyId,
      siteId,
      requestId,
    });
    if (scopeCheck.error) {
      return scopeCheck.error;
    }

    const [legacyDefinitions, ghgDefinitionRows, ghgRecordRows] = await Promise.all([
      Promise.resolve(getFactorDefaults()),
      context.sql`
        SELECT id, key, scope, scope3_category, requires_factor, default_factor_key, evidence_required
        FROM ghg_activity_definitions
        WHERE tenant_id = ${tenantId}
          AND is_active = TRUE
          AND deleted_at IS NULL
          AND default_factor_key IS NOT NULL
          AND (${scope || ""} = '' OR scope = ${scope})
          AND (${scope3Category ?? -1} = -1 OR scope3_category = ${scope3Category})
          AND (${method || ""} = '' OR method = ${method})
      `,
      context.sql`
        SELECT id, activity_def_id, direct_tco2e
        FROM ghg_activity_records
        WHERE tenant_id = ${tenantId}
          AND reporting_year = ${year}
          AND (${scopeCheck.companyId || ""} = '' OR company_id = ${scopeCheck.companyId})
          AND (${scopeCheck.site?.id || ""} = '' OR site_id = ${scopeCheck.site?.id})
      `,
    ]);

    const dynamicFactorDefinitions = [];
    const dynamicKeySet = new Set();
    for (const row of ghgDefinitionRows || []) {
      const factorKey = cleanString(row.default_factor_key);
      if (!factorKey || dynamicKeySet.has(factorKey)) {
        continue;
      }
      dynamicKeySet.add(factorKey);
      dynamicFactorDefinitions.push({
        key: factorKey,
        label: factorKey,
        unit: "kgCO2e/unit",
        required: false,
      });
    }

    const definitions = includeAllKeys ? [...legacyDefinitions, ...dynamicFactorDefinitions] : [...legacyDefinitions];
    const keySet = new Set(definitions.map((item) => item.key));
    for (const extra of dynamicFactorDefinitions) {
      keySet.add(extra.key);
    }

    const [tenantRows, countryRows, libraryRows, settingRows] = await Promise.all([
      context.sql`
        SELECT key, unit, value, source, source_label, source_url
        FROM emission_factors
        WHERE tenant_id = ${tenantId}
        ORDER BY key ASC
      `,
      context.sql`
        SELECT key, unit, value, source_label, source_url, updated_at
        FROM emission_factor_country_overrides
        WHERE tenant_id = ${tenantId}
          AND country = ${country}
          AND reporting_year = ${year}
        ORDER BY key ASC
      `,
      context.sql`
        SELECT
          library,
          country,
          reporting_year,
          year,
          key,
          unit,
          value,
          scope,
          scope3_category,
          method,
          spend_category,
          transport_mode,
          refrigerant_type,
          region,
          source_label,
          source_url,
          notes
        FROM emission_factor_library
        WHERE library = ${library}
          AND (country = ${country} OR country IS NULL)
          AND (reporting_year = ${year} OR year = ${year} OR reporting_year IS NULL OR year IS NULL)
      `,
      context.sql`
        SELECT country, refrigerant_type
        FROM emission_factor_settings
        WHERE tenant_id = ${tenantId}
          AND (country = ${country} OR country = '')
        ORDER BY CASE WHEN country = ${country} THEN 0 ELSE 1 END ASC
        LIMIT 1
      `,
    ]);

    const tenantMap = new Map((tenantRows || []).map((row) => [row.key, row]));
    const countryMap = new Map((countryRows || []).map((row) => [row.key, row]));
    const bestSuggestions = chooseLibraryRows({
      rows: libraryRows,
      year,
      country,
      keySet,
      scope,
      scope3Category,
      method,
      spendCategory,
      transportMode,
      refrigerantType: requestedRefrigerantType,
      region,
    });

    const storedRefrigerantType = normalizeRefrigerantType(settingRows?.[0]?.refrigerant_type);
    const refrigerantType = requestedRefrigerantType || storedRefrigerantType || DEFAULT_REFRIGERANT_TYPE;

    const tenantDefaults = definitions.map((definition) => {
      const row = tenantMap.get(definition.key);
      return {
        key: definition.key,
        unit: definition.unit,
        value: row?.value == null ? null : Number(row.value),
        source_label: normalizeSourceLabel(row),
        source_url: cleanString(row?.source_url) || null,
      };
    });

    const countryOverrides = definitions
      .map((definition) => {
        const row = countryMap.get(definition.key);
        if (!row) {
          return null;
        }
        return {
          key: definition.key,
          unit: definition.unit,
          value: row.value == null ? null : Number(row.value),
          source_label: cleanString(row.source_label) || null,
          source_url: cleanString(row.source_url) || null,
        };
      })
      .filter(Boolean);

    const suggestions = definitions.map((definition) => {
      const row = bestSuggestions.get(definition.key);
      const tenantDefault = tenantMap.get(definition.key);
      const countryOverride = countryMap.get(definition.key);
      let value = row?.value == null ? null : Number(row.value);
      let sourceLabel = cleanString(row?.source_label) || `${library} reference`;
      let sourceUrl = cleanString(row?.source_url) || null;
      let notes = cleanString(row?.notes) || null;
      const unit = cleanString(row?.unit) || cleanString(countryOverride?.unit) || cleanString(tenantDefault?.unit) || definition.unit;

      if (definition.key === "ef_refrigerant_kgco2e_per_kg") {
        const gwpValue = REFRIGERANT_GWP100[refrigerantType];
        if (Number.isFinite(gwpValue)) {
          value = gwpValue;
          sourceLabel = sourceLabel || "IPCC AR6 GWP100 table";
          sourceUrl = sourceUrl || IPCC_GWP_SOURCE_URL;
          notes = [notes, `Derived from refrigerant type ${refrigerantType} (GWP100).`].filter(Boolean).join(" ");
        }
      }

      if (value == null && definition.key === "ef_scope2_location_kgco2e_per_kwh") {
        notes = [notes, "Manual required: verify location-based electricity factor for the selected country."].filter(Boolean).join(" ");
      }

      return {
        key: definition.key,
        unit,
        value,
        source_label: sourceLabel,
        source_url: sourceUrl,
        scope: cleanString(row?.scope) || null,
        scope3_category: row?.scope3_category == null ? null : Number(row.scope3_category),
        method: cleanString(row?.method) || null,
        spend_category: cleanString(row?.spend_category) || null,
        transport_mode: cleanString(row?.transport_mode) || null,
        refrigerant_type: cleanString(row?.refrigerant_type).toUpperCase() || null,
        region: cleanString(row?.region) || null,
        notes,
      };
    });

    const recordIds = ghgRecordRows.map((row) => row.id).filter(Boolean);
    const evidenceLinkRows =
      recordIds.length > 0
        ? await context.sql`
            SELECT entity_id
            FROM entity_evidence
            WHERE tenant_id = ${tenantId}
              AND entity_type = 'ghg_record'
              AND entity_id = ANY(${recordIds})
          `
        : [];
    const evidenceSet = new Set((evidenceLinkRows || []).map((row) => cleanString(row.entity_id)).filter(Boolean));
    const supportMap = new Map(SCOPE3_SUPPORT_MATRIX.map((item) => [Number(item.category), item.status]));
    const definitionById = new Map((ghgDefinitionRows || []).map((row) => [row.id, row]));
    const suggestionByKey = new Map(suggestions.map((item) => [item.key, item]));
    const missingFactorsCount = definitions.reduce((count, definition) => {
      const hasTenant = tenantMap.has(definition.key);
      const hasCountry = countryMap.has(definition.key);
      const hasSuggestion = suggestionByKey.get(definition.key)?.value != null;
      return !hasTenant && !hasCountry && !hasSuggestion ? count + 1 : count;
    }, 0);
    const unsupportedCategoriesCount = SCOPE3_SUPPORT_MATRIX.filter((item) => item.status !== "supported").filter((item) =>
      scope === "scope3" && scope3Category != null ? Number(item.category) === scope3Category : true,
    ).length;
    const missingEvidenceCount = ghgRecordRows.reduce((count, row) => {
      const definition = definitionById.get(row.activity_def_id);
      return definition?.evidence_required === true && !evidenceSet.has(row.id) ? count + 1 : count;
    }, 0);
    const nonComputableRecordCount = ghgRecordRows.reduce((count, row) => {
      const definition = definitionById.get(row.activity_def_id);
      if (!definition) {
        return count;
      }
      if (definition.scope === "scope3" && supportMap.get(Number(definition.scope3_category)) === "not_enabled") {
        return count + 1;
      }
      if (definition.requires_factor === true && row.direct_tco2e == null) {
        const factorKey = cleanString(definition.default_factor_key);
        const hasResolvedFactor =
          countryMap.has(factorKey) || tenantMap.has(factorKey) || suggestionByKey.get(factorKey)?.value != null;
        return hasResolvedFactor ? count : count + 1;
      }
      return count;
    }, 0);

    return json({
      ok: true,
      tenantDefaults,
      countryOverrides,
      suggestions,
      context: {
        year,
        country,
        siteId: scopeCheck.site?.id || siteId || null,
        companyId: scopeCheck.companyId || null,
        scope: scope || null,
        scope3Category: scope3Category ?? null,
        method: method || null,
        spendCategory: spendCategory || null,
        transportMode: transportMode || null,
        region: region || null,
      },
      settings: {
        refrigerantType,
        refrigerantOptions: Object.keys(REFRIGERANT_GWP100),
        resolutionOrder: ["country_override", "tenant_default", "library_suggestion", "missing"],
      },
      summary: {
        missingFactorsCount,
        unsupportedCategoriesCount,
        missingEvidenceCount,
        nonComputableRecordCount,
      },
      scope3Support: SCOPE3_SUPPORT_MATRIX,
      requestId,
    });
  } catch (error) {
    return serverError(
      requestId,
      "factors_fetch_failed",
      error instanceof Error ? error.message : "Unable to load factors",
    );
  }
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "factors");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    const payload = await parseJsonBody(request);
    const scope = cleanString(payload.scope).toLowerCase();
    const reportingYear = parseYear(payload.reportingYear);
    const country = normalizeCountry(payload.country);
    const library = payload.library == null ? null : normalizeLibrary(payload.library);
    const refrigerantTypeInput = cleanString(payload.refrigerantType);
    const refrigerantType = normalizeRefrigerantType(payload.refrigerantType);
    const updates = Array.isArray(payload.updates) ? payload.updates : [];

    if (scope !== "tenant" && scope !== "country") {
      return badRequest(requestId, "invalid_scope", "scope must be one of tenant/country");
    }
    if (!reportingYear) {
      return badRequest(requestId, "invalid_reporting_year", "reportingYear is required and must be a valid integer year");
    }
    if (scope === "country" && !country) {
      return badRequest(requestId, "missing_country", "country is required when scope=country");
    }
    if (payload.library != null && !library) {
      return badRequest(requestId, "invalid_library", "library must be one of IPCC/DEFRA/EPA/CUSTOM");
    }
    if (refrigerantTypeInput && !refrigerantType) {
      return badRequest(requestId, "invalid_refrigerant_type", "refrigerantType is invalid");
    }
    if (updates.length === 0) {
      return badRequest(requestId, "missing_updates", "updates[] is required");
    }

    const [libraryDefinitionRows, ghgDefinitionRows] = await Promise.all([
      context.sql`
        SELECT DISTINCT key, unit
        FROM emission_factor_library
      `,
      context.sql`
        SELECT DISTINCT default_factor_key
        FROM ghg_activity_definitions
        WHERE tenant_id = ${tenantId}
          AND is_active = TRUE
          AND deleted_at IS NULL
          AND default_factor_key IS NOT NULL
      `,
    ]);

    const definitionByKey = new Map();
    for (const item of getFactorDefaults()) {
      definitionByKey.set(item.key, {
        key: item.key,
        label: item.label,
        unit: item.unit,
      });
    }
    for (const row of libraryDefinitionRows || []) {
      const key = cleanString(row.key);
      if (!key) {
        continue;
      }
      const existing = definitionByKey.get(key);
      definitionByKey.set(key, {
        key,
        label: existing?.label || key,
        unit: cleanString(row.unit) || existing?.unit || "kgCO2e/unit",
      });
    }
    for (const row of ghgDefinitionRows || []) {
      const key = cleanString(row.default_factor_key);
      if (!key) {
        continue;
      }
      const existing = definitionByKey.get(key);
      definitionByKey.set(key, {
        key,
        label: existing?.label || key,
        unit: existing?.unit || "kgCO2e/unit",
      });
    }
    const normalizedUpdates = [];

    for (const row of updates) {
      const key = cleanString(row?.key);
      const definition = definitionByKey.get(key);
      if (!definition) {
        return badRequest(requestId, "invalid_key", `Unknown factor key: ${key || "<empty>"}`);
      }

      const value = Number(row?.value);
      if (!Number.isFinite(value)) {
        return badRequest(requestId, "invalid_value", `Factor value for ${key} must be numeric`);
      }

      const unit = cleanString(row?.unit);
      if (!unit) {
        return badRequest(requestId, "missing_unit", `unit is required for ${key}`);
      }
      if (definition.unit && definition.unit !== unit) {
        return badRequest(requestId, "invalid_unit", `${key} expects unit ${definition.unit}`);
      }

      normalizedUpdates.push({
        key,
        unit,
        value,
        sourceLabel: cleanString(row?.source_label) || cleanString(row?.source) || null,
        sourceUrl: cleanString(row?.source_url) || null,
      });
    }

    const updatedKeys = [];

    for (const update of normalizedUpdates) {
      const definition = definitionByKey.get(update.key);

      if (scope === "tenant") {
        await context.sql`
          INSERT INTO emission_factors (tenant_id, key, label, unit, value, source, source_label, source_url)
          VALUES (
            ${tenantId},
            ${update.key},
            ${definition.label},
            ${definition.unit || update.unit},
            ${update.value},
            ${update.sourceLabel},
            ${update.sourceLabel},
            ${update.sourceUrl}
          )
          ON CONFLICT (tenant_id, key) DO UPDATE
            SET
              label = EXCLUDED.label,
              unit = EXCLUDED.unit,
              value = EXCLUDED.value,
              source = EXCLUDED.source,
              source_label = EXCLUDED.source_label,
              source_url = EXCLUDED.source_url,
              updated_at = NOW()
        `;

        await writeAuditLog(context.sql, {
          tenantId,
          actorUserId: context.user.id,
          action: "factor.upsert",
          entityType: "factor",
          entityId: update.key,
          payload: {
            scope,
            reportingYear,
            key: update.key,
            value: update.value,
            unit: update.unit,
            sourceLabel: update.sourceLabel,
            sourceUrl: update.sourceUrl,
            library,
          },
        });
      } else {
        await context.sql`
          INSERT INTO emission_factor_country_overrides (
            tenant_id,
            country,
            reporting_year,
            key,
            value,
            unit,
            source_label,
            source_url,
            updated_at
          )
          VALUES (
            ${tenantId},
            ${country},
            ${reportingYear},
            ${update.key},
            ${update.value},
            ${definition.unit || update.unit},
            ${update.sourceLabel},
            ${update.sourceUrl},
            NOW()
          )
          ON CONFLICT (tenant_id, country, reporting_year, key) DO UPDATE
            SET
              value = EXCLUDED.value,
              unit = EXCLUDED.unit,
              source_label = EXCLUDED.source_label,
              source_url = EXCLUDED.source_url,
              updated_at = NOW()
        `;

        await writeAuditLog(context.sql, {
          tenantId,
          actorUserId: context.user.id,
          action: "factor.country_override.upsert",
          entityType: "factor",
          entityId: `${country}:${reportingYear}:${update.key}`,
          payload: {
            scope,
            country,
            reportingYear,
            key: update.key,
            value: update.value,
            unit: update.unit,
            sourceLabel: update.sourceLabel,
            sourceUrl: update.sourceUrl,
            library,
          },
        });
      }

      updatedKeys.push(update.key);
    }

    if (refrigerantType) {
      const settingsCountry = scope === "country" ? country : "";
      await context.sql`
        INSERT INTO emission_factor_settings (tenant_id, country, refrigerant_type, updated_at)
        VALUES (${tenantId}, ${settingsCountry}, ${refrigerantType}, NOW())
        ON CONFLICT (tenant_id, country) DO UPDATE
          SET
            refrigerant_type = EXCLUDED.refrigerant_type,
            updated_at = NOW()
      `;
    }

    return json({
      ok: true,
      scope,
      country: scope === "country" ? country : null,
      reportingYear,
      library,
      updatedKeys,
      refrigerantType: refrigerantType || null,
    });
  } catch (error) {
    return serverError(
      requestId,
      "factors_update_failed",
      error instanceof Error ? error.message : "Unable to update factors",
    );
  }
}
