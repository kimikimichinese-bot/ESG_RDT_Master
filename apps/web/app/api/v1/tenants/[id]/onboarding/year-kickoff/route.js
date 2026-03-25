import { randomUUID } from "node:crypto";
import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import { cleanString, json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const YEAR_MIN = 2000;
const YEAR_MAX = 2200;
const STEP_VALUES = new Set(["define", "kpi", "evidence", "review", "export"]);

const getRequestId = (request) => request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message, extra = {}) => json({ ok: false, code, message, requestId, ...extra }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseYear = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < YEAR_MIN || parsed > YEAR_MAX) {
    return null;
  }
  return parsed;
};

const parseQuery = (request) => {
  const url = new URL(request.url);
  const companyId = cleanString(url.searchParams.get("companyId"));
  const reportingYear = parseYear(url.searchParams.get("year"));
  if (!companyId) {
    return { error: "companyId is required" };
  }
  if (!UUID_RE.test(companyId)) {
    return { error: "companyId must be a valid UUID" };
  }
  if (!reportingYear) {
    return { error: "year must be a valid integer between 2000 and 2200" };
  }
  return { companyId, reportingYear };
};

const parsePayload = (payload) => {
  const companyId = cleanString(payload?.companyId);
  const reportingYear = parseYear(payload?.reportingYear);

  if (!companyId) {
    return { error: "companyId is required" };
  }
  if (!UUID_RE.test(companyId)) {
    return { error: "companyId must be a valid UUID" };
  }
  if (!reportingYear) {
    return { error: "reportingYear must be a valid integer between 2000 and 2200" };
  }

  const next = {
    companyId,
    reportingYear,
  };

  if (typeof payload?.kickoffDismissed === "boolean") {
    next.kickoffDismissed = payload.kickoffDismissed;
  }
  if (typeof payload?.definitionCompleted === "boolean") {
    next.definitionCompleted = payload.definitionCompleted;
  }
  if (payload?.lastStep != null) {
    const lastStep = cleanString(payload.lastStep).toLowerCase();
    if (!STEP_VALUES.has(lastStep)) {
      return { error: "lastStep must be one of: define, kpi, evidence, review, export" };
    }
    next.lastStep = lastStep;
  }

  return { value: next };
};

const resolveCompany = async (sql, tenantId, companyId) => {
  const rows = await sql`
    SELECT id
    FROM companies
    WHERE tenant_id = ${tenantId}
      AND id = ${companyId}
    LIMIT 1
  `;
  return rows?.[0]?.id || null;
};

const toState = (row, companyId, reportingYear) => ({
  companyId,
  reportingYear,
  kickoffDismissed: row ? row.kickoff_dismissed === true : false,
  definitionCompleted: row ? row.definition_completed === true : false,
  lastStep: row?.last_step || "define",
  updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
});

const loadState = async (sql, tenantId, companyId, reportingYear) => {
  const rows = await sql`
    SELECT kickoff_dismissed, definition_completed, last_step, updated_at
    FROM materiality_year_kickoff_state
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND reporting_year = ${reportingYear}
    LIMIT 1
  `;

  return rows?.[0] || null;
};

export async function GET(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant", "tenant id is required");
  }

  try {
    await ensureMaterialitySchema();
    const scoped = await requireTenantContext(request, tenantId, "materiality");
    if (scoped.response) {
      return scoped.response;
    }

    const parsed = parseQuery(request);
    if (parsed.error) {
      return badRequest(requestId, "invalid_query", parsed.error);
    }

    const validCompanyId = await resolveCompany(scoped.context.sql, tenantId, parsed.companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const row = await loadState(scoped.context.sql, tenantId, validCompanyId, parsed.reportingYear);

    return json({
      ok: true,
      state: toState(row, validCompanyId, parsed.reportingYear),
      requestId,
    });
  } catch (error) {
    return serverError(
      requestId,
      "year_kickoff_state_fetch_failed",
      error instanceof Error ? error.message : "Unable to load year kickoff state",
    );
  }
}

export async function PUT(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant", "tenant id is required");
  }

  try {
    await ensureMaterialitySchema();
    const scoped = await requireTenantContext(request, tenantId, "materiality");
    if (scoped.response) {
      return scoped.response;
    }

    const payload = await parseJsonBody(request);
    const parsed = parsePayload(payload);
    if (parsed.error) {
      return badRequest(requestId, "invalid_payload", parsed.error);
    }

    const input = parsed.value;
    const validCompanyId = await resolveCompany(scoped.context.sql, tenantId, input.companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const current = await loadState(scoped.context.sql, tenantId, validCompanyId, input.reportingYear);
    const nextState = {
      kickoffDismissed:
        typeof input.kickoffDismissed === "boolean"
          ? input.kickoffDismissed
          : current
            ? current.kickoff_dismissed === true
            : false,
      definitionCompleted:
        typeof input.definitionCompleted === "boolean"
          ? input.definitionCompleted
          : current
            ? current.definition_completed === true
            : false,
      lastStep: input.lastStep || current?.last_step || "define",
    };

    await scoped.context.sql`
      INSERT INTO materiality_year_kickoff_state (
        tenant_id,
        company_id,
        reporting_year,
        kickoff_dismissed,
        definition_completed,
        last_step,
        updated_at
      )
      VALUES (
        ${tenantId},
        ${validCompanyId},
        ${input.reportingYear},
        ${nextState.kickoffDismissed},
        ${nextState.definitionCompleted},
        ${nextState.lastStep},
        NOW()
      )
      ON CONFLICT (tenant_id, company_id, reporting_year)
      DO UPDATE SET
        kickoff_dismissed = EXCLUDED.kickoff_dismissed,
        definition_completed = EXCLUDED.definition_completed,
        last_step = EXCLUDED.last_step,
        updated_at = NOW()
    `;

    const row = await loadState(scoped.context.sql, tenantId, validCompanyId, input.reportingYear);

    return json({
      ok: true,
      state: toState(row, validCompanyId, input.reportingYear),
      requestId,
    });
  } catch (error) {
    return serverError(
      requestId,
      "year_kickoff_state_update_failed",
      error instanceof Error ? error.message : "Unable to update year kickoff state",
    );
  }
}
