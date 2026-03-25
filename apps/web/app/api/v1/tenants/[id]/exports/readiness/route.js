import { requireTenantContext } from "../../../../_lib/enterprise-api.js";
import { json } from "../../../../_lib/http.js";
import { loadAuditSnapshot } from "../../../../../../../../../scripts/dev/export-audit-pack.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "audit");
  if (scoped.response) {
    return scoped.response;
  }

  const url = new URL(request.url);
  const year = Number.parseInt(String(url.searchParams.get("year") || new Date().getFullYear()), 10);
  const snapshot = await loadAuditSnapshot({
    sql: scoped.context.sql,
    tenantId,
    year,
  });

  const companies = Array.isArray(snapshot?.structure?.companies) ? snapshot.structure.companies.filter((item) => item.isHolding !== true) : [];
  const materialityRows = Array.isArray(snapshot?.materiality?.byCompany) ? snapshot.materiality.byCompany : [];
  const selectedTopicCompanies = materialityRows.filter((item) => Array.isArray(item.selectedTopicIds) && item.selectedTopicIds.length > 0);
  const materialTopicCompanies = materialityRows.filter((item) => Array.isArray(item.materialTopics) && item.materialTopics.length > 0);
  const missingMaterialityCompanies = companies
    .filter((company) => !selectedTopicCompanies.some((item) => item.companyId === company.id))
    .map((company) => company.name);

  return json({
    ok: true,
    year,
    evidenceCoverage: snapshot.evidenceCoverage,
    missingFactorsCount: Array.isArray(snapshot?.emissions?.missingFactors) ? snapshot.emissions.missingFactors.length : 0,
    unsupportedCategoriesCount: Array.isArray(snapshot?.scope3Support)
      ? snapshot.scope3Support.filter((item) => item.status && item.status !== "supported").length
      : 0,
    materiality: {
      companyCount: companies.length,
      companiesWithSelectedTopics: selectedTopicCompanies.length,
      companiesWithMaterialTopics: materialTopicCompanies.length,
      completenessPct: companies.length > 0 ? Number(((selectedTopicCompanies.length / companies.length) * 100).toFixed(2)) : 100,
      missingCompanies: missingMaterialityCompanies,
    },
  });
}
