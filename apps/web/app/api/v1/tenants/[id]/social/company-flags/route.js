import { writeAuditLog } from "../../../../_lib/audit.js";
import { resolveCompany } from "../../../../_lib/esg-api.js";
import { parseYear } from "../../../../_lib/esg-domain.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseBoolean = (value) => value === true || String(value).trim().toLowerCase() === "true";

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "social");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const reportingYear = parseYear(url.searchParams.get("year"));

  if (!companyId || !reportingYear) {
    return errorJson("companyId and year are required", 400);
  }

  const company = await resolveCompany(context.sql, tenantId, companyId);
  if (!company) {
    return errorJson("Valid companyId is required", 400);
  }

  const rows = await context.sql`
    SELECT tenant_id, company_id, reporting_year, gender_pay_gap_reported, scope3_screening_performed
    FROM company_year_flags
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND reporting_year = ${reportingYear}
    LIMIT 1
  `;

  const row = rows?.[0] || {
    tenant_id: tenantId,
    company_id: companyId,
    reporting_year: reportingYear,
    gender_pay_gap_reported: false,
    scope3_screening_performed: false,
  };

  return json({
    companyId,
    reportingYear,
    genderPayGapReported: Boolean(row.gender_pay_gap_reported),
    scope3ScreeningPerformed: Boolean(row.scope3_screening_performed),
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
  const companyId = cleanString(payload.companyId);
  const reportingYear = parseYear(payload.reportingYear);

  if (!companyId || !reportingYear) {
    return errorJson("companyId and reportingYear are required", 400);
  }

  const company = await resolveCompany(context.sql, tenantId, companyId);
  if (!company) {
    return errorJson("Valid companyId is required", 400);
  }

  const genderPayGapReported = parseBoolean(payload.genderPayGapReported);
  const scope3ScreeningPerformed = parseBoolean(payload.scope3ScreeningPerformed);

  const rows = await context.sql`
    INSERT INTO company_year_flags (
      tenant_id,
      company_id,
      reporting_year,
      gender_pay_gap_reported,
      scope3_screening_performed,
      updated_at
    )
    VALUES (
      ${tenantId},
      ${companyId},
      ${reportingYear},
      ${genderPayGapReported},
      ${scope3ScreeningPerformed},
      NOW()
    )
    ON CONFLICT (tenant_id, company_id, reporting_year) DO UPDATE
      SET
        gender_pay_gap_reported = EXCLUDED.gender_pay_gap_reported,
        scope3_screening_performed = EXCLUDED.scope3_screening_performed,
        updated_at = NOW()
    RETURNING tenant_id, company_id, reporting_year, gender_pay_gap_reported, scope3_screening_performed
  `;

  await writeAuditLog(context.sql, {
    tenantId,
    actorUserId: context.user.id,
    action: "social.company_flags.put",
    entityType: "company_year",
    entityId: `${companyId}:${reportingYear}`,
    payload: {
      companyId,
      reportingYear,
      genderPayGapReported,
      scope3ScreeningPerformed,
    },
  });

  const row = rows[0];
  return json({
    companyId: row.company_id,
    reportingYear: Number(row.reporting_year),
    genderPayGapReported: Boolean(row.gender_pay_gap_reported),
    scope3ScreeningPerformed: Boolean(row.scope3_screening_performed),
  });
}
