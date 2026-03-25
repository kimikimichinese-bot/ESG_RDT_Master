import {
  checkMonthlyQuota,
  ensureEcoVadisSchema,
  ensureGhgSchema,
  ensureSocialSchema,
  incrementTenantUsage,
} from "../../../../../../_lib/db.js";
import {
  buildEcoVadisDocxBuffer,
  buildEcoVadisExportJson,
  evaluateEcoVadisAssessment,
  normalizeEcoVadisEvidenceRow,
  sanitizeFilenameForDownload,
} from "../../../../../../_lib/ecovadis-api.js";
import { computeEmissionSummary } from "../../../../../../_lib/esg-api.js";
import {
  computeGhgInventory,
  computeSocialCatalogMetrics,
  normalizeGhgDefinitionRow,
} from "../../../../../../_lib/ghg-api.js";
import { buildEcoVadisEvidenceCoverage } from "../../../../../../_lib/evidence-policy.js";
import { errorJson, json } from "../../../../../../_lib/http.js";
import { requireTenantContext } from "../../../../../../_lib/enterprise-api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const assessmentId = params?.assessmentId;

  await ensureEcoVadisSchema();
  const scoped = await requireTenantContext(request, tenantId, "ecovadis");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const quotaCheck = await checkMonthlyQuota(context.sql, tenantId, "exports", {
    increment: 1,
    isSuperadmin: context.isSuperadmin,
  });
  if (!quotaCheck.allowed) {
    return errorJson("Exports quota exceeded", 403, {
      code: quotaCheck.code,
      usage: quotaCheck.usage,
      limit: quotaCheck.limit,
      projected: quotaCheck.projected,
    });
  }
  const evaluated = await evaluateEcoVadisAssessment({
    sql: context.sql,
    tenantId,
    assessmentId,
  });

  if (!evaluated) {
    return errorJson("Assessment not found", 404);
  }

  await Promise.all([ensureGhgSchema(), ensureSocialSchema()]);

  const year = Number(evaluated.assessment.reportingYear);
  const companyId = evaluated.assessment.companyId;

  const [
    factorRows,
    countryOverrideRows,
    metricRows,
    sites,
    companies,
    ghgDefinitionRows,
    ghgRecordRows,
    libraryRows,
    socialMetricRows,
    socialRecordRows,
    workforceRows,
    leaverRows,
    managementRows,
    socialEvidenceRows,
  ] = await Promise.all([
    context.sql`
      SELECT key, unit, value, source, source_label, source_url
      FROM emission_factors
      WHERE tenant_id = ${tenantId}
    `,
    context.sql`
      SELECT country, reporting_year, key, unit, value, source_label, source_url
      FROM emission_factor_country_overrides
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
    `,
    context.sql`
      SELECT tenant_id, company_id, site_id, reporting_year, metric_key, value, unit
      FROM site_metrics
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
        AND (${companyId || ""} = '' OR company_id = ${companyId})
    `,
    context.sql`
      SELECT id, tenant_id, company_id, name, country, address, water_stressed
      FROM sites
      WHERE tenant_id = ${tenantId}
        AND (${companyId || ""} = '' OR company_id = ${companyId})
    `,
    context.sql`
      SELECT id, tenant_id, name, legal_name, country, is_holding
      FROM companies
      WHERE tenant_id = ${tenantId}
        AND (${companyId || ""} = '' OR id = ${companyId})
    `,
    context.sql`
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
    `,
    context.sql`
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
        notes
      FROM ghg_activity_records
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
        AND (${companyId || ""} = '' OR company_id = ${companyId})
    `,
    context.sql`
      SELECT
        library,
        country,
        reporting_year,
        year,
        key,
        unit,
        value,
        scope,
        scope3_category,
        method,
        spend_category,
        transport_mode,
        refrigerant_type,
        region,
        source_label,
        source_url,
        notes
      FROM emission_factor_library
      WHERE reporting_year = ${year}
         OR year = ${year}
         OR reporting_year IS NULL
         OR year IS NULL
    `,
    context.sql`
      SELECT id, key, method, unit
      FROM social_metric_definitions
      WHERE tenant_id = ${tenantId}
        AND is_active = TRUE
        AND deleted_at IS NULL
      ORDER BY sort_order ASC, key ASC
    `,
    context.sql`
      SELECT
        r.id,
        r.company_id,
        r.site_id,
        r.reporting_year,
        r.month,
        r.value,
        d.key AS metric_key
      FROM social_records r
      JOIN social_metric_definitions d
        ON d.id = r.metric_def_id
       AND d.tenant_id = r.tenant_id
       AND d.is_active = TRUE
       AND d.deleted_at IS NULL
      WHERE r.tenant_id = ${tenantId}
        AND r.reporting_year = ${year}
        AND (${companyId || ""} = '' OR r.company_id = ${companyId})
    `,
    context.sql`
      SELECT site_id, month, contract_type, gender, headcount, hours_worked
      FROM workforce_monthly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
        AND (${companyId || ""} = '' OR company_id = ${companyId})
    `,
    context.sql`
      SELECT site_id, month, gender, leavers
      FROM workforce_leavers_monthly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
        AND (${companyId || ""} = '' OR company_id = ${companyId})
    `,
    context.sql`
      SELECT site_id, gender, headcount
      FROM management_headcount_yearly
      WHERE tenant_id = ${tenantId}
        AND reporting_year = ${year}
        AND (${companyId || ""} = '' OR company_id = ${companyId})
    `,
    context.sql`
      SELECT
        ee.entity_id,
        e.id AS evidence_id,
        e.filename,
        e.doc_type,
        e.scope_coverage,
        e.issue_date
      FROM entity_evidence ee
      JOIN social_records r
        ON r.id = ee.entity_id
       AND r.tenant_id = ee.tenant_id
      JOIN evidence e
        ON e.id = ee.evidence_id
       AND e.tenant_id = ee.tenant_id
      WHERE ee.tenant_id = ${tenantId}
        AND ee.entity_type = 'social_record'
        AND r.reporting_year = ${year}
        AND (${companyId || ""} = '' OR r.company_id = ${companyId})
    `,
  ]);

  const legacySummary = computeEmissionSummary({
    factorRows,
    countryOverrideRows,
    metricRows,
    sites,
    companies,
  });

  const ghgSummary = computeGhgInventory({
    records: ghgRecordRows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      siteId: row.site_id,
      reportingYear: Number(row.reporting_year),
      month: row.month == null ? null : Number(row.month),
      activityDefId: row.activity_def_id,
      quantity: row.quantity == null ? null : Number(row.quantity),
      amount: row.amount == null ? null : Number(row.amount),
      currency: row.currency || null,
      directTco2e: row.direct_tco2e == null ? null : Number(row.direct_tco2e),
      metadata: row.metadata || {},
    })),
    definitions: ghgDefinitionRows.map((row) => normalizeGhgDefinitionRow(row)),
    companies,
    sites,
    tenantFactorRows: factorRows,
    countryOverrideRows,
    factorLibraryRows: libraryRows,
  });

  const socialComputed = computeSocialCatalogMetrics({
    metricDefinitions: socialMetricRows,
    socialRecords: socialRecordRows,
    workforceRows,
    leaverRows,
    managementRows,
  });

  const socialEvidenceByRecord = new Map();
  for (const row of socialEvidenceRows || []) {
    const key = row.entity_id;
    if (!socialEvidenceByRecord.has(key)) {
      socialEvidenceByRecord.set(key, []);
    }
    socialEvidenceByRecord.get(key).push(
      normalizeEcoVadisEvidenceRow({
        id: row.evidence_id,
        tenant_id: tenantId,
        site_id: null,
        site_company_id: companyId,
        filename: row.filename,
        content_type: "application/octet-stream",
        size_bytes: 0,
        issue_date: row.issue_date,
        doc_type: row.doc_type,
        scope_coverage: row.scope_coverage,
        is_encrypted: false,
        language: null,
      }),
    );
  }

  const exportJson = buildEcoVadisExportJson(evaluated);
  const evidencePolicy = buildEcoVadisEvidenceCoverage({
    answers: evaluated.questions.flatMap((question) =>
      question.options
        .filter((option) => option.answer?.selected)
        .map((option) => ({
          answerId: option.answer?.id,
          code: question.code,
          label: `${question.code} · ${option.label}`,
          requirementLevel: option.requiresEvidence ? "required" : "recommended",
          evidenceCount: Array.isArray(option.evidence) ? option.evidence.length : 0,
          reason: option.requiresEvidence ? "Selected EcoVadis answer requires evidence" : "Selected EcoVadis answer should include evidence",
        })),
    ),
  });
  exportJson.esgSnapshot = {
    year,
    emissions: {
      tenantTotals: {
        ...legacySummary.tenantTotals,
        scope3Tco2e: ghgSummary.scopeTotals?.scope3Tco2e || 0,
        totalTco2e:
          Number(legacySummary.tenantTotals?.scope1Tco2e || 0) +
          Number(legacySummary.tenantTotals?.scope2LocationTco2e || 0) +
          Number(legacySummary.tenantTotals?.scope2MarketTco2e || 0) +
          Number(ghgSummary.scopeTotals?.scope3Tco2e || 0),
        coveragePct: ghgSummary.coverage,
      },
      scope3Breakdown: ghgSummary.scope3Breakdown,
      missingFactors: ghgSummary.missingFactors,
      factorReferences: (ghgSummary.records || []).map((record) => ({
        recordId: record.recordId,
        activityKey: record.activityKey,
        scope: record.scope,
        scope3Category: record.scope3Category,
        factorKey: record.factorUsed?.key || null,
        resolution: record.factorUsed?.resolution || "missing",
        sourceLabel: record.factorUsed?.sourceLabel || null,
        sourceUrl: record.factorUsed?.sourceUrl || null,
      })),
    },
    social: {
      kpis: socialComputed.values,
      aggregates: socialComputed.aggregates,
      manualMetrics: (socialRecordRows || []).map((row) => ({
        recordId: row.id,
        metricKey: row.metric_key,
        value: Number(row.value || 0),
        evidence: socialEvidenceByRecord.get(row.id) || [],
      })),
    },
  };
  exportJson.evidencePolicy = evidencePolicy;
  const url = new URL(request.url);
  const format = String(url.searchParams.get("format") || "json").toLowerCase();

  if (format === "docx") {
    const buffer = await buildEcoVadisDocxBuffer(exportJson);
    const filename = sanitizeFilenameForDownload(
      `ecovadis-summary-${evaluated.assessment.reportingYear}-${evaluated.assessment.id}.docx`,
      "ecovadis-summary.docx",
    );

    await incrementTenantUsage(context.sql, tenantId, {
      exportsCount: 1,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  await incrementTenantUsage(context.sql, tenantId, {
    exportsCount: 1,
  });

  return json(exportJson);
}
