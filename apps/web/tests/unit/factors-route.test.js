import { afterEach, describe, expect, it, vi } from "vitest";

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
});

describe("factors route", () => {
  it("GET returns 400 with ok:false for missing country/year", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql: vi.fn(),
          user: { id: "user-1" },
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureGhgSchema: vi.fn(async () => null),
    }));

    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const { GET } = await import("../../app/api/v1/tenants/[id]/factors/route.js");
    const response = await GET(new Request(`http://localhost/api/v1/tenants/${tenantId}/factors`, { method: "GET" }), {
      params: { id: tenantId },
    });

    const body = await parseBody(response);
    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(typeof body.code).toBe("string");
    expect(typeof body.message).toBe("string");
  });

  it("GET returns 200 with suggestions for valid params", async () => {
    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");

      if (query.includes("FROM emission_factors")) {
        return [
          {
            key: "ef_scope2_location_kgco2e_per_kwh",
            unit: "kgCO2e/kWh",
            value: "0.35",
            source: "Tenant source",
            source_label: "Tenant source",
            source_url: "https://example.com/tenant",
          },
        ];
      }

      if (query.includes("FROM emission_factor_country_overrides")) {
        return [];
      }

      if (query.includes("FROM emission_factor_library")) {
        return [
          {
            library: "IPCC",
            country: null,
            reporting_year: null,
            key: "ef_natural_gas_kgco2e_per_mwh",
            unit: "kgCO2e/MWh",
            value: "202",
            source_label: "IPCC generic combustion default",
            source_url: "https://example.com/ipcc",
            notes: "Reference value",
          },
        ];
      }

      if (query.includes("FROM emission_factor_settings")) {
        return [{ country: "", refrigerant_type: "R134A" }];
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
    }));

    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const { GET } = await import("../../app/api/v1/tenants/[id]/factors/route.js");
    const response = await GET(
      new Request(
        `http://localhost/api/v1/tenants/${tenantId}/factors?year=2026&country=IT&library=IPCC`,
        { method: "GET" },
      ),
      { params: { id: tenantId } },
    );

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.suggestions)).toBe(true);
  });
});
