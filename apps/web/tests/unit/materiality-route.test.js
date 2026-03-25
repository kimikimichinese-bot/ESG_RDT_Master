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

describe("materiality report route", () => {
  it("returns 200 ok:true with empty arrays when selection is empty", async () => {
    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const companyId = "40918323-6014-4929-ae12-f2aab1199ae0";

    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");

      if (query.includes("FROM companies")) {
        return [{ id: companyId }];
      }

      if (query.includes("FROM materiality_selected_topics")) {
        return [];
      }

      if (query.includes("FROM materiality_thresholds")) {
        return [{ tenant_id: tenantId, impact_threshold: "9", financial_threshold: "9", updated_at: new Date().toISOString() }];
      }

      return [];
    });

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql,
          user: { id: "user-1" },
          isSuperadmin: false,
        },
      })),
    }));

    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureMaterialitySchema: vi.fn(async () => null),
      checkMonthlyQuota: vi.fn(async () => ({ allowed: true })),
      incrementTenantUsage: vi.fn(async () => null),
    }));

    const { GET } = await import("../../app/api/v1/tenants/[id]/materiality/report/route.js");
    const response = await GET(
      new Request(`http://localhost/api/v1/tenants/${tenantId}/materiality/report?companyId=${companyId}&year=2026`, {
        method: "GET",
      }),
      { params: { id: tenantId } },
    );

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.matrixPoints)).toBe(true);
    expect(body.matrixPoints).toHaveLength(0);
    expect(Array.isArray(body.materialTopics)).toBe(true);
    expect(body.materialTopics).toHaveLength(0);
  });
});
