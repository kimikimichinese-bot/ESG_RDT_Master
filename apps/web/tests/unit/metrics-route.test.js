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

describe("metrics route", () => {
  it("GET returns 200 with definitions for valid ids", async () => {
    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const companyId = "40918323-6014-4929-ae12-f2aab1199ae0";
    const siteId = "2b19bc55-a9d3-49aa-b4f9-5517d2e3f2d4";

    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");

      if (query.includes("FROM metric_definitions")) {
        return [
          {
            key: "electricity_kwh",
            category: "Energy",
            label: "Electricity consumption",
            unit: "kWh",
            description: "Total purchased electricity.",
            is_required: true,
            validation: { min: 0 },
          },
        ];
      }

      if (query.includes("FROM site_metrics m")) {
        return [{ metric_key: "electricity_kwh", value: "123.45" }];
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
      ensureEnterpriseSchema: vi.fn(async () => null),
      ensureMetricsSchema: vi.fn(async () => null),
      ensureStandardsSchema: vi.fn(async () => null),
    }));

    const { GET } = await import("../../app/api/v1/tenants/[id]/metrics/route.js");
    const response = await GET(
      new Request(
        `http://localhost/api/v1/tenants/${tenantId}/metrics?year=2026&companyId=${companyId}&siteId=${siteId}`,
        { method: "GET" },
      ),
      { params: { id: tenantId } },
    );

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.definitions)).toBe(true);
    expect(body.definitions.length).toBeGreaterThan(0);
  });
});
