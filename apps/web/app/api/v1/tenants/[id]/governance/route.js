import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../_lib/audit.js";
import { ensureGovernanceSchema } from "../../../_lib/db.js";
import { fetchEntityEvidenceMap, replaceEntityEvidence, resolveCompany } from "../../../_lib/esg-api.js";
import { parseYear } from "../../../_lib/esg-domain.js";
import { cleanString, json, parseJsonBody } from "../../../_lib/http.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const POLICY_KEYS = [
  "anti_corruption",
  "whistleblowing",
  "data_privacy",
  "supplier_code",
  "grievance_mechanism",
];
const POLICY_STATUS_SET = new Set(["yes", "no", "in_progress"]);

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
      error: "governance_failed",
      requestId,
    },
    500,
  );

const logFailure = ({ requestId, tenantId, method, error }) => {
  console.error(
    JSON.stringify({
      level: "error",
      scope: "governance.route",
      requestId,
      tenantId: tenantId || null,
      method,
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : null,
    }),
  );
};

const toBoolean = (value) => value === true || String(value).trim().toLowerCase() === "true";

const toNonNegativeInt = (value, fallback = 0) => {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const toNonNegativeNumber = (value, fallback = 0) => {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const policyStatus = (value) => {
  const normalized = cleanString(value).toLowerCase();
  return POLICY_STATUS_SET.has(normalized) ? normalized : null;
};

const normalizeGovernance = (row, evidenceIds = [], fallback = {}) => ({
  id: row?.id || null,
  tenantId: row?.tenant_id || fallback.tenantId || null,
  companyId: row?.company_id || fallback.companyId || null,
  reportingYear: Number(row?.reporting_year || fallback.reportingYear || 0),
  boardTotal: Number(row?.board_total ?? 0),
  boardWomen: Number(row?.board_women ?? 0),
  boardIndependent: Number(row?.board_independent ?? 0),
  boardMeetings: Number(row?.board_meetings ?? 0),
  antiCorruptionPolicy: Boolean(row?.anti_corruption_policy),
  whistleblowingChannel: Boolean(row?.whistleblowing_channel),
  dataPrivacyPolicy: Boolean(row?.data_privacy_policy),
  supplierCodeOfConduct: Boolean(row?.supplier_code_of_conduct),
  gdprTraining: Boolean(row?.gdpr_training),
  dataBreachesCount: Number(row?.data_breaches_count ?? 0),
  corruptionIncidentsCount: Number(row?.corruption_incidents_count ?? 0),
  finesAmountEur: Number(row?.fines_amount_eur ?? 0),
  notes: row?.notes || "",
  evidenceIds,
});

const normalizePolicy = (row, evidenceIds = [], fallback = {}) => ({
  id: row?.id || null,
  tenantId: row?.tenant_id || fallback.tenantId || null,
  companyId: row?.company_id || fallback.companyId || null,
  reportingYear: Number(row?.reporting_year || fallback.reportingYear || 0),
  policyKey: row?.policy_key || fallback.policyKey || "",
  status: row?.status || "no",
  notes: row?.notes || "",
  evidenceIds,
});

const safePct = (value, total) => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Number(((value / total) * 100).toFixed(2));
};

const computeCompleteness = ({ governanceRow, policyRows }) => {
  if (!governanceRow) {
    return 0;
  }

  const boardTotal = Number(governanceRow.board_total ?? 0);
  const boardWomen = Number(governanceRow.board_women ?? 0);
  const boardIndependent = Number(governanceRow.board_independent ?? 0);

  const scalarChecks = [
    boardTotal > 0,
    boardTotal > 0 && boardWomen >= 0 && boardWomen <= boardTotal,
    boardTotal > 0 && boardIndependent >= 0 && boardIndependent <= boardTotal,
    Number(governanceRow.board_meetings ?? 0) > 0,
    Number(governanceRow.data_breaches_count ?? 0) >= 0,
    Number(governanceRow.corruption_incidents_count ?? 0) >= 0,
    Number(governanceRow.fines_amount_eur ?? 0) >= 0,
    typeof governanceRow.anti_corruption_policy === "boolean",
    typeof governanceRow.whistleblowing_channel === "boolean",
    typeof governanceRow.data_privacy_policy === "boolean",
    typeof governanceRow.supplier_code_of_conduct === "boolean",
    typeof governanceRow.gdpr_training === "boolean",
  ];

  const scalarScore = (scalarChecks.filter(Boolean).length / scalarChecks.length) * 100;

  const keyedPolicies = (policyRows || []).filter((row) => POLICY_KEYS.includes(row.policy_key));
  const policyScore = POLICY_KEYS.length > 0 ? (keyedPolicies.length / POLICY_KEYS.length) * 100 : 100;

  return Number((((scalarScore + policyScore) / 2) || 0).toFixed(2));
};

const compute = ({ governanceRow, policyRows }) => ({
  women_on_board_pct: safePct(Number(governanceRow?.board_women ?? 0), Number(governanceRow?.board_total ?? 0)),
  independent_pct: safePct(Number(governanceRow?.board_independent ?? 0), Number(governanceRow?.board_total ?? 0)),
  governance_completeness: computeCompleteness({ governanceRow, policyRows }),
});

const toGovernanceInputs = (payload = {}) => {
  const governance = payload?.governance && typeof payload.governance === "object" ? payload.governance : payload;

  const boardTotal = toNonNegativeInt(governance.boardTotal, 0);
  const boardWomen = toNonNegativeInt(governance.boardWomen, 0);
  const boardIndependent = toNonNegativeInt(governance.boardIndependent, 0);
  const boardMeetings = toNonNegativeInt(governance.boardMeetings, 0);
  const dataBreachesCount = toNonNegativeInt(governance.dataBreachesCount, 0);
  const corruptionIncidentsCount = toNonNegativeInt(governance.corruptionIncidentsCount, 0);
  const finesAmountEur = toNonNegativeNumber(governance.finesAmountEur, 0);

  if (
    boardTotal == null ||
    boardWomen == null ||
    boardIndependent == null ||
    boardMeetings == null ||
    dataBreachesCount == null ||
    corruptionIncidentsCount == null ||
    finesAmountEur == null
  ) {
    return { error: "invalid_governance_payload" };
  }

  if (boardWomen > boardTotal) {
    return { error: "invalid_board_women" };
  }
  if (boardIndependent > boardTotal) {
    return { error: "invalid_board_independent" };
  }

  return {
    values: {
      boardTotal,
      boardWomen,
      boardIndependent,
      boardMeetings,
      antiCorruptionPolicy: toBoolean(governance.antiCorruptionPolicy),
      whistleblowingChannel: toBoolean(governance.whistleblowingChannel),
      dataPrivacyPolicy: toBoolean(governance.dataPrivacyPolicy),
      supplierCodeOfConduct: toBoolean(governance.supplierCodeOfConduct),
      gdprTraining: toBoolean(governance.gdprTraining),
      dataBreachesCount,
      corruptionIncidentsCount,
      finesAmountEur,
      notes: cleanString(governance.notes) || null,
    },
  };
};

const normalizePolicyPayload = (policies, requestId) => {
  if (!Array.isArray(policies)) {
    return { ok: true, policies: [] };
  }

  const seen = new Set();
  const normalized = [];

  for (const row of policies) {
    const policyKey = cleanString(row.policyKey || row.policy_key).toLowerCase();
    if (!POLICY_KEYS.includes(policyKey)) {
      return { ok: false, response: badRequest(requestId, "invalid_policy_key", { policyKey }) };
    }
    if (seen.has(policyKey)) {
      return { ok: false, response: badRequest(requestId, "duplicate_policy_key", { policyKey }) };
    }
    seen.add(policyKey);

    const status = policyStatus(row.status);
    if (!status) {
      return { ok: false, response: badRequest(requestId, "invalid_policy_status", { policyKey }) };
    }

    normalized.push({
      policyKey,
      status,
      notes: cleanString(row.notes) || null,
      evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds : [],
    });
  }

  return { ok: true, policies: normalized };
};

const withPolicyDefaults = ({ policyRows, tenantId, companyId, reportingYear, evidenceMap }) => {
  const byKey = new Map((policyRows || []).map((row) => [row.policy_key, row]));
  return POLICY_KEYS.map((policyKey) => {
    const row = byKey.get(policyKey) || null;
    return normalizePolicy(row, row?.id ? evidenceMap.get(row.id) || [] : [], {
      tenantId,
      companyId,
      reportingYear,
      policyKey,
    });
  });
};

export async function GET(request, { params }) {
  const requestId = getRequestId(request);
  const tenantId = params?.id;

  if (!tenantId) {
    return badRequest(requestId, "missing_tenant");
  }

  try {
    await ensureGovernanceSchema();

    const scoped = await requireTenantContext(request, tenantId, "governance");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    const url = new URL(request.url);
    const companyId = cleanString(url.searchParams.get("companyId"));
    const reportingYear = parseYear(url.searchParams.get("year"));

    if (!companyId) {
      return badRequest(requestId, "missing_company");
    }
    if (!reportingYear) {
      return badRequest(requestId, "missing_year");
    }

    const company = await resolveCompany(context.sql, tenantId, companyId);
    if (!company) {
      return badRequest(requestId, "invalid_company");
    }

    const governanceRows = await context.sql`
      SELECT
        id,
        tenant_id,
        company_id,
        reporting_year,
        board_total,
        board_women,
        board_independent,
        board_meetings,
        anti_corruption_policy,
        whistleblowing_channel,
        data_privacy_policy,
        supplier_code_of_conduct,
        gdpr_training,
        data_breaches_count,
        corruption_incidents_count,
        fines_amount_eur,
        notes,
        created_at,
        updated_at
      FROM governance_yearly
      WHERE tenant_id = ${tenantId}
        AND company_id = ${companyId}
        AND reporting_year = ${reportingYear}
      LIMIT 1
    `;
    const governanceRow = governanceRows?.[0] || null;

    const policyRows = await context.sql`
      SELECT
        id,
        tenant_id,
        company_id,
        reporting_year,
        policy_key,
        status,
        notes,
        created_at,
        updated_at
      FROM governance_policies
      WHERE tenant_id = ${tenantId}
        AND company_id = ${companyId}
        AND reporting_year = ${reportingYear}
      ORDER BY policy_key ASC
    `;

    const governanceEvidenceMap = governanceRow
      ? await fetchEntityEvidenceMap({
          sql: context.sql,
          tenantId,
          entityType: "governance_yearly",
          entityIds: [governanceRow.id],
        })
      : new Map();

    const policyEvidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "governance_policy",
      entityIds: policyRows.map((row) => row.id),
    });

    const governance = normalizeGovernance(governanceRow, governanceRow ? governanceEvidenceMap.get(governanceRow.id) || [] : [], {
      tenantId,
      companyId,
      reportingYear,
    });

    const policies = withPolicyDefaults({
      policyRows,
      tenantId,
      companyId,
      reportingYear,
      evidenceMap: policyEvidenceMap,
    });

    return json({
      ok: true,
      governance,
      policies,
      computed: compute({ governanceRow, policyRows }),
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
    await ensureGovernanceSchema();

    const scoped = await requireTenantContext(request, tenantId, "governance");
    if (scoped.response) {
      return scoped.response;
    }

    const { context } = scoped;
    const payload = await parseJsonBody(request);
    const companyId = cleanString(payload.companyId);
    const reportingYear = parseYear(payload.reportingYear);

    if (!companyId) {
      return badRequest(requestId, "missing_company");
    }
    if (!reportingYear) {
      return badRequest(requestId, "missing_reporting_year");
    }

    const company = await resolveCompany(context.sql, tenantId, companyId);
    if (!company) {
      return badRequest(requestId, "invalid_company");
    }

    const governanceInputs = toGovernanceInputs(payload);
    if (governanceInputs.error) {
      return badRequest(requestId, governanceInputs.error);
    }

    const policyParse = normalizePolicyPayload(payload.policies, requestId);
    if (!policyParse.ok) {
      return policyParse.response;
    }

    const governanceRows = await context.sql`
      INSERT INTO governance_yearly (
        id,
        tenant_id,
        company_id,
        reporting_year,
        board_total,
        board_women,
        board_independent,
        board_meetings,
        anti_corruption_policy,
        whistleblowing_channel,
        data_privacy_policy,
        supplier_code_of_conduct,
        gdpr_training,
        data_breaches_count,
        corruption_incidents_count,
        fines_amount_eur,
        notes,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${tenantId},
        ${companyId},
        ${reportingYear},
        ${governanceInputs.values.boardTotal},
        ${governanceInputs.values.boardWomen},
        ${governanceInputs.values.boardIndependent},
        ${governanceInputs.values.boardMeetings},
        ${governanceInputs.values.antiCorruptionPolicy},
        ${governanceInputs.values.whistleblowingChannel},
        ${governanceInputs.values.dataPrivacyPolicy},
        ${governanceInputs.values.supplierCodeOfConduct},
        ${governanceInputs.values.gdprTraining},
        ${governanceInputs.values.dataBreachesCount},
        ${governanceInputs.values.corruptionIncidentsCount},
        ${governanceInputs.values.finesAmountEur},
        ${governanceInputs.values.notes},
        NOW()
      )
      ON CONFLICT (tenant_id, company_id, reporting_year) DO UPDATE
      SET
        board_total = EXCLUDED.board_total,
        board_women = EXCLUDED.board_women,
        board_independent = EXCLUDED.board_independent,
        board_meetings = EXCLUDED.board_meetings,
        anti_corruption_policy = EXCLUDED.anti_corruption_policy,
        whistleblowing_channel = EXCLUDED.whistleblowing_channel,
        data_privacy_policy = EXCLUDED.data_privacy_policy,
        supplier_code_of_conduct = EXCLUDED.supplier_code_of_conduct,
        gdpr_training = EXCLUDED.gdpr_training,
        data_breaches_count = EXCLUDED.data_breaches_count,
        corruption_incidents_count = EXCLUDED.corruption_incidents_count,
        fines_amount_eur = EXCLUDED.fines_amount_eur,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING
        id,
        tenant_id,
        company_id,
        reporting_year,
        board_total,
        board_women,
        board_independent,
        board_meetings,
        anti_corruption_policy,
        whistleblowing_channel,
        data_privacy_policy,
        supplier_code_of_conduct,
        gdpr_training,
        data_breaches_count,
        corruption_incidents_count,
        fines_amount_eur,
        notes,
        created_at,
        updated_at
    `;

    const governanceRow = governanceRows[0];
    const governanceEvidenceIds = Array.isArray(payload.governanceEvidenceIds)
      ? payload.governanceEvidenceIds
      : Array.isArray(payload.governance?.evidenceIds)
        ? payload.governance.evidenceIds
        : null;

    if (governanceEvidenceIds) {
      await replaceEntityEvidence({
        sql: context.sql,
        tenantId,
        entityType: "governance_yearly",
        entityId: governanceRow.id,
        evidenceIds: governanceEvidenceIds,
      });
    }

    const existingPolicyRows = await context.sql`
      SELECT id, policy_key
      FROM governance_policies
      WHERE tenant_id = ${tenantId}
        AND company_id = ${companyId}
        AND reporting_year = ${reportingYear}
    `;
    const policyIdByKey = new Map(existingPolicyRows.map((row) => [row.policy_key, row.id]));

    for (const policy of policyParse.policies) {
      const existingId = policyIdByKey.get(policy.policyKey) || null;
      const policyRows = existingId
        ? await context.sql`
            UPDATE governance_policies
            SET
              status = ${policy.status},
              notes = ${policy.notes},
              updated_at = NOW()
            WHERE tenant_id = ${tenantId}
              AND company_id = ${companyId}
              AND reporting_year = ${reportingYear}
              AND policy_key = ${policy.policyKey}
            RETURNING id
          `
        : await context.sql`
            INSERT INTO governance_policies (
              id,
              tenant_id,
              company_id,
              reporting_year,
              policy_key,
              status,
              notes,
              updated_at
            )
            VALUES (
              ${randomUUID()},
              ${tenantId},
              ${companyId},
              ${reportingYear},
              ${policy.policyKey},
              ${policy.status},
              ${policy.notes},
              NOW()
            )
            RETURNING id
          `;

      const policyId = policyRows?.[0]?.id || existingId;
      if (policyId && Array.isArray(policy.evidenceIds)) {
        await replaceEntityEvidence({
          sql: context.sql,
          tenantId,
          entityType: "governance_policy",
          entityId: policyId,
          evidenceIds: policy.evidenceIds,
        });
      }
    }

    const finalPolicyRows = await context.sql`
      SELECT
        id,
        tenant_id,
        company_id,
        reporting_year,
        policy_key,
        status,
        notes,
        created_at,
        updated_at
      FROM governance_policies
      WHERE tenant_id = ${tenantId}
        AND company_id = ${companyId}
        AND reporting_year = ${reportingYear}
      ORDER BY policy_key ASC
    `;

    const governanceEvidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "governance_yearly",
      entityIds: [governanceRow.id],
    });

    const policyEvidenceMap = await fetchEntityEvidenceMap({
      sql: context.sql,
      tenantId,
      entityType: "governance_policy",
      entityIds: finalPolicyRows.map((row) => row.id),
    });

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "governance.upsert",
      entityType: "governance_yearly",
      entityId: governanceRow.id,
      payload: {
        companyId,
        reportingYear,
        policyCount: finalPolicyRows.length,
      },
    });

    return json({
      ok: true,
      governance: normalizeGovernance(governanceRow, governanceEvidenceMap.get(governanceRow.id) || []),
      policies: withPolicyDefaults({
        policyRows: finalPolicyRows,
        tenantId,
        companyId,
        reportingYear,
        evidenceMap: policyEvidenceMap,
      }),
      computed: compute({ governanceRow, policyRows: finalPolicyRows }),
      requestId,
    });
  } catch (error) {
    logFailure({ requestId, tenantId, method: "PUT", error });
    return serverError(requestId);
  }
}
