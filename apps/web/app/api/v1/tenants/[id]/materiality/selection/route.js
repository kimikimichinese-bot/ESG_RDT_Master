import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../../_lib/audit.js";
import { ensureMaterialitySchema } from "../../../../_lib/db.js";
import {
  ensureMaterialityDefaults,
  parseReportQuery,
  parseSelectionPayload,
} from "../../../../_lib/materiality-api.js";
import { json, parseJsonBody } from "../../../../_lib/http.js";
import { requireTenantContext } from "../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getRequestId = (request) => request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || randomUUID();

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

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

const loadSelection = async ({ sql, tenantId, companyId, reportingYear }) => {
  const rows = await sql`
    SELECT topic_id
    FROM materiality_selected_topics
    WHERE tenant_id = ${tenantId}
      AND company_id = ${companyId}
      AND reporting_year = ${reportingYear}
    ORDER BY created_at ASC, topic_id ASC
  `;

  return rows.map((row) => row.topic_id);
};

const parseSelectionQuery = (request) => {
  const parsed = parseReportQuery(request);
  if (parsed.error) {
    return parsed;
  }

  return {
    companyId: parsed.companyId,
    reportingYear: parsed.reportingYear,
  };
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

    const { context } = scoped;
    await ensureMaterialityDefaults({ sql: context.sql, tenantId });

    const parsed = parseSelectionQuery(request);
    if (parsed.error) {
      return badRequest(requestId, "invalid_query", parsed.error);
    }

    const validCompanyId = await resolveCompany(context.sql, tenantId, parsed.companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const topicIds = await loadSelection({
      sql: context.sql,
      tenantId,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
    });

    return json({
      ok: true,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
      topicIds,
    });
  } catch (error) {
    return serverError(
      requestId,
      "materiality_selection_fetch_failed",
      error instanceof Error ? error.message : "Unable to load materiality selection",
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

    const { context } = scoped;
    await ensureMaterialityDefaults({ sql: context.sql, tenantId });

    const parsed = parseSelectionQuery(request);
    if (parsed.error) {
      return badRequest(requestId, "invalid_query", parsed.error);
    }

    const validCompanyId = await resolveCompany(context.sql, tenantId, parsed.companyId);
    if (!validCompanyId) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const payload = await parseJsonBody(request);
    const parsedSelection = parseSelectionPayload(payload);
    if (parsedSelection.error) {
      return badRequest(requestId, "invalid_payload", parsedSelection.error);
    }

    if (parsedSelection.topicIds.length > 0) {
      const topicRows = await context.sql`
        SELECT id
        FROM materiality_topics
        WHERE tenant_id = ${tenantId}
          AND id = ANY(${parsedSelection.topicIds})
      `;

      const validTopicIds = new Set(topicRows.map((row) => row.id));
      const invalidTopicId = parsedSelection.topicIds.find((topicId) => !validTopicIds.has(topicId));
      if (invalidTopicId) {
        return badRequest(requestId, "invalid_topic_id", `Invalid topicId for this tenant: ${invalidTopicId}`);
      }
    }

    await context.sql`
      DELETE FROM materiality_selected_topics
      WHERE tenant_id = ${tenantId}
        AND company_id = ${validCompanyId}
        AND reporting_year = ${parsed.reportingYear}
    `;

    for (const topicId of parsedSelection.topicIds) {
      await context.sql`
        INSERT INTO materiality_selected_topics (
          tenant_id,
          company_id,
          reporting_year,
          topic_id,
          created_at
        )
        VALUES (${tenantId}, ${validCompanyId}, ${parsed.reportingYear}, ${topicId}, NOW())
        ON CONFLICT (tenant_id, company_id, reporting_year, topic_id) DO NOTHING
      `;
    }

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "materiality.selection.replace",
      entityType: "materiality_selection",
      entityId: `${validCompanyId}:${parsed.reportingYear}`,
      payload: {
        topicIds: parsedSelection.topicIds,
      },
    });

    const topicIds = await loadSelection({
      sql: context.sql,
      tenantId,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
    });

    return json({
      ok: true,
      companyId: validCompanyId,
      reportingYear: parsed.reportingYear,
      topicIds,
    });
  } catch (error) {
    return serverError(
      requestId,
      "materiality_selection_update_failed",
      error instanceof Error ? error.message : "Unable to update materiality selection",
    );
  }
}
