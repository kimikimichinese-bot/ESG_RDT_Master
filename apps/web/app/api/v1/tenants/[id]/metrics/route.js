import { writeAuditLog } from "../../../_lib/audit.js";
import { ensureEnterpriseSchema, ensureMetricsSchema, ensureStandardsSchema } from "../../../_lib/db.js";
import {
  getMetricRowsForSiteYear,
  getStrictWaterDischargeConfig,
  normalizeMetricDefinition,
  normalizeMetricRow,
  resolveSite,
  upsertMetricRow,
  validateAndNormalizeMetricEntries,
} from "../../../_lib/esg-api.js";
import { METRIC_DEFINITIONS, asMetricValueMap, parseYear } from "../../../_lib/esg-domain.js";
import { cleanString, errorJson, json, parseJsonBody, parseJsonColumn } from "../../../_lib/http.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { filterDefinitionsByCompanyEnabled } from "../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_PATTERN.test(value);

const badRequest = (code, message) => json({ ok: false, code, message }, 400);

const normalizeDefinitionRow = (row) =>
  normalizeMetricDefinition({
    key: row.key,
    category: row.category,
    label: row.label,
    unit: row.unit,
    description: row.description,
    isRequired: Boolean(row.is_required),
    validation: parseJsonColumn(row.validation),
  });

const readMetricDefinitions = async (sql, tenantId) => {
  const rows = await sql`
    SELECT key, category, label, unit, description, is_required, validation
    FROM metric_definitions
    WHERE (tenant_id IS NULL OR tenant_id = ${tenantId})
      AND is_active = TRUE
      AND deleted_at IS NULL
    ORDER BY category ASC, key ASC
  `;
  if (rows && rows.length > 0) {
    return rows.map((row) => normalizeDefinitionRow(row));
  }
  return METRIC_DEFINITIONS.map((item) => normalizeMetricDefinition(item));
};

const parseMetricsQuery = (requestUrl) => {
  const url = new URL(requestUrl);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));
  const yearRaw = cleanString(url.searchParams.get("year"));
  const category = cleanString(url.searchParams.get("category"));
  const metricKey = cleanString(url.searchParams.get("metricKey"));

  if (!yearRaw) {
    return { error: badRequest("missing_year", "Query param year is required") };
  }

  const reportingYear = parseYear(yearRaw);
  if (!reportingYear) {
    return { error: badRequest("invalid_year", "Query param year must be a valid integer year") };
  }

  if (!companyId) {
    return { error: badRequest("missing_company_id", "Query param companyId is required") };
  }
  if (!isUuid(companyId)) {
    return { error: badRequest("invalid_company_id", "Query param companyId must be a valid UUID") };
  }

  if (!siteId) {
    return { error: badRequest("missing_site_id", "Query param siteId is required") };
  }
  if (!isUuid(siteId)) {
    return { error: badRequest("invalid_site_id", "Query param siteId must be a valid UUID") };
  }

  return {
    companyId,
    siteId,
    reportingYear,
    category,
    metricKey,
  };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const parsed = parseMetricsQuery(request.url);
  if (parsed.error) {
    return parsed.error;
  }

  const { context } = scoped;
  const { companyId, siteId, reportingYear, category, metricKey } = parsed;

  try {
    await ensureEnterpriseSchema();
    await ensureMetricsSchema();
    await ensureStandardsSchema();

    let definitions = await readMetricDefinitions(context.sql, tenantId);
    definitions = await filterDefinitionsByCompanyEnabled({
      sql: context.sql,
      tenantId,
      companyId,
      defType: "environment_metric",
      definitions,
      keyField: "key",
    });

    const rows = await context.sql`
      SELECT
        m.metric_key,
        m.value
      FROM site_metrics m
      JOIN metric_definitions d ON d.key = m.metric_key
      WHERE m.tenant_id = ${tenantId}
        AND m.company_id = ${companyId}
        AND m.site_id = ${siteId}
        AND m.reporting_year = ${reportingYear}
        AND (d.tenant_id IS NULL OR d.tenant_id = ${tenantId})
        AND d.is_active = TRUE
        AND d.deleted_at IS NULL
        AND (${metricKey} = '' OR m.metric_key = ${metricKey})
        AND (${category} = '' OR d.category = ${category})
      ORDER BY m.metric_key ASC
    `;

    const values = {};
    for (const row of rows || []) {
      const value = Number(row.value);
      if (Number.isFinite(value)) {
        values[row.metric_key] = value;
      }
    }

    const definitionKeySet = new Set(definitions.map((item) => item.key));
    const derived = {};
    for (const definition of definitions) {
      if (definition.validation?.derived && Object.prototype.hasOwnProperty.call(values, definition.key)) {
        derived[definition.key] = values[definition.key];
      }
    }

    for (const key of Object.keys(values)) {
      if (!definitionKeySet.has(key)) {
        delete values[key];
      }
    }

    return json({
      ok: true,
      definitions,
      values,
      derived,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        code: "metrics_fetch_failed",
        message: error instanceof Error ? error.message : "Unable to load environment metrics",
      },
      500,
    );
  }
}

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  await ensureEnterpriseSchema();
  await ensureMetricsSchema();
  const payload = await parseJsonBody(request);

  const site = await resolveSite(context.sql, tenantId, payload.siteId);
  if (!site) {
    return errorJson("Valid siteId is required", 400);
  }

  const reportingYear = parseYear(payload.reportingYear);
  if (!reportingYear) {
    return errorJson("Valid reportingYear is required", 400);
  }

  const existingRows = await getMetricRowsForSiteYear({
    sql: context.sql,
    tenantId,
    siteId: site.id,
    reportingYear,
  });

  const existingMap = asMetricValueMap(existingRows);
  const strictWaterDischarge = getStrictWaterDischargeConfig();
  const definitionList = await readMetricDefinitions(context.sql, tenantId);
  const definitionByKey = new Map(definitionList.map((item) => [item.key, item]));
  const validation = validateAndNormalizeMetricEntries({
    entries: [payload],
    existingMap,
    strictWaterDischarge,
    definitionByKey,
  });

  if (validation.errors.length > 0) {
    return errorJson("Metric validation failed", 400, {
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  const entry = validation.normalizedEntries[0];
  const row = await upsertMetricRow({
    sql: context.sql,
    tenantId,
    companyId: site.company_id,
    siteId: site.id,
    reportingYear,
    metricKey: entry.metricKey,
    value: entry.value,
    unit: entry.unit,
  });

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "metric.upsert",
    entityType: "metric",
    entityId: row.id,
    payload: {
      siteId: site.id,
      companyId: site.company_id,
      reportingYear,
      metricKey: entry.metricKey,
      value: entry.value,
      unit: entry.unit,
      warnings: validation.warnings,
    },
  });

  return json(
    {
      metric: normalizeMetricRow(row, []),
      warnings: validation.warnings,
    },
    201,
  );
}
