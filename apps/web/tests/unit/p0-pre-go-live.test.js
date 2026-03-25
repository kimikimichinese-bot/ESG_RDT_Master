import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const parseBody = async (response) => {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("../../app/api/v1/_lib/auth.js");
  vi.unmock("../../app/api/v1/_lib/db.js");
  vi.unmock("../../app/api/v1/_lib/rbac.js");
  vi.unmock("../../app/api/v1/_lib/enterprise-api.js");
  vi.unmock("../../app/api/v1/_lib/audit.js");
  vi.unmock("../../app/api/v1/_lib/standards-api.js");
  const { resetRateLimitStoreForTests } = await import("../../app/api/v1/_lib/rate-limit.js");
  resetRateLimitStoreForTests();
});

describe("P0 pre-go-live", () => {
  it("seed demo script attempts core inserts in dry-run mode", async () => {
    const observedQueries = [];
    let ghgInsertCount = 0;
    let socialInsertCount = 0;
    let evidenceInsertCount = 0;
    let ghgDefLookupCount = 0;
    let socialDefLookupCount = 0;

    const sql = vi.fn(async (parts, ...values) => {
      const query = String(parts?.join?.(" ") || "");
      observedQueries.push(query);

      if (query.includes("FROM users") && query.includes("superadmin@windwardnexus.local")) {
        return [{ id: "user-super", email: "superadmin@windwardnexus.local" }];
      }
      if (query.includes("FROM users") && query.includes("admin@demoholding.local")) {
        return [{ id: "user-admin", email: "admin@demoholding.local" }];
      }
      if (query.includes("FROM tenants") && query.includes("WHERE name")) {
        return [];
      }
      if (query.includes("INSERT INTO tenants")) {
        return [{ id: "tenant-1", name: "Demo Holding" }];
      }
      if (query.includes("INSERT INTO companies")) {
        const name = values.find((item) => item === "Demo Holding" || item === "Shipyard One") || "Company";
        return [
          {
            id: name === "Demo Holding" ? "company-holding" : "company-operating",
            tenant_id: "tenant-1",
            name,
            is_holding: name === "Demo Holding",
          },
        ];
      }
      if (query.includes("INSERT INTO sites")) {
        const name = values.find((item) => typeof item === "string" && ["Bagnoli", "Torre Annunziata Alfa", "Hamburg Yard"].includes(item));
        return [
          {
            id: `site-${name || "x"}`,
            tenant_id: "tenant-1",
            company_id: "company-operating",
            name,
            country: name === "Hamburg Yard" ? "DE" : "IT",
            water_stressed: name === "Torre Annunziata Alfa",
          },
        ];
      }
      if (query.includes("FROM ghg_activity_definitions")) {
        ghgDefLookupCount += 1;
        if (ghgDefLookupCount === 1) {
          return [{ id: "def-diesel", key: "s1_mobile_diesel_liters", method: "activity" }];
        }
        if (ghgDefLookupCount === 2) {
          return [{ id: "def-electricity", key: "s2_purchased_electricity_location_kwh", method: "activity" }];
        }
        return [{ id: "def-flights", key: "s3_cat6_flights_pax_km", method: "activity" }];
      }
      if (query.includes("FROM social_metric_definitions")) {
        socialDefLookupCount += 1;
        if (socialDefLookupCount === 1) {
          return [{ id: "social-training", key: "s_training_hours_total", method: "manual" }];
        }
        if (socialDefLookupCount === 2) {
          return [{ id: "social-incidents", key: "s_hs_total_recordable_incidents", method: "manual" }];
        }
        return [{ id: "social-supplier", key: "s_supplier_screened_count", method: "manual" }];
      }
      if (query.includes("FROM ghg_activity_records") && query.includes("notes =")) {
        return [];
      }
      if (query.includes("INSERT INTO ghg_activity_records")) {
        ghgInsertCount += 1;
        return [{ id: `ghg-${ghgInsertCount}` }];
      }
      if (query.includes("FROM social_records") && query.includes("notes =")) {
        return [];
      }
      if (query.includes("INSERT INTO social_records")) {
        socialInsertCount += 1;
        return [{ id: `social-${socialInsertCount}` }];
      }
      if (query.includes("FROM evidence") && query.includes("blob_url")) {
        return [];
      }
      if (query.includes("INSERT INTO evidence")) {
        evidenceInsertCount += 1;
        return [{ id: `evidence-${evidenceInsertCount}` }];
      }
      return [];
    });

    const { seedDemoData } = await import("../../../../scripts/dev/seed-demo-data.mjs");
    const result = await seedDemoData({ sql, skipEnsureSchemas: true });

    expect(result.tenantId).toBe("tenant-1");
    expect(result.sites.length).toBeGreaterThanOrEqual(3);
    expect(ghgInsertCount).toBeGreaterThanOrEqual(3);
    expect(socialInsertCount).toBeGreaterThanOrEqual(2);
    expect(evidenceInsertCount).toBeGreaterThanOrEqual(2);
    expect(observedQueries.some((query) => query.includes("INSERT INTO companies"))).toBe(true);
    expect(observedQueries.some((query) => query.includes("INSERT INTO sites"))).toBe(true);
    expect(observedQueries.some((query) => query.includes("INSERT INTO entity_evidence"))).toBe(true);
  });

  it("audit export writes snapshot/csv files and includes resolved factors", async () => {
    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");

      if (query.includes("FROM tenants") && query.includes("WHERE name")) {
        return [{ id: "tenant-1", name: "Demo Holding" }];
      }
      if (query.includes("FROM tenants") && query.includes("WHERE id")) {
        return [{ id: "tenant-1", name: "Demo Holding", tenant_status: "active" }];
      }
      if (query.includes("FROM companies") && query.includes("WHERE tenant_id")) {
        return [
          { id: "company-hold", tenant_id: "tenant-1", name: "Demo Holding", legal_name: null, country: "IT", is_holding: true },
          { id: "company-op", tenant_id: "tenant-1", name: "Shipyard One", legal_name: null, country: "IT", is_holding: false },
        ];
      }
      if (query.includes("FROM sites") && query.includes("WHERE tenant_id")) {
        return [
          { id: "site-it", tenant_id: "tenant-1", company_id: "company-op", name: "Bagnoli", country: "IT", address: "", water_stressed: false },
        ];
      }
      if (query.includes("FROM emission_factors")) {
        return [
          {
            key: "ef_diesel_kgco2e_per_liter",
            unit: "kgCO2e/liter",
            value: "2.68",
            source: "DEMO",
            source_label: "DEMO ONLY",
            source_url: "https://example.com/factor",
          },
        ];
      }
      if (query.includes("FROM emission_factor_country_overrides")) {
        return [];
      }
      if (query.includes("FROM site_metrics")) {
        return [];
      }
      if (query.includes("FROM metric_definitions")) {
        return [];
      }
      if (query.includes("FROM ghg_activity_definitions")) {
        return [
          {
            id: "def-diesel",
            tenant_id: "tenant-1",
            scope: "scope1",
            scope3_category: null,
            key: "s1_mobile_diesel_liters",
            name: "Diesel",
            group_key: "GHG",
            sub_group: "Mobile",
            method: "activity",
            unit: "liters",
            requires_factor: true,
            default_factor_key: "ef_diesel_kgco2e_per_liter",
            input_schema: {},
            sdgs: [],
            evidence_required: true,
            is_active: true,
            sort_order: 1,
          },
        ];
      }
      if (query.includes("FROM ghg_activity_records")) {
        return [
          {
            id: "ghg-1",
            tenant_id: "tenant-1",
            company_id: "company-op",
            site_id: "site-it",
            reporting_year: 2026,
            month: 1,
            activity_def_id: "def-diesel",
            quantity: "1000",
            amount: null,
            currency: null,
            direct_tco2e: null,
            metadata: {},
          },
        ];
      }
      if (query.includes("FROM emission_factor_library")) {
        return [];
      }
      if (query.includes("FROM workforce_monthly")) {
        return [];
      }
      if (query.includes("FROM workforce_leavers_monthly")) {
        return [];
      }
      if (query.includes("FROM management_headcount_yearly")) {
        return [];
      }
      if (query.includes("FROM company_year_flags")) {
        return [];
      }
      if (query.includes("FROM social_metric_definitions")) {
        return [];
      }
      if (query.includes("FROM social_records")) {
        return [];
      }
      if (query.includes("FROM materiality_thresholds")) {
        return [{ tenant_id: "tenant-1", impact_threshold: 9, financial_threshold: 9, updated_at: new Date().toISOString() }];
      }
      if (query.includes("FROM materiality_selected_topics")) {
        return [];
      }
      if (query.includes("FROM standards_mappings")) {
        return [
          {
            framework: "GRI",
            industry_code: "",
            code: "GRI 305-1",
            title: "Direct (Scope 1) GHG emissions",
            internal_type: "ghg_activity",
            internal_key: "s1_mobile_diesel_liters",
          },
        ];
      }
      if (query.includes("FROM evidence e")) {
        return [
          {
            evidence_id: "evidence-1",
            filename: "demo.pdf",
            blob_url: "https://example.com/demo.pdf",
            entity_type: "ghg_record",
            entity_id: "ghg-1",
          },
        ];
      }
      if (query.includes("FROM governance_field_definitions")) {
        return [];
      }

      return [];
    });

    const tmpExportRoot = await mkdtemp(join(tmpdir(), "audit-pack-test-"));
    const { exportAuditPack } = await import("../../../../scripts/dev/export-audit-pack.mjs");
    const result = await exportAuditPack({
      sql,
      baseUrl: "http://127.0.0.1:3000",
      year: 2026,
      outputRoot: tmpExportRoot,
      skipEnsureSchemas: true,
      skipZip: true,
      tenantId: "tenant-1",
    });

    const snapshot = JSON.parse(await readFile(join(result.exportDir, "snapshot.json"), "utf-8"));
    const standardsCsv = await readFile(join(result.exportDir, "standards-mappings.csv"), "utf-8");
    const evidenceCsv = await readFile(join(result.exportDir, "evidence-links.csv"), "utf-8");
    const readme = await readFile(join(result.exportDir, "README.txt"), "utf-8");

    expect(snapshot.emissions).toBeDefined();
    expect(snapshot.evidenceCoverage).toMatchObject({
      requiredCount: 1,
      coveredCount: 1,
      missingCount: 0,
      coveragePct: 100,
    });
    expect(snapshot.evidenceCoverage.requiredCoverage.coveragePct).toBe(100);
    expect(Array.isArray(snapshot.emissions.resolvedFactors)).toBe(true);
    expect(snapshot.emissions.resolvedFactors.length).toBeGreaterThan(0);
    expect(snapshot.emissions.resolvedFactors[0].factor).toMatchObject({
      sourceUrl: "https://example.com/factor",
      resolution: "tenant_default",
    });
    expect(standardsCsv).toContain("framework,industry_code,code,title,internal_type,internal_key");
    expect(evidenceCsv).toContain("evidence_id,filename,blob_url,entity_type,entity_id,pages,comment");
    expect(readme).toContain("Required evidence coverage: 1/1 (100%)");

    await rm(tmpExportRoot, { recursive: true, force: true });
  });

  it("emissions snapshot helper includes resolved sources", async () => {
    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");
      if (query.includes("FROM tenants") && query.includes("WHERE id")) {
        return [{ id: "tenant-1", name: "Demo Holding", tenant_status: "active" }];
      }
      if (query.includes("FROM companies") && query.includes("WHERE tenant_id")) {
        return [{ id: "company-op", tenant_id: "tenant-1", name: "Shipyard One", legal_name: null, country: "IT", is_holding: false }];
      }
      if (query.includes("FROM sites") && query.includes("WHERE tenant_id")) {
        return [{ id: "site-it", tenant_id: "tenant-1", company_id: "company-op", name: "Bagnoli", country: "IT", address: "", water_stressed: false }];
      }
      if (query.includes("FROM emission_factors")) {
        return [{ key: "ef_diesel_kgco2e_per_liter", unit: "kgCO2e/liter", value: "2.68", source: "DEMO", source_label: "DEMO", source_url: "https://example.com/factor" }];
      }
      if (query.includes("FROM emission_factor_country_overrides")) return [];
      if (query.includes("FROM site_metrics")) return [];
      if (query.includes("FROM metric_definitions")) return [];
      if (query.includes("FROM ghg_activity_definitions")) {
        return [{
          id: "def-diesel", tenant_id: "tenant-1", scope: "scope1", scope3_category: null, key: "s1_mobile_diesel_liters", name: "Diesel", group_key: "GHG", sub_group: "Mobile", method: "activity", unit: "liters", requires_factor: true, default_factor_key: "ef_diesel_kgco2e_per_liter", input_schema: {}, sdgs: [], evidence_required: true, is_active: true, sort_order: 1,
        }];
      }
      if (query.includes("FROM ghg_activity_records")) {
        return [{ id: "ghg-1", tenant_id: "tenant-1", company_id: "company-op", site_id: "site-it", reporting_year: 2026, month: 1, activity_def_id: "def-diesel", quantity: "500", amount: null, currency: null, direct_tco2e: null, metadata: {} }];
      }
      if (query.includes("FROM emission_factor_library")) return [];
      if (query.includes("FROM workforce_monthly")) return [];
      if (query.includes("FROM workforce_leavers_monthly")) return [];
      if (query.includes("FROM management_headcount_yearly")) return [];
      if (query.includes("FROM company_year_flags")) return [];
      if (query.includes("FROM social_metric_definitions")) return [];
      if (query.includes("FROM social_records")) return [];
      if (query.includes("FROM materiality_thresholds")) return [{ tenant_id: "tenant-1", impact_threshold: 9, financial_threshold: 9, updated_at: new Date().toISOString() }];
      if (query.includes("FROM materiality_selected_topics")) return [];
      if (query.includes("FROM evidence e")) return [];
      if (query.includes("FROM governance_field_definitions")) return [];
      return [];
    });

    const { loadAuditSnapshot } = await import("../../../../scripts/dev/export-audit-pack.mjs");
    const snapshot = await loadAuditSnapshot({ sql, tenantId: "tenant-1", year: 2026 });

    expect(Array.isArray(snapshot.emissions.resolvedFactors)).toBe(true);
    expect(snapshot.emissions.resolvedFactors.length).toBeGreaterThan(0);
    expect(snapshot.emissions.resolvedFactors[0].factor.resolution).toBe("tenant_default");
    expect(snapshot.emissions.resolvedFactors[0].factor.sourceUrl).toBe("https://example.com/factor");
    expect(snapshot.evidenceCoverage).toMatchObject({
      requiredCount: 1,
      coveredCount: 0,
      missingCount: 1,
      coveragePct: 0,
    });
    expect(snapshot.evidenceCoverage.requiredCoverage.missingCount).toBe(1);
  });

  it("Auditor write is blocked with rbac_read_only", async () => {
    vi.doUnmock("../../app/api/v1/_lib/enterprise-api.js");
    vi.doMock("../../app/api/v1/_lib/auth.js", () => ({
      getMembership: (memberships, tenantId) => memberships.find((item) => item.tenantId === tenantId) || null,
      getSessionContext: vi.fn(async () => ({
        sql: vi.fn(),
        user: { id: "user-a", platformRole: "none" },
        memberships: [{ tenantId: "tenant-a", role: "Auditor" }],
        platformRole: "none",
        isSuperadmin: false,
        impersonationReadOnly: false,
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      PLATFORM_ROLES: { NONE: "none", SUPERADMIN: "superadmin", SUPPORT: "support", BILLING: "billing" },
      TENANT_STATUSES: { ACTIVE: "active", SUSPENDED: "suspended", ARCHIVED: "archived" },
      getTenantStatus: vi.fn(async () => "active"),
      incrementTenantUsage: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/rbac.js", async () => {
      const actual = await vi.importActual("../../app/api/v1/_lib/rbac.js");
      return actual;
    });

    const { requireTenantContext } = await import("../../app/api/v1/_lib/enterprise-api.js");
    const request = new Request("http://localhost/api/v1/tenants/tenant-a/metrics", { method: "PUT" });
    const scoped = await requireTenantContext(request, "tenant-a", "metrics");
    const body = await parseBody(scoped.response);

    expect(scoped.response.status).toBe(403);
    expect(body.code).toBe("rbac_read_only");
  });

  it("Personnel write is blocked for restricted pilot resources", async () => {
    const { ROLES, canAccessResource } = await import("../../app/api/v1/_lib/rbac.js");

    expect(canAccessResource(ROLES.PERSONNEL, "activities", "POST")).toBe(true);
    expect(canAccessResource(ROLES.PERSONNEL, "people", "POST")).toBe(true);
    expect(canAccessResource(ROLES.PERSONNEL, "metrics", "POST")).toBe(false);
    expect(canAccessResource(ROLES.PERSONNEL, "materiality", "POST")).toBe(false);
    expect(canAccessResource(ROLES.PERSONNEL, "governance", "PUT")).toBe(false);
    expect(canAccessResource(ROLES.PERSONNEL, "ecovadis", "POST")).toBe(false);
    expect(canAccessResource(ROLES.PERSONNEL, "assessments", "POST")).toBe(false);
  });

  it("Personnel cannot mutate assessments", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireAuthContext: vi.fn(async () => ({
        context: {
          activeTenantId: "tenant-a",
          isSuperadmin: false,
          memberships: [{ tenantId: "tenant-a", role: "Personnel" }],
          user: { id: "user-1" },
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureAssessmentSchema: vi.fn(async () => null),
      getSql: vi.fn(() => vi.fn(async () => [])),
      checkMonthlyQuota: vi.fn(async () => ({ allowed: true })),
      incrementTenantUsage: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));

    const { createProject } = await import("../../app/api/v1/_lib/assessment-api.js");
    const response = await createProject(
      new Request("http://localhost/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Pilot assessment" }),
      }),
    );
    const body = await parseBody(response);

    expect(response.status).toBe(403);
    expect(body.code).toBe("forbidden");
    expect(body.resource).toBe("assessments");
  });

  it("superadmin impersonation read-only blocks write with impersonation_read_only", async () => {
    vi.doUnmock("../../app/api/v1/_lib/enterprise-api.js");
    vi.doMock("../../app/api/v1/_lib/auth.js", () => ({
      getMembership: (memberships, tenantId) => memberships.find((item) => item.tenantId === tenantId) || null,
      getSessionContext: vi.fn(async () => ({
        sql: vi.fn(),
        user: { id: "user-super", platformRole: "superadmin" },
        memberships: [],
        platformRole: "superadmin",
        isSuperadmin: true,
        impersonationReadOnly: true,
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      PLATFORM_ROLES: { NONE: "none", SUPERADMIN: "superadmin", SUPPORT: "support", BILLING: "billing" },
      TENANT_STATUSES: { ACTIVE: "active", SUSPENDED: "suspended", ARCHIVED: "archived" },
      getTenantStatus: vi.fn(async () => "active"),
      incrementTenantUsage: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/rbac.js", () => ({
      ROLES: { TENANT_ADMIN: "TenantAdmin", MANAGER: "Manager", PERSONNEL: "Personnel", AUDITOR: "Auditor" },
      canAccessResource: vi.fn(() => true),
    }));

    const { requireTenantContext } = await import("../../app/api/v1/_lib/enterprise-api.js");
    const request = new Request("http://localhost/api/v1/tenants/tenant-a/metrics", { method: "POST" });
    const scoped = await requireTenantContext(request, "tenant-a", "metrics");
    const body = await parseBody(scoped.response);

    expect(scoped.response.status).toBe(403);
    expect(body.code).toBe("impersonation_read_only");
  });

  it("standards import route rate-limits at 5/min", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql: vi.fn(async () => []),
          user: { id: "user-1" },
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureStandardsSchema: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/standards-api.js", () => ({
      toRequestId: vi.fn(() => "req-1"),
      ensureStandardsFrameworks: vi.fn(async () => null),
      parseStandardsImportCsv: vi.fn(() => ({ rows: [{ framework: "GRI" }] })),
      importStandardsCsv: vi.fn(async () => ({ insertedMetrics: 1, updatedMetrics: 0, mappingsCreated: 1 })),
    }));

    const { POST } = await import("../../app/api/v1/tenants/[id]/standards/import-csv/route.js");

    let last = null;
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await POST(
        new Request("http://localhost/api/v1/tenants/tenant-a/standards/import-csv", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ csv: "framework,code,title\nGRI,305-1,Scope 1" }),
        }),
        { params: { id: "tenant-a" } },
      );
    }

    const payload = await parseBody(last);
    expect(last.status).toBe(429);
    expect(payload.code).toBe("rate_limited");
    expect(typeof payload.retryAfterSec).toBe("number");
  });
});
