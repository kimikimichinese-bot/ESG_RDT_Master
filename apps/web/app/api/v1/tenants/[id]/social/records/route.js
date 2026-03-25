import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureSocialSchema, seedSocialMetricDefinitionsForTenant } from "../../../../_lib/db.js";
import { computeSocialCatalogMetrics } from "../../../../_lib/ghg-api.js";
import { fetchEntityEvidenceMap, replaceEntityEvidence, resolveCompany, resolveSite } from "../../../../_lib/esg-api.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody, parseJsonColumn } from "../../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getRequestId = (request) =>
  request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (code, message) => json({ ok: false, code, message }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const parseYear = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200) {
    return null;
  }
  return parsed;
};

const parseMonth = (value) => {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    return null;
  }
  return parsed;
};

const normalizeMetricDefinition = (row) => ({
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
});

const parseFilters = (requestUrl) => {
  const url = new URL(requestUrl);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));
  const reportingYear = parseYear(url.searchParams.get("year"));
  const month = parseMonth(url.searchParams.get("month"));

  if (!companyId) {
    return { error: { code: "missing_company_id", message: "companyId is required" } };
  }
  if (!UUID_PATTERN.test(companyId)) {
    return { error: { code: "invalid_company_id", message: "companyId must be a UUID" } };
  }
  if (siteId && !UUID_PATTERN.test(siteId)) {
    return { error: { code: "invalid_site_id", message: "siteId must be a UUID" } };
  }
  if (!reportingYear) {
    return { error: { code: "invalid_year", message: "year must be a valid integer year" } };
  }
  if (url.searchParams.has("month") && month == null) {
    return { error: { code: "invalid_month", message: "month must be between 1 and 12" } };
  }

  return {
    filters: {
      companyId,
      siteId: siteId || null,
      reportingYear,
      month,
    },
  };
};

const verifyCompanyAndSite = async ({ sql, tenantId, companyId, siteId }) => {
  const company = await resolveCompany(sql, tenantId, companyId);
  if (!company) {
    return { error: badRequest("invalid_company_id", "companyId is invalid for this tenant") };
  }

  if (!siteId) {
    return { company, site: null };
  }

  const site = await resolveSite(sql, tenantId, siteId);
  if (!site) {
    return { error: badRequest("invalid_site_id", "siteId is invalid for this tenant") };
  }
  if (site.company_id !== company.id) {
    return { error: badRequest("site_company_mismatch", "siteId does not belong to companyId") };
  }

  return { company, site };
};

const readMetricDefinitions = async (sql, tenantId) => {
  let rows = await sql`
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
    ORDER BY sort_order ASC, key ASC
  `;

  if (!rows || rows.length === 0) {
    await seedSocialMetricDefinitionsForTenant(sql, tenantId);
    rows = await sql`
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
      ORDER BY sort_order ASC, key ASC
    `;
  }

  return rows.map((row) => normalizeMetricDefinition(row));
};

const readWorkforceContext = async ({ sql, tenantId, filters }) => {
  const [workforceRows, leaverRows, managementRows] = await Promise.all([
    sql`
      SELECT site_id, month, contract_type, gender, headcount, hours_worked
      FROM workforce_monthly
      WHERE tenant_id = ${tenantId}
        AND company_id = ${filters.companyId}
        AND (${filters.siteId || ""} = '' OR site_id = ${filters.siteId})
        AND reporting_year = ${filters.reportingYear}
        AND (${filters.month ?? -1} = -1 OR month = ${filters.month})
    `,
    sql`
      SELECT site_id, month, gender, leavers
      FROM workforce_leavers_monthly
      WHERE tenant_id = ${tenantId}
        AND company_id = ${filters.companyId}
        AND (${filters.siteId || ""} = '' OR site_id = ${filters.siteId})
        AND reporting_year = ${filters.reportingYear}
        AND (${filters.month ?? -1} = -1 OR month = ${filters.month})
    `,
    sql`
      SELECT site_id, gender, headcount
      FROM management_headcount_yearly
      WHERE tenant_id = ${tenantId}
        AND company_id = ${filters.companyId}
        AND (${filters.siteId || ""} = '' OR site_id = ${filters.siteId})
        AND reporting_year = ${filters.reportingYear}
    `,
  ]);

  return { workforceRows, leaverRows, managementRows };
};

const normalizeRecordRow = (row, metricDefinition, evidenceIds = []) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  siteId: row.site_id || null,
  reportingYear: Number(row.reporting_year),
  month: row.month == null ? null : Number(row.month),
  metricDefId: row.metric_def_id,
  metricKey: metricDefinition?.key || null,
  value: row.value == null ? null : Number(row.value),
  metadata: parseJsonColumn(row.metadata) || {},
  notes: row.notes || null,
  evidenceIds,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

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

    const parsed = parseFilters(request.url);
    if (parsed.error) {
      return badRequest(parsed.error.code, parsed.error.message);
    }

    const verified = await verifyCompanyAndSite({
      sql: context.sql,
      tenantId,
      companyId: parsed.filters.companyId,
      siteId: parsed.filters.siteId,
    });
    if (verified.error) {
      return verified.error;
    }

    const metricDefinitions = await readMetricDefinitions(context.sql, tenantId);
    const metricById = new Map(metricDefinitions.map((item) => [item.id, item]));

    const rows = await context.sql`
      SELECT
        id,
        tenant_id,
        company_id,
        site_id,
        reporting_year,
        month,
        metric_def_id,
        value,
        metadata,
        notes,
        created_at,
        updated_at
      FROM social_records
      WHERE tenant_id = ${tenantId}
        AND company_id = ${parsed.filters.companyId}
        AND (${parsed.filters.siteId || ""} = '' OR site_id = ${parsed.filters.siteId})
        AND reporting_year = ${parsed.filters.reportingYear}
        AND (${parsed.filters.month ?? -1} = -1 OR month = ${parsed.filters.month})
      ORDER BY month ASC NULLS FIRST, updated_at DESC
    `;

    const evidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "social_record",
      entityIds: rows.map((row) => row.id),
    });

    const workforceContext = await readWorkforceContext({
      sql: context.sql,
      tenantId,
      filters: parsed.filters,
    });

    const computed = computeSocialCatalogMetrics({
      metricDefinitions,
      socialRecords: rows.map((row) => ({ ...row, metric_key: metricById.get(row.metric_def_id)?.key })),
      workforceRows: workforceContext.workforceRows,
      leaverRows: workforceContext.leaverRows,
      managementRows: workforceContext.managementRows,
    });

    return json({
      ok: true,
      metrics: metricDefinitions,
      records: rows.map((row) =>
        normalizeRecordRow(row, metricById.get(row.metric_def_id), Array.isArray(evidenceMap.get(row.id)) ? evidenceMap.get(row.id) : []),
      ),
      computed,
    });
  } catch (error) {
    return serverError(
      requestId,
      "social_records_fetch_failed",
      error instanceof Error ? error.message : "Unable to load social records",
    );
  }
}

const parseRecordInput = ({ payload, metricByKey, filters }) => {
  const metricKey = cleanString(payload.metricKey || payload.key).toLowerCase();
  if (!metricKey) {
    return { error: { code: "missing_metric_key", message: "metricKey is required" } };
  }

  const metricDefinition = metricByKey.get(metricKey);
  if (!metricDefinition) {
    return { error: { code: "invalid_metric_key", message: `Unknown social metric key: ${metricKey}` } };
  }
  if (metricDefinition.method !== "manual") {
    return {
      error: {
        code: "metric_not_manual",
        message: `Metric ${metricKey} is computed and cannot be manually set`,
      },
    };
  }

  const value = Number(payload.value);
  if (!Number.isFinite(value)) {
    return { error: { code: "invalid_value", message: "value must be numeric" } };
  }

  const month = payload.month == null || payload.month === "" ? filters.month : parseMonth(payload.month);
  if (payload.month != null && payload.month !== "" && month == null) {
    return { error: { code: "invalid_month", message: "month must be between 1 and 12 when provided" } };
  }

  return {
    record: {
      id: cleanString(payload.id) || randomUUID(),
      companyId: filters.companyId,
      siteId: payload.siteId == null ? filters.siteId : cleanString(payload.siteId) || null,
      reportingYear: filters.reportingYear,
      month,
      metricDefId: metricDefinition.id,
      value,
      metadata: payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {},
      notes: cleanString(payload.notes) || null,
      evidenceIds: Array.isArray(payload.evidenceIds)
        ? payload.evidenceIds.map((item) => cleanString(item)).filter(Boolean)
        : [],
    },
  };
};

export async function PUT(request, { params }) {
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
    const records = Array.isArray(payload.records) ? payload.records : null;
    if (!records || records.length === 0) {
      return badRequest("missing_records", "records[] is required");
    }

    const filters = {
      companyId: cleanString(payload.companyId),
      siteId: cleanString(payload.siteId) || null,
      reportingYear: parseYear(payload.reportingYear),
      month: parseMonth(payload.month),
    };

    if (!filters.companyId) {
      return badRequest("missing_company_id", "companyId is required");
    }
    if (!UUID_PATTERN.test(filters.companyId)) {
      return badRequest("invalid_company_id", "companyId must be a UUID");
    }
    if (payload.siteId && !UUID_PATTERN.test(payload.siteId)) {
      return badRequest("invalid_site_id", "siteId must be a UUID");
    }
    if (!filters.reportingYear) {
      return badRequest("invalid_reporting_year", "reportingYear must be a valid year");
    }
    if (payload.month != null && payload.month !== "" && filters.month == null) {
      return badRequest("invalid_month", "month must be between 1 and 12");
    }

    const verified = await verifyCompanyAndSite({
      sql: context.sql,
      tenantId,
      companyId: filters.companyId,
      siteId: filters.siteId,
    });
    if (verified.error) {
      return verified.error;
    }

    const metricDefinitions = await readMetricDefinitions(context.sql, tenantId);
    const metricByKey = new Map(metricDefinitions.map((item) => [item.key, item]));

    const upsertedRows = [];

    for (const inputRow of records) {
      const parsedRecord = parseRecordInput({ payload: inputRow, metricByKey, filters });
      if (parsedRecord.error) {
        return badRequest(parsedRecord.error.code, parsedRecord.error.message);
      }

      const row = parsedRecord.record;
      if (row.siteId && row.siteId !== filters.siteId) {
        const rowSiteCheck = await verifyCompanyAndSite({
          sql: context.sql,
          tenantId,
          companyId: filters.companyId,
          siteId: row.siteId,
        });
        if (rowSiteCheck.error) {
          return rowSiteCheck.error;
        }
      }

      const saved = await context.sql`
        INSERT INTO social_records (
          id,
          tenant_id,
          company_id,
          site_id,
          reporting_year,
          month,
          metric_def_id,
          value,
          metadata,
          notes,
          updated_at
        )
        VALUES (
          ${row.id},
          ${tenantId},
          ${row.companyId},
          ${row.siteId},
          ${row.reportingYear},
          ${row.month},
          ${row.metricDefId},
          ${row.value},
          ${JSON.stringify(row.metadata)}::jsonb,
          ${row.notes},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          company_id = EXCLUDED.company_id,
          site_id = EXCLUDED.site_id,
          reporting_year = EXCLUDED.reporting_year,
          month = EXCLUDED.month,
          metric_def_id = EXCLUDED.metric_def_id,
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING
          id,
          tenant_id,
          company_id,
          site_id,
          reporting_year,
          month,
          metric_def_id,
          value,
          metadata,
          notes,
          created_at,
          updated_at
      `;

      await replaceEntityEvidence({
        sql: context.sql,
        tenantId,
        entityType: "social_record",
        entityId: saved[0].id,
        evidenceIds: row.evidenceIds,
      });

      await writeAuditLog(context.sql, {
        tenantId,
        actorUserId: context.user.id,
        action: "social.record.upsert",
        entityType: "social_record",
        entityId: saved[0].id,
        payload: {
          companyId: saved[0].company_id,
          siteId: saved[0].site_id,
          reportingYear: saved[0].reporting_year,
          month: saved[0].month,
          metricDefId: saved[0].metric_def_id,
          value: saved[0].value,
        },
      });

      upsertedRows.push(saved[0]);
    }

    const metricById = new Map(metricDefinitions.map((item) => [item.id, item]));
    const evidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "social_record",
      entityIds: upsertedRows.map((row) => row.id),
    });

    return json({
      ok: true,
      records: upsertedRows.map((row) =>
        normalizeRecordRow(row, metricById.get(row.metric_def_id), Array.isArray(evidenceMap.get(row.id)) ? evidenceMap.get(row.id) : []),
      ),
    });
  } catch (error) {
    return serverError(
      requestId,
      "social_records_upsert_failed",
      error instanceof Error ? error.message : "Unable to save social records",
    );
  }
}
