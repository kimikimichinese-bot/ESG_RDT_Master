import { writeAuditLog } from "../../../../../_lib/audit.js";
import { ensureGhgSchema, ensureMetricsSchema, ensureSocialSchema, ensureStandardsSchema } from "../../../../../_lib/db.js";
import { requireTenantContext } from "../../../../../_lib/enterprise-api.js";
import { cleanString, json, parseJsonBody } from "../../../../../_lib/http.js";
import {
  DEF_TYPES,
  buildDefinitionsWithEnabledState,
  ensureStandardsFrameworks,
  isUuid,
  loadCompanyEnabledDefinitions,
  loadCompanyProfile,
  loadInternalDefinitionCatalog,
  normalizeDefinitionType,
  normalizeStandardsFramework,
  parseEnabledDefinitionsPayload,
  replaceCompanyEnabledDefinitions,
  toRequestId,
  upsertCompanyProfile,
} from "../../../../../_lib/standards-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const badRequest = (requestId, code, message) => json({ ok: false, code, message, requestId }, 400);
const serverError = (requestId, code, message) => json({ ok: false, code, message, requestId }, 500);

const resolveCompany = async (sql, tenantId, companyId) => {
  const rows = await sql`
    SELECT id, name, country
    FROM companies
    WHERE tenant_id = ${tenantId}
      AND id = ${companyId}
    LIMIT 1
  `;
  return rows?.[0] || null;
};

const normalizeEnabledRows = (enabledByType) => {
  const out = [];
  for (const type of DEF_TYPES) {
    const state = enabledByType.get(type) || new Map();
    for (const [defKey, value] of state.entries()) {
      out.push({
        defType: type,
        defKey,
        enabled: value.enabled,
        required: value.required,
        updatedAt: value.updatedAt,
      });
    }
  }
  return out;
};

export async function GET(request, { params }) {
  const requestId = toRequestId(request);
  const tenantId = params?.id;
  const companyId = params?.companyId;

  if (!tenantId || !companyId) {
    return badRequest(requestId, "missing_params", "tenant and company id are required");
  }
  if (!isUuid(companyId)) {
    return badRequest(requestId, "invalid_company_id", "companyId must be a valid UUID");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureStandardsSchema();
    await ensureMetricsSchema();
    await ensureGhgSchema();
    await ensureSocialSchema();
    await ensureStandardsFrameworks(context.sql);

    const company = await resolveCompany(context.sql, tenantId, companyId);
    if (!company) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const [profile, catalog, enabledByType] = await Promise.all([
      loadCompanyProfile({ sql: context.sql, tenantId, companyId }),
      loadInternalDefinitionCatalog({ sql: context.sql, tenantId }),
      loadCompanyEnabledDefinitions({ sql: context.sql, tenantId, companyId }),
    ]);

    return json({
      ok: true,
      company,
      profile,
      definitions: buildDefinitionsWithEnabledState({ catalog, enabledByType }),
      enabledDefinitions: normalizeEnabledRows(enabledByType),
    });
  } catch (error) {
    return serverError(
      requestId,
      "standards_company_fetch_failed",
      error instanceof Error ? error.message : "Unable to load company standards configuration",
    );
  }
}

export async function PUT(request, { params }) {
  const requestId = toRequestId(request);
  const tenantId = params?.id;
  const companyId = params?.companyId;

  if (!tenantId || !companyId) {
    return badRequest(requestId, "missing_params", "tenant and company id are required");
  }
  if (!isUuid(companyId)) {
    return badRequest(requestId, "invalid_company_id", "companyId must be a valid UUID");
  }

  const scoped = await requireTenantContext(request, tenantId, "companies");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  try {
    await ensureStandardsSchema();

    const company = await resolveCompany(context.sql, tenantId, companyId);
    if (!company) {
      return badRequest(requestId, "invalid_company", "companyId is invalid for this tenant");
    }

    const payload = await parseJsonBody(request);

    if (payload.profile) {
      const framework = normalizeStandardsFramework(payload.profile.industryFramework || payload.profile.industry_framework || "GRI");
      if (!framework) {
        return badRequest(requestId, "invalid_framework", "industryFramework must be GRI or SASB");
      }

      const sasbIndustryCode = cleanString(payload.profile.sasbIndustryCode || payload.profile.sasb_industry_code);
      if (framework === "SASB" && !sasbIndustryCode) {
        return badRequest(requestId, "missing_sasb_industry_code", "sasbIndustryCode is required when framework is SASB");
      }

      await upsertCompanyProfile({
        sql: context.sql,
        tenantId,
        companyId,
        profile: {
          ...payload.profile,
          industryFramework: framework,
          sasbIndustryCode: sasbIndustryCode || null,
        },
      });
    }

    if (payload.enabledDefinitions || payload.definitions) {
      const parsed = parseEnabledDefinitionsPayload(payload);
      if (parsed.error) {
        return badRequest(requestId, "invalid_enabled_definitions", parsed.error);
      }

      for (const item of parsed.definitions) {
        const type = normalizeDefinitionType(item.defType);
        if (!type) {
          return badRequest(requestId, "invalid_def_type", `invalid defType: ${item.defType}`);
        }
      }

      await replaceCompanyEnabledDefinitions({
        sql: context.sql,
        tenantId,
        companyId,
        definitions: parsed.definitions,
      });
    }

    const [profile, catalog, enabledByType] = await Promise.all([
      loadCompanyProfile({ sql: context.sql, tenantId, companyId }),
      loadInternalDefinitionCatalog({ sql: context.sql, tenantId }),
      loadCompanyEnabledDefinitions({ sql: context.sql, tenantId, companyId }),
    ]);

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "standards.company.update",
      entityType: "company",
      entityId: companyId,
      payload: {
        hasProfile: Boolean(payload.profile),
        hasEnabledDefinitions: Boolean(payload.enabledDefinitions || payload.definitions),
      },
    });

    return json({
      ok: true,
      profile,
      definitions: buildDefinitionsWithEnabledState({ catalog, enabledByType }),
      enabledDefinitions: normalizeEnabledRows(enabledByType),
    });
  } catch (error) {
    return serverError(
      requestId,
      "standards_company_update_failed",
      error instanceof Error ? error.message : "Unable to update company standards configuration",
    );
  }
}
