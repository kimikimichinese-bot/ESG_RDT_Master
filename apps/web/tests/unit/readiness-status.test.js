import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("../../app/api/v1/_lib/db.js");
});

describe("readiness status route", () => {
  it("anonymous status stays ready when only tenant scope is missing", async () => {
    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");
      if (query.includes("SELECT COUNT(*)::int AS count FROM jobs")) {
        return [{ count: 0 }];
      }
      if (query.includes("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1")) {
        return [];
      }
      return [{ ok: 1 }];
    });

    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureSchema: vi.fn(async () => null),
      getSql: vi.fn(() => sql),
      checkMonthlyQuota: vi.fn(async () => ({ allowed: true })),
      incrementTenantUsage: vi.fn(async () => null),
    }));

    const { handleV1Status } = await import("../../app/api/v1/_lib/local-api.js");
    const response = await handleV1Status(new Request("http://localhost/api/v1/status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks.tenantScope).toBe("warn");
    expect(body.tenantContext).toMatchObject({
      provided: false,
      status: "not_provided",
    });
  });
});
