import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureGhgSchema } from "../../../../_lib/db.js";
import {
  normalizeGhgDefinitionRow,
  normalizeGhgRecordRow,
  parseGhgRecordPayload,
  parseScope,
} from "../../../../_lib/ghg-api.js";
import {
  fetchEntityEvidenceMap,
  replaceEntityEvidence,
  resolveCompany,
  resolveSite,
} from "../../../../_lib/esg-api.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";

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

const loadDefinitions = async (sql, tenantId) => {
  const rows = await sql`
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
      AND is_active = TRUE
      AND deleted_at IS NULL
  `;

  const definitions = rows.map((row) => normalizeGhgDefinitionRow(row));
  return {
    rows,
    definitions,
    byId: new Map(definitions.map((item) => [item.id, item])),
  };
};

const parseFilters = (requestUrl) => {
  const url = new URL(requestUrl);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const siteId = cleanString(url.searchParams.get("siteId"));
  const reportingYear = parseYear(url.searchParams.get("year"));
  const month = parseMonth(url.searchParams.get("month"));
  const scope = parseScope(url.searchParams.get("scope"));

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
      scope: scope || null,
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

const readRecords = async ({ sql, tenantId, filters }) => {
  return sql`
    SELECT
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      activity_def_id,
      quantity,
      amount,
      currency,
      direct_tco2e,
      metadata,
      notes,
      created_at,
      updated_at
    FROM ghg_activity_records
    WHERE tenant_id = ${tenantId}
      AND company_id = ${filters.companyId}
      AND (${filters.siteId || ""} = '' OR site_id = ${filters.siteId})
      AND reporting_year = ${filters.reportingYear}
      AND (${filters.month ?? -1} = -1 OR month = ${filters.month})
    ORDER BY month ASC NULLS FIRST, created_at DESC
  `;
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

    const definitionData = await loadDefinitions(context.sql, tenantId);
    let rows = await readRecords({ sql: context.sql, tenantId, filters: parsed.filters });

    let records = rows.map((row) => ({
      ...row,
      definition: definitionData.byId.get(row.activity_def_id) || null,
    }));

    if (parsed.filters.scope) {
      records = records.filter((row) => row.definition?.scope === parsed.filters.scope);
    }

    const evidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "ghg_record",
      entityIds: records.map((row) => row.id),
    });

    return json({
      ok: true,
      definitions: definitionData.definitions,
      records: records.map((row) =>
        normalizeGhgRecordRow(row, row.definition, Array.isArray(evidenceMap.get(row.id)) ? evidenceMap.get(row.id) : []),
      ),
    });
  } catch (error) {
    return serverError(
      requestId,
      "ghg_records_fetch_failed",
      error instanceof Error ? error.message : "Unable to load GHG records",
    );
  }
}

const upsertRecord = async ({ sql, tenantId, inputRecord, companyId, siteId }) => {
  const rows = await sql`
    INSERT INTO ghg_activity_records (
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      activity_def_id,
      quantity,
      amount,
      currency,
      direct_tco2e,
      metadata,
      notes,
      updated_at
    )
    VALUES (
      ${inputRecord.id},
      ${tenantId},
      ${companyId},
      ${siteId},
      ${inputRecord.reportingYear},
      ${inputRecord.month},
      ${inputRecord.activityDefId},
      ${inputRecord.quantity},
      ${inputRecord.amount},
      ${inputRecord.currency},
      ${inputRecord.directTco2e},
      ${JSON.stringify(inputRecord.metadata || {})}::jsonb,
      ${inputRecord.notes},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      company_id = EXCLUDED.company_id,
      site_id = EXCLUDED.site_id,
      reporting_year = EXCLUDED.reporting_year,
      month = EXCLUDED.month,
      activity_def_id = EXCLUDED.activity_def_id,
      quantity = EXCLUDED.quantity,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      direct_tco2e = EXCLUDED.direct_tco2e,
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
      activity_def_id,
      quantity,
      amount,
      currency,
      direct_tco2e,
      metadata,
      notes,
      created_at,
      updated_at
  `;

  return rows[0];
};

const saveRecords = async ({ context, tenantId, payload, requestId, allowBulk }) => {
  const definitionData = await loadDefinitions(context.sql, tenantId);
  const inputs = allowBulk ? (Array.isArray(payload.records) ? payload.records : null) : [payload];
  if (!inputs) {
    return { response: badRequest("missing_records", "records[] is required") };
  }

  const savedRows = [];

  for (const item of inputs) {
    const parsed = parseGhgRecordPayload({ payload: item, activityDefinitionsById: definitionData.byId });
    if (parsed.error) {
      return { response: badRequest(parsed.error.code, parsed.error.message) };
    }

    const verified = await verifyCompanyAndSite({
      sql: context.sql,
      tenantId,
      companyId: parsed.record.companyId,
      siteId: parsed.record.siteId,
    });
    if (verified.error) {
      return { response: verified.error };
    }

    const row = await upsertRecord({
      sql: context.sql,
      tenantId,
      inputRecord: parsed.record,
      companyId: verified.company.id,
      siteId: verified.site?.id || null,
    });

    const evidenceIds = Array.isArray(item.evidenceIds)
      ? item.evidenceIds.map((evidenceId) => cleanString(evidenceId)).filter(Boolean)
      : [];

    await replaceEntityEvidence({
      sql: context.sql,
      tenantId,
      entityType: "ghg_record",
      entityId: row.id,
      evidenceIds,
    });

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "ghg.record.upsert",
      entityType: "ghg_record",
      entityId: row.id,
      payload: {
        companyId: row.company_id,
        siteId: row.site_id,
        reportingYear: row.reporting_year,
        month: row.month,
        activityDefId: row.activity_def_id,
      },
    });

    savedRows.push(row);
  }

  const evidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "ghg_record",
    entityIds: savedRows.map((row) => row.id),
  });

  return {
    response: json(
      {
        ok: true,
        records: savedRows.map((row) =>
          normalizeGhgRecordRow(row, definitionData.byId.get(row.activity_def_id), evidenceMap.get(row.id) || []),
        ),
      },
      allowBulk ? 200 : 201,
    ),
    requestId,
  };
};

export async function POST(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  try {
    await ensureGhgSchema();
    const payload = await parseJsonBody(request);
    const result = await saveRecords({
      context: scoped.context,
      tenantId,
      payload,
      requestId,
      allowBulk: false,
    });
    return result.response;
  } catch (error) {
    return serverError(
      requestId,
      "ghg_record_upsert_failed",
      error instanceof Error ? error.message : "Unable to save GHG record",
    );
  }
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const requestId = getRequestId(request);
  const scoped = await requireTenantContext(request, tenantId, "metrics");
  if (scoped.response) {
    return scoped.response;
  }

  try {
    await ensureGhgSchema();
    const payload = await parseJsonBody(request);
    const result = await saveRecords({
      context: scoped.context,
      tenantId,
      payload,
      requestId,
      allowBulk: true,
    });
    return result.response;
  } catch (error) {
    return serverError(
      requestId,
      "ghg_records_upsert_failed",
      error instanceof Error ? error.message : "Unable to save GHG records",
    );
  }
}
