import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureSocialSchema } from "../../../../_lib/db.js";
import { fetchEntityEvidenceMap, normalizeLeaverRow, replaceEntityEvidence, resolveSite } from "../../../../_lib/esg-api.js";
import { parseYear, socialSectionEntityId } from "../../../../_lib/esg-domain.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
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

const getRequestId = (request) =>
  request.headers.get("x-vercel-id") || request.headers.get("x-request-id") || randomUUID();

const badRequest = (requestId, error, extra = {}) =>
  json(
    {
      ok: false,
      error,
      requestId,
      ...extra,
    },
    400,
  );

const serverError = (requestId) =>
  json(
    {
      ok: false,
      error: "social_leavers_failed",
      requestId,
    },
    500,
  );

const logFailure = ({ requestId, tenantId, method, error }) => {
  console.error(
    JSON.stringify({
      level: "error",
      scope: "social.leavers",
      requestId,
      tenantId: tenantId || null,
      method,
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : null,
    }),
  );
};

export async function GET(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant");
  }

  try {
    await ensureSocialSchema();

    const scoped = await requireTenantContext(request, tenantId, "social");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    const url = new URL(request.url);
    const siteId = cleanString(url.searchParams.get("siteId"));
    const reportingYear = parseYear(url.searchParams.get("year"));

    if (!siteId) {
      return badRequest(requestId, "missing_site");
    }
    if (!reportingYear) {
      return badRequest(requestId, "missing_year");
    }

    const site = await resolveSite(context.sql, tenantId, siteId);
    if (!site) {
      return badRequest(requestId, "invalid_site");
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
      ok: true,
      siteId,
      companyId: site.company_id,
      reportingYear,
      rows: rows.map((row) => normalizeLeaverRow(row, [])),
      sectionEvidenceIds: sectionEvidenceMap.get(sectionEntityId) || [],
      requestId,
    });
  } catch (error) {
    logFailure({ requestId, tenantId, method: "GET", error });
    return serverError(requestId);
  }
}

export async function PUT(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant");
  }

  try {
    await ensureSocialSchema();

    const scoped = await requireTenantContext(request, tenantId, "social");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    const payload = await parseJsonBody(request);

    if (!cleanString(payload.siteId)) {
      return badRequest(requestId, "missing_site");
    }

    const site = await resolveSite(context.sql, tenantId, payload.siteId);
    if (!site) {
      return badRequest(requestId, "invalid_site");
    }

    const reportingYear = parseYear(payload.reportingYear);
    if (!reportingYear) {
      return badRequest(requestId, "missing_reporting_year");
    }

    if (!Array.isArray(payload.rows)) {
      return badRequest(requestId, "missing_rows");
    }

    const normalizedRows = [];
    for (const row of payload.rows) {
      const parsed = parseRow(row);
      if (parsed.error) {
        return badRequest(requestId, "invalid_row", {
          message: parsed.error,
        });
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
      ok: true,
      siteId: site.id,
      companyId: site.company_id,
      reportingYear,
      rows: insertedRows.map((row) => normalizeLeaverRow(row, [])),
      sectionEvidenceIds: sectionEvidenceMap.get(sectionEntityId) || [],
      requestId,
    });
  } catch (error) {
    logFailure({ requestId, tenantId, method: "PUT", error });
    return serverError(requestId);
  }
}
