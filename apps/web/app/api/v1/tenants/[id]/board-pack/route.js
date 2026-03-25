import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { json } from "../../../_lib/http.js";
import { loadAuditSnapshot } from "../../../../../../../../scripts/dev/export-audit-pack.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const toCsvCell = (value) => {
  const raw = value == null ? "" : String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '""')}"`;
};

const toCsv = (rows, headers) => [headers.join(","), ...rows.map((row) => headers.map((header) => toCsvCell(row[header])).join(","))].join("\n");

const round = (value) => Number(Number(value || 0).toFixed(2));
const pctDelta = (current, previous) => {
  const prev = Number(previous || 0);
  if (prev === 0) {
    return null;
  }
  return round(((Number(current || 0) - prev) / prev) * 100);
};

const buildTopicSummary = (snapshot) => {
  const topics = Array.isArray(snapshot.materiality?.byCompany)
    ? [...new Set(snapshot.materiality.byCompany.flatMap((item) => (item.materialTopics || []).map((topic) => topic.topicCode)).filter(Boolean))]
    : [];
  return topics.slice(0, 5);
};

const buildGovernanceSummary = (snapshot) => {
  const rows = Array.isArray(snapshot.governance?.yearly) ? snapshot.governance.yearly : [];
  if (rows.length === 0) {
    return {
      boardWomenPct: 0,
      independentPct: 0,
      boardMeetingsAvg: 0,
      policyCoveragePct: 0,
    };
  }
  const totals = rows.reduce(
    (acc, row) => ({
      boardTotal: acc.boardTotal + Number(row.board_total || 0),
      boardWomen: acc.boardWomen + Number(row.board_women || 0),
      boardIndependent: acc.boardIndependent + Number(row.board_independent || 0),
      boardMeetings: acc.boardMeetings + Number(row.board_meetings || 0),
    }),
    { boardTotal: 0, boardWomen: 0, boardIndependent: 0, boardMeetings: 0 },
  );
  const policies = Array.isArray(snapshot.governance?.policies) ? snapshot.governance.policies : [];
  const yesPolicies = policies.filter((row) => String(row.status || "").toLowerCase() === "yes").length;
  return {
    boardWomenPct: totals.boardTotal > 0 ? round((totals.boardWomen / totals.boardTotal) * 100) : 0,
    independentPct: totals.boardTotal > 0 ? round((totals.boardIndependent / totals.boardTotal) * 100) : 0,
    boardMeetingsAvg: round(totals.boardMeetings / rows.length),
    policyCoveragePct: policies.length > 0 ? round((yesPolicies / policies.length) * 100) : 100,
  };
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "audit");
  if (scoped.response) {
    return scoped.response;
  }

  const url = new URL(request.url);
  const baseYear = Number.parseInt(String(url.searchParams.get("year") || new Date().getFullYear()), 10);
  const yearsCount = Math.min(Math.max(Number.parseInt(String(url.searchParams.get("years") || "3"), 10), 2), 5);
  const format = String(url.searchParams.get("format") || "json").toLowerCase();
  const years = Array.from({ length: yearsCount }, (_, index) => baseYear - (yearsCount - 1 - index));

  const snapshots = [];
  for (const year of years) {
    // eslint-disable-next-line no-await-in-loop
    snapshots.push(await loadAuditSnapshot({ sql: scoped.context.sql, tenantId, year }));
  }

  const rows = snapshots.map((snapshot) => ({
    year: snapshot.emissions.year,
    scope1Tco2e: round(snapshot.emissions.tenantTotals?.scope1Tco2e || 0),
    scope2LocationTco2e: round(snapshot.emissions.tenantTotals?.scope2LocationTco2e || 0),
    scope2MarketTco2e: round(snapshot.emissions.tenantTotals?.scope2MarketTco2e || 0),
    scope3Tco2e: round(snapshot.emissions.tenantTotals?.scope3Tco2e || 0),
    womenInWorkforcePct: round(snapshot.social?.summary?.tenantTotals?.womenInWorkforcePct || 0),
    womenInManagementPct: round(snapshot.social?.summary?.tenantTotals?.womenInManagementPct || 0),
    turnoverPct: round(snapshot.social?.summary?.tenantTotals?.turnoverPct || 0),
    trainingHoursPerEmployee: round(
      snapshot.social?.catalogValues?.s_training_hours_per_employee || snapshot.social?.catalogValues?.s_training_hours_total || 0,
    ),
    materialTopicCount: Array.isArray(snapshot.materiality?.byCompany)
      ? snapshot.materiality.byCompany.reduce((acc, item) => acc + Number(item.materialTopics?.length || 0), 0)
      : 0,
    topMaterialTopics: buildTopicSummary(snapshot),
    governance: buildGovernanceSummary(snapshot),
    evidenceCoverage: {
      requiredPct: round(snapshot.evidenceCoverage?.requiredCoverage?.coveragePct || snapshot.evidenceCoverage?.coveragePct || 0),
      recommendedPct: round(snapshot.evidenceCoverage?.recommendedCoverage?.coveragePct || 0),
      missingRequired: Number(snapshot.evidenceCoverage?.missingCount || 0),
    },
  }));

  const current = rows[rows.length - 1] || null;
  const previous = rows[rows.length - 2] || null;
  const comparison = current && previous
    ? {
        currentYear: current.year,
        previousYear: previous.year,
        delta: {
          scope1Tco2e: round(current.scope1Tco2e - previous.scope1Tco2e),
          scope2LocationTco2e: round(current.scope2LocationTco2e - previous.scope2LocationTco2e),
          scope3Tco2e: round(current.scope3Tco2e - previous.scope3Tco2e),
          womenInWorkforcePct: round(current.womenInWorkforcePct - previous.womenInWorkforcePct),
          womenInManagementPct: round(current.womenInManagementPct - previous.womenInManagementPct),
          turnoverPct: round(current.turnoverPct - previous.turnoverPct),
          trainingHoursPerEmployee: round(current.trainingHoursPerEmployee - previous.trainingHoursPerEmployee),
          evidenceRequiredPct: round(current.evidenceCoverage.requiredPct - previous.evidenceCoverage.requiredPct),
          scope1Pct: pctDelta(current.scope1Tco2e, previous.scope1Tco2e),
          scope2LocationPct: pctDelta(current.scope2LocationTco2e, previous.scope2LocationTco2e),
          scope3Pct: pctDelta(current.scope3Tco2e, previous.scope3Tco2e),
        },
      }
    : null;

  if (format === "csv") {
    const csv = toCsv(rows.map((row) => ({
      ...row,
      topMaterialTopics: row.topMaterialTopics.join("|"),
      boardWomenPct: row.governance.boardWomenPct,
      independentPct: row.governance.independentPct,
      boardMeetingsAvg: row.governance.boardMeetingsAvg,
      policyCoveragePct: row.governance.policyCoveragePct,
      evidenceRequiredPct: row.evidenceCoverage.requiredPct,
      evidenceRecommendedPct: row.evidenceCoverage.recommendedPct,
      missingRequiredEvidence: row.evidenceCoverage.missingRequired,
    })), [
      "year",
      "scope1Tco2e",
      "scope2LocationTco2e",
      "scope2MarketTco2e",
      "scope3Tco2e",
      "womenInWorkforcePct",
      "womenInManagementPct",
      "turnoverPct",
      "trainingHoursPerEmployee",
      "materialTopicCount",
      "topMaterialTopics",
      "boardWomenPct",
      "independentPct",
      "boardMeetingsAvg",
      "policyCoveragePct",
      "evidenceRequiredPct",
      "evidenceRecommendedPct",
      "missingRequiredEvidence",
    ]);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return json({
    ok: true,
    years,
    trends: rows,
    comparison,
  });
}
