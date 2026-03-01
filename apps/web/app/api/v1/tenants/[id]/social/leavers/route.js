import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { fetchEntityEvidenceMap, normalizeLeaverRow, replaceEntityEvidence, resolveSite } from "../../../../_lib/esg-api.js";
import { parseYear, socialSectionEntityId } from "../../../../_lib/esg-domain.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseRow = (row) => {
  const month = Number.parseInt(String(row.month || "").trim(), 10);
  const gender = cleanString(row.gender).toUpperCase();
  const leavers = Number(row.leavers);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "month must be between 1 and 12" };
  }
  if (!["M", "F", "D"].includes(gender)) {
    return { error: "gender must be M/F/D" };
  }
  if (!Number.isInteger(leavers) || leavers < 0) {
    return { error: "leavers must be a non-negative integer" };
  }

  return {
    month,
    gender,
    leavers,
  };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "social");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const url = new URL(request.url);
  const siteId = cleanString(url.searchParams.get("siteId"));
  const reportingYear = parseYear(url.searchParams.get("year"));

  if (!siteId || !reportingYear) {
    return errorJson("siteId and year are required", 400);
  }

  const site = await resolveSite(context.sql, tenantId, siteId);
  if (!site) {
    return errorJson("Valid siteId is required", 400);
  }

  const rows = await context.sql`
    SELECT
      id,
      tenant_id,
      company_id,
      site_id,
      reporting_year,
      month,
      gender,
      leavers,
      created_at,
      updated_at
    FROM workforce_leavers_monthly
    WHERE tenant_id = ${tenantId}
      AND site_id = ${siteId}
      AND reporting_year = ${reportingYear}
    ORDER BY month ASC, gender ASC
  `;

  const sectionEntityId = socialSectionEntityId({
    tenantId,
    siteId,
    reportingYear,
    section: "leavers",
  });

  const sectionEvidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "leavers",
    entityIds: [sectionEntityId],
  });

  return json({
    siteId,
    companyId: site.company_id,
    reportingYear,
    rows: rows.map((row) => normalizeLeaverRow(row, [])),
    sectionEvidenceIds: sectionEvidenceMap.get(sectionEntityId) || [],
  });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "social");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const site = await resolveSite(context.sql, tenantId, payload.siteId);
  if (!site) {
    return errorJson("Valid siteId is required", 400);
  }

  const reportingYear = parseYear(payload.reportingYear);
  if (!reportingYear) {
    return errorJson("Valid reportingYear is required", 400);
  }

  if (!Array.isArray(payload.rows)) {
    return errorJson("rows[] is required", 400);
  }

  const normalizedRows = [];
  for (const row of payload.rows) {
    const parsed = parseRow(row);
    if (parsed.error) {
      return errorJson(parsed.error, 400);
    }
    normalizedRows.push(parsed);
  }

  await context.sql`
    DELETE FROM workforce_leavers_monthly
    WHERE tenant_id = ${tenantId}
      AND site_id = ${site.id}
      AND reporting_year = ${reportingYear}
  `;

  const insertedRows = [];
  for (const row of normalizedRows) {
    const rows = await context.sql`
      INSERT INTO workforce_leavers_monthly (
        id,
        tenant_id,
        company_id,
        site_id,
        reporting_year,
        month,
        gender,
        leavers
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${site.company_id},
        ${site.id},
        ${reportingYear},
        ${row.month},
        ${row.gender},
        ${row.leavers}
      )
      RETURNING
        id,
        tenant_id,
        company_id,
        site_id,
        reporting_year,
        month,
        gender,
        leavers,
        created_at,
        updated_at
    `;
    insertedRows.push(rows[0]);
  }

  const sectionEntityId = socialSectionEntityId({
    tenantId,
    siteId: site.id,
    reportingYear,
    section: "leavers",
  });

  await replaceEntityEvidence({
    sql: context.sql,
    tenantId,
    entityType: "leavers",
    entityId: sectionEntityId,
    evidenceIds: Array.isArray(payload.sectionEvidenceIds) ? payload.sectionEvidenceIds : [],
  });

  const sectionEvidenceMap = await fetchEntityEvidenceMap({
    sql: context.sql,
    tenantId,
    entityType: "leavers",
    entityIds: [sectionEntityId],
  });

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "social.leavers.bulk.put",
    entityType: "leavers",
    entityId: sectionEntityId,
    payload: {
      siteId: site.id,
      companyId: site.company_id,
      reportingYear,
      rowCount: insertedRows.length,
      sectionEvidenceIds: sectionEvidenceMap.get(sectionEntityId) || [],
    },
  });

  return json({
    siteId: site.id,
    companyId: site.company_id,
    reportingYear,
    rows: insertedRows.map((row) => normalizeLeaverRow(row, [])),
    sectionEvidenceIds: sectionEvidenceMap.get(sectionEntityId) || [],
  });
}
