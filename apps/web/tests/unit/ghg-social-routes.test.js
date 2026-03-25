import { afterEach, describe, expect, it, vi } from "vitest";
import { computeGhgInventory, computeSocialCatalogMetrics } from "../../app/api/v1/_lib/ghg-api.js";

const parseBody = async (response) => {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("../../app/api/v1/_lib/enterprise-api.js");
  vi.unmock("../../app/api/v1/_lib/db.js");
  vi.unmock("../../app/api/v1/_lib/esg-api.js");
  vi.unmock("../../app/api/v1/_lib/audit.js");
});

describe("ghg + social coverage", () => {
  it("GET ghg definitions returns seeded definitions", async () => {
    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    let definitionsReadCount = 0;

    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");
      if (query.includes("FROM ghg_activity_definitions")) {
        definitionsReadCount += 1;
        if (definitionsReadCount === 1) {
          return [];
        }
        return [
          {
            id: "11111111-1111-4111-8111-111111111111",
            tenant_id: tenantId,
            scope: "scope1",
            scope3_category: null,
            key: "s1_stationary_natural_gas_mwh",
            name: "Stationary combustion · Natural gas",
            group_key: "GHG",
            sub_group: "Combustion",
            method: "activity",
            unit: "MWh",
            requires_factor: true,
            default_factor_key: "ef_natural_gas_kgco2e_per_mwh",
            input_schema: {},
            sdgs: [7, 12, 13],
            evidence_required: true,
            is_active: true,
            sort_order: 10,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      }
      return [];
    });

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql,
          user: { id: "user-1" },
        },
      })),
    }));

    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureGhgSchema: vi.fn(async () => null),
      seedGhgActivityDefinitionsForTenant: vi.fn(async () => null),
      ensureStandardsSchema: vi.fn(async () => null),
    }));

    const { GET } = await import("../../app/api/v1/tenants/[id]/ghg/definitions/route.js");
    const response = await GET(new Request(`http://localhost/api/v1/tenants/${tenantId}/ghg/definitions`, { method: "GET" }), {
      params: { id: tenantId },
    });

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.definitions)).toBe(true);
    expect(body.definitions.length).toBeGreaterThan(0);
  });

  it("POST ghg record then compute returns non-500 and ok", async () => {
    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const companyId = "40918323-6014-4929-ae12-f2aab1199ae0";
    const siteId = "2b19bc55-a9d3-49aa-b4f9-5517d2e3f2d4";
    const definitionId = "11111111-1111-4111-8111-111111111111";

    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");

      if (query.includes("FROM ghg_activity_definitions")) {
        return [
          {
            id: definitionId,
            tenant_id: tenantId,
            scope: "scope1",
            scope3_category: null,
            key: "s1_stationary_natural_gas_mwh",
            name: "Stationary combustion · Natural gas",
            group_key: "GHG",
            sub_group: "Combustion",
            method: "activity",
            unit: "MWh",
            requires_factor: true,
            default_factor_key: "ef_natural_gas_kgco2e_per_mwh",
            input_schema: {},
            sdgs: [],
            evidence_required: true,
            is_active: true,
            sort_order: 10,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      }

      if (query.includes("INSERT INTO ghg_activity_records")) {
        return [
          {
            id: "22222222-2222-4222-8222-222222222222",
            tenant_id: tenantId,
            company_id: companyId,
            site_id: siteId,
            reporting_year: 2026,
            month: 1,
            activity_def_id: definitionId,
            quantity: "10",
            amount: null,
            currency: null,
            direct_tco2e: null,
            metadata: {},
            notes: "test",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      }

      if (query.includes("FROM ghg_activity_records")) {
        return [
          {
            id: "22222222-2222-4222-8222-222222222222",
            tenant_id: tenantId,
            company_id: companyId,
            site_id: siteId,
            reporting_year: 2026,
            month: 1,
            activity_def_id: definitionId,
            quantity: "10",
            amount: null,
            currency: null,
            direct_tco2e: null,
            metadata: {},
            notes: "test",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      }

      if (query.includes("FROM emission_factors")) {
        return [
          {
            key: "ef_natural_gas_kgco2e_per_mwh",
            unit: "kgCO2e/MWh",
            value: "200",
            source: "Tenant",
            source_label: "Tenant",
            source_url: "https://example.com/factor",
          },
        ];
      }

      if (query.includes("FROM emission_factor_country_overrides") || query.includes("FROM emission_factor_library")) {
        return [];
      }

      if (query.includes("FROM companies")) {
        return [{ id: companyId, name: "Demo Co", country: "IT", is_holding: false, tenant_id: tenantId }];
      }

      if (query.includes("FROM sites")) {
        return [{ id: siteId, company_id: companyId, name: "HQ", country: "IT", tenant_id: tenantId }];
      }

      return [];
    });

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql,
          user: { id: "user-1" },
        },
      })),
    }));

    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureGhgSchema: vi.fn(async () => null),
      ensureStandardsSchema: vi.fn(async () => null),
    }));

    vi.doMock("../../app/api/v1/_lib/esg-api.js", () => ({
      resolveCompany: vi.fn(async () => ({ id: companyId, tenant_id: tenantId })),
      resolveSite: vi.fn(async () => ({ id: siteId, tenant_id: tenantId, company_id: companyId })),
      fetchEntityEvidenceMap: vi.fn(async () => new Map()),
      replaceEntityEvidence: vi.fn(async () => null),
    }));

    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));

    const { POST } = await import("../../app/api/v1/tenants/[id]/ghg/records/route.js");
    const postResponse = await POST(
      new Request(`http://localhost/api/v1/tenants/${tenantId}/ghg/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          siteId,
          reportingYear: 2026,
          month: 1,
          activityDefId: definitionId,
          quantity: 10,
          notes: "test",
        }),
      }),
      { params: { id: tenantId } },
    );

    const postBody = await parseBody(postResponse);
    expect(postResponse.status).toBe(201);
    expect(postBody.ok).toBe(true);

    const { GET } = await import("../../app/api/v1/tenants/[id]/ghg/compute/route.js");
    const computeResponse = await GET(
      new Request(
        `http://localhost/api/v1/tenants/${tenantId}/ghg/compute?year=2026&companyId=${companyId}&siteId=${siteId}&library=IPCC`,
        { method: "GET" },
      ),
      { params: { id: tenantId } },
    );

    const computeBody = await parseBody(computeResponse);
    expect(computeResponse.status).toBe(200);
    expect(computeBody.ok).toBe(true);
    expect(Number(computeBody.scopeTotals.totalTco2e)).toBeGreaterThan(0);
  });

  it("computeGhgInventory reports missing factor keys", () => {
    const output = computeGhgInventory({
      records: [
        {
          id: "r1",
          companyId: "c1",
          siteId: null,
          reportingYear: 2026,
          activityDefId: "d1",
          quantity: 25,
          metadata: {},
        },
      ],
      definitions: [
        {
          id: "d1",
          scope: "scope1",
          scope3Category: null,
          key: "s1_stationary_natural_gas_mwh",
          name: "Natural gas",
          method: "activity",
          requiresFactor: true,
          defaultFactorKey: "ef_natural_gas_kgco2e_per_mwh",
        },
      ],
      companies: [{ id: "c1", name: "Company", country: "IT" }],
      sites: [],
      tenantFactorRows: [],
      countryOverrideRows: [],
      factorLibraryRows: [],
      library: "IPCC",
    });

    expect(output.missingFactors).toContain("ef_natural_gas_kgco2e_per_mwh");
    expect(output.warnings.length).toBeGreaterThan(0);
  });

  it("scope3 spend method computes amount*factor", () => {
    const output = computeGhgInventory({
      records: [
        {
          id: "r1",
          companyId: "c1",
          siteId: null,
          reportingYear: 2026,
          activityDefId: "d1",
          amount: 1000,
          currency: "EUR",
          metadata: {},
        },
      ],
      definitions: [
        {
          id: "d1",
          scope: "scope3",
          scope3Category: 6,
          key: "s3_cat6_flights_pax_km",
          name: "Flights",
          method: "spend",
          requiresFactor: true,
          defaultFactorKey: "ef_s3_cat6_spend_kgco2e_per_eur",
        },
      ],
      companies: [{ id: "c1", name: "Company", country: "IT" }],
      sites: [],
      tenantFactorRows: [
        {
          key: "ef_s3_cat6_spend_kgco2e_per_eur",
          value: 0.5,
          unit: "kgCO2e/EUR",
          source_label: "Test",
          source_url: "https://example.com",
        },
      ],
      countryOverrideRows: [],
      factorLibraryRows: [],
      library: "IPCC",
    });

    expect(output.scopeTotals.scope3Tco2e).toBe(0.5);
    expect(output.scope3Breakdown[0].category).toBe(6);
    expect(output.scope3Breakdown[0].totalTco2e).toBe(0.5);
  });

  it("partial scope3 category 11 computes with starter proxy and emits structured warning", () => {
    const output = computeGhgInventory({
      records: [
        {
          id: "r11",
          companyId: "c1",
          siteId: null,
          reportingYear: 2026,
          activityDefId: "d11",
          quantity: 1200,
          metadata: { region: "EU", annual_use_hours: 4000 },
        },
      ],
      definitions: [
        {
          id: "d11",
          scope: "scope3",
          scope3Category: 11,
          key: "s3_cat11_use_of_sold_products_kwh",
          name: "Use of sold products",
          method: "activity",
          requiresFactor: true,
          defaultFactorKey: "ef_s3_cat11_use_phase_kgco2e_per_kwh",
        },
      ],
      companies: [{ id: "c1", name: "Company", country: "IT" }],
      sites: [],
      tenantFactorRows: [],
      countryOverrideRows: [],
      factorLibraryRows: [
        {
          library: "IPCC",
          key: "ef_s3_cat11_use_phase_kgco2e_per_kwh",
          unit: "kgCO2e/kWh",
          value: 0.32,
          scope: "scope3",
          scope3_category: 11,
          method: "activity",
          source_label: "Starter proxy",
          source_url: "https://example.com/use-phase",
        },
      ],
      library: "IPCC",
    });

    expect(output.scopeTotals.scope3Tco2e).toBe(0.384);
    expect(output.records[0].supportStatus).toBe("partial");
    expect(output.warnings.some((item) => item.includes("Scope 3 category 11"))).toBe(true);
  });

  it("partial scope3 category 8 computes with tenant factor and keeps partial status visible", () => {
    const output = computeGhgInventory({
      records: [
        {
          id: "r8",
          companyId: "c1",
          siteId: null,
          reportingYear: 2026,
          activityDefId: "d8",
          quantity: 2500,
          metadata: { asset_type: "warehouse" },
        },
      ],
      definitions: [
        {
          id: "d8",
          scope: "scope3",
          scope3Category: 8,
          key: "s3_cat8_upstream_leased_energy_kwh",
          name: "Upstream leased assets",
          method: "activity",
          requiresFactor: true,
          defaultFactorKey: "ef_s3_cat8_leased_energy_kgco2e_per_kwh",
        },
      ],
      companies: [{ id: "c1", name: "Company", country: "IT" }],
      sites: [],
      tenantFactorRows: [
        {
          key: "ef_s3_cat8_leased_energy_kgco2e_per_kwh",
          value: 0.32,
          unit: "kgCO2e/kWh",
          source_label: "Tenant screening proxy",
          source_url: "https://example.com/leased-energy",
        },
      ],
      countryOverrideRows: [],
      factorLibraryRows: [],
      library: "IPCC",
    });

    expect(output.scopeTotals.scope3Tco2e).toBe(0.8);
    expect(output.records[0].factorUsed.resolution).toBe("tenant_default");
    expect(output.records[0].supportStatus).toBe("partial");
  });

  it("computeSocialCatalogMetrics computes turnover", () => {
    const output = computeSocialCatalogMetrics({
      metricDefinitions: [{ key: "s_turnover_pct", method: "computed" }],
      socialRecords: [],
      workforceRows: [
        { month: 1, contract_type: "total", gender: "M", headcount: 50, hours_worked: 1000 },
        { month: 1, contract_type: "total", gender: "F", headcount: 50, hours_worked: 1000 },
        { month: 12, contract_type: "total", gender: "M", headcount: 48, hours_worked: 1000 },
        { month: 12, contract_type: "total", gender: "F", headcount: 52, hours_worked: 1000 },
      ],
      leaverRows: [
        { month: 1, gender: "M", leavers: 3 },
        { month: 2, gender: "F", leavers: 7 },
      ],
      managementRows: [],
    });

    expect(output.values.s_turnover_pct).toBe(10);
  });

  it("RBAC tenant isolation is enforced for ghg definitions route", async () => {
    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        response: new Response(JSON.stringify({ ok: false, code: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      })),
    }));

    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureGhgSchema: vi.fn(async () => null),
      seedGhgActivityDefinitionsForTenant: vi.fn(async () => null),
      ensureStandardsSchema: vi.fn(async () => null),
    }));

    const { GET } = await import("../../app/api/v1/tenants/[id]/ghg/definitions/route.js");
    const response = await GET(new Request(`http://localhost/api/v1/tenants/${tenantId}/ghg/definitions`, { method: "GET" }), {
      params: { id: tenantId },
    });

    const body = await parseBody(response);
    expect(response.status).toBe(403);
    expect(body.code).toBe("forbidden");
  });
});
