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

describe("year kickoff onboarding route", () => {
  it("GET returns default state when row does not exist", async () => {
    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const companyId = "40918323-6014-4929-ae12-f2aab1199ae0";

    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");
      if (query.includes("FROM companies")) {
        return [{ id: companyId }];
      }
      if (query.includes("FROM materiality_year_kickoff_state")) {
        return [];
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
    }));

    const { GET } = await import("../../app/api/v1/tenants/[id]/onboarding/year-kickoff/route.js");
    const response = await GET(
      new Request(
        `http://localhost/api/v1/tenants/${tenantId}/onboarding/year-kickoff?companyId=${companyId}&year=2026`,
      ),
      { params: { id: tenantId } },
    );

    const body = await parseBody(response);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state).toMatchObject({
      companyId,
      reportingYear: 2026,
      kickoffDismissed: false,
      definitionCompleted: false,
      lastStep: "define",
    });
  });

  it("PUT returns 403 for read-only roles", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        response: new Response(
          JSON.stringify({ ok: false, code: "rbac_read_only", message: "Forbidden by role policy" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      })),
    }));

    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureMaterialitySchema: vi.fn(async () => null),
    }));

    const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";
    const companyId = "40918323-6014-4929-ae12-f2aab1199ae0";
    const { PUT } = await import("../../app/api/v1/tenants/[id]/onboarding/year-kickoff/route.js");

    const response = await PUT(
      new Request(`http://localhost/api/v1/tenants/${tenantId}/onboarding/year-kickoff`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          reportingYear: 2026,
          kickoffDismissed: true,
        }),
      }),
      { params: { id: tenantId } },
    );

    const body = await parseBody(response);
    expect(response.status).toBe(403);
    expect(body.code).toBe("rbac_read_only");
  });
});
