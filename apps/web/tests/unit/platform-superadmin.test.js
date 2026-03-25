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
  vi.unmock("../../app/api/v1/_lib/auth.js");
  vi.unmock("../../app/api/v1/_lib/db.js");
  vi.unmock("../../app/api/v1/_lib/rbac.js");
  vi.unmock("../../app/api/v1/_lib/enterprise-api.js");
  vi.unmock("../../app/api/v1/_lib/audit.js");
});

describe("platform superadmin controls", () => {
  it("tenant user cannot read another tenant", async () => {
    vi.doUnmock("../../app/api/v1/_lib/enterprise-api.js");
    vi.doMock("../../app/api/v1/_lib/auth.js", () => ({
      getMembership: (memberships, tenantId) => memberships.find((item) => item.tenantId === tenantId) || null,
      getSessionContext: vi.fn(async () => ({
        sql: vi.fn(),
        user: { id: "user-a" },
        memberships: [{ tenantId: "tenant-a", role: "TenantAdmin" }],
        platformRole: "none",
        isSuperadmin: false,
        impersonationReadOnly: false,
        availableTenantIds: ["tenant-a"],
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      PLATFORM_ROLES: {
        NONE: "none",
        SUPERADMIN: "superadmin",
        SUPPORT: "support",
        BILLING: "billing",
      },
      TENANT_STATUSES: {
        ACTIVE: "active",
        SUSPENDED: "suspended",
        ARCHIVED: "archived",
      },
      getTenantStatus: vi.fn(async () => "active"),
      incrementTenantUsage: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/rbac.js", () => ({
      canAccessResource: vi.fn(() => true),
    }));

    const { requireTenantContext } = await import("../../app/api/v1/_lib/enterprise-api.js");
    const request = new Request("http://localhost/api/v1/tenants/tenant-b", { method: "GET" });
    const scoped = await requireTenantContext(request, "tenant-b", "tenant");
    expect(scoped.response).toBeDefined();
    expect(scoped.response.status).toBe(403);
  });

  it("superadmin can read tenants list", async () => {
    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");
      if (query.includes("FROM tenants t")) {
        return [
          {
            id: "tenant-1",
            name: "Tenant One",
            tenant_status: "active",
            created_by_user_id: "user-sa",
            internal_notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            plan: "free",
            max_users: 5,
            max_evidence_bytes: 1073741824,
            max_exports_per_month: 50,
            max_jobs_per_month: 500,
            modules: {},
            users_count: 2,
            exports_count: 1,
            jobs_count: 0,
            api_calls_count: 10,
            companies_count: 1,
            sites_count: 1,
            evidence_bytes_cumulative: 1024,
          },
        ];
      }
      return [];
    });

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      normalizeTenant: (row) => ({
        id: row.id,
        name: row.name,
        tenantStatus: row.tenant_status,
        createdByUserId: row.created_by_user_id,
        internalNotes: row.internal_notes,
      }),
      requirePlatformRole: vi.fn(async () => ({
        context: {
          user: { id: "user-sa" },
          platformRole: "superadmin",
          sql,
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      PLATFORM_ROLES: {
        NONE: "none",
        SUPERADMIN: "superadmin",
        SUPPORT: "support",
        BILLING: "billing",
      },
      ensureDefaultEmissionFactorsForTenant: vi.fn(async () => null),
      ensureHoldingCompanyForTenant: vi.fn(async () => null),
      ensureTenantEntitlements: vi.fn(async () => null),
      upsertTenantEntitlements: vi.fn(async () => null),
      getUsagePeriod: vi.fn(() => ({ year: 2026, month: 3 })),
    }));

    const { GET } = await import("../../app/api/v1/superadmin/tenants/route.js");
    const response = await GET(new Request("http://localhost/api/v1/superadmin/tenants", { method: "GET" }));
    const body = await parseBody(response);

    expect(response.status).toBe(200);
    expect(Array.isArray(body.tenants)).toBe(true);
    expect(body.tenants.length).toBe(1);
    expect(body.tenants[0].name).toBe("Tenant One");
  });

  it("tenant_status suspended blocks tenant users", async () => {
    vi.doUnmock("../../app/api/v1/_lib/enterprise-api.js");
    vi.doMock("../../app/api/v1/_lib/auth.js", () => ({
      getMembership: (memberships, tenantId) => memberships.find((item) => item.tenantId === tenantId) || null,
      getSessionContext: vi.fn(async () => ({
        sql: vi.fn(),
        user: { id: "user-a" },
        memberships: [{ tenantId: "tenant-a", role: "TenantAdmin" }],
        platformRole: "none",
        isSuperadmin: false,
        impersonationReadOnly: false,
        availableTenantIds: ["tenant-a"],
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      PLATFORM_ROLES: {
        NONE: "none",
        SUPERADMIN: "superadmin",
        SUPPORT: "support",
        BILLING: "billing",
      },
      TENANT_STATUSES: {
        ACTIVE: "active",
        SUSPENDED: "suspended",
        ARCHIVED: "archived",
      },
      getTenantStatus: vi.fn(async () => "suspended"),
      incrementTenantUsage: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/rbac.js", () => ({
      canAccessResource: vi.fn(() => true),
    }));

    const { requireTenantContext } = await import("../../app/api/v1/_lib/enterprise-api.js");
    const request = new Request("http://localhost/api/v1/tenants/tenant-a", { method: "GET" });
    const scoped = await requireTenantContext(request, "tenant-a", "tenant");
    const payload = await parseBody(scoped.response);

    expect(scoped.response.status).toBe(403);
    expect(payload.code).toBe("tenant_suspended");
  });

  it("quota evidence exceeded blocks evidence upload route", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      normalizeEvidence: (row) => row,
      requireTenantContext: vi.fn(async () => ({
        context: {
          user: { id: "user-a" },
          sql: vi.fn(),
          isSuperadmin: false,
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      checkEvidenceQuota: vi.fn(async () => ({
        allowed: false,
        code: "quota_evidence_exceeded",
        usage: 110,
        limit: 100,
        projected: 120,
      })),
      incrementTenantUsage: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));

    const { POST } = await import("../../app/api/v1/tenants/[id]/evidence/route.js");
    const response = await POST(
      new Request("http://localhost/api/v1/tenants/tenant-a/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: "test.pdf", sizeBytes: 10 }),
      }),
      { params: { id: "tenant-a" } },
    );

    const payload = await parseBody(response);
    expect(response.status).toBe(403);
    expect(payload.code).toBe("quota_evidence_exceeded");
  });

  it("evidence bytes usage counter increments on evidence create", async () => {
    const sql = vi.fn(async (parts) => {
      const query = String(parts?.join?.(" ") || "");
      if (query.includes("INSERT INTO evidence")) {
        return [
          {
            id: "ev-1",
            tenant_id: "tenant-a",
            site_id: null,
            filename: "test.pdf",
            content_type: "application/pdf",
            size_bytes: 321,
            sha256: null,
            blob_url: null,
            issue_date: null,
            doc_type: null,
            scope_coverage: null,
            is_encrypted: false,
            language: null,
            created_at: new Date().toISOString(),
          },
        ];
      }
      return [];
    });
    const incrementTenantUsage = vi.fn(async () => null);

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      normalizeEvidence: (row) => row,
      parsePagination: () => ({ limit: 200 }),
      requireTenantContext: vi.fn(async () => ({
        context: {
          user: { id: "user-a" },
          sql,
          isSuperadmin: false,
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      checkEvidenceQuota: vi.fn(async () => ({
        allowed: true,
        code: null,
        usage: 0,
        limit: 1000,
        projected: 321,
      })),
      incrementTenantUsage,
    }));
    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));

    const { POST } = await import("../../app/api/v1/tenants/[id]/evidence/route.js");
    const response = await POST(
      new Request("http://localhost/api/v1/tenants/tenant-a/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "test.pdf",
          contentType: "application/pdf",
          sizeBytes: 321,
        }),
      }),
      { params: { id: "tenant-a" } },
    );

    expect(response.status).toBe(201);
    expect(incrementTenantUsage).toHaveBeenCalledWith(sql, "tenant-a", { evidenceBytes: 321 });
  });

  it("active tenant endpoint allows superadmin and rejects unauthorized tenant users", async () => {
    const buildSessionCookie = vi.fn((payload) => `esg_session=fake.${payload.activeTenantId}; Path=/`);
    const getTenantQuotaSnapshot = vi.fn(async () => ({ exceeded: { any: false }, usage: {} }));

    vi.doMock("../../app/api/v1/_lib/auth.js", () => ({
      buildSessionCookie,
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      getTenantQuotaSnapshot,
    }));

    const requireAuth = vi
      .fn()
      .mockResolvedValueOnce({
        context: {
          user: { id: "tenant-user" },
          isSuperadmin: false,
          platformRole: "none",
          memberships: [{ tenantId: "tenant-a", role: "TenantAdmin", tenantName: "Tenant A", tenantStatus: "active" }],
          availableTenants: [{ tenantId: "tenant-a", role: "TenantAdmin", tenantName: "Tenant A", tenantStatus: "active" }],
          sql: vi.fn(),
        },
      })
      .mockResolvedValueOnce({
        context: {
          user: { id: "superadmin" },
          isSuperadmin: true,
          platformRole: "superadmin",
          memberships: [],
          availableTenants: [{ tenantId: "tenant-z", role: "Superadmin", tenantName: "Tenant Z", tenantStatus: "active" }],
          sql: vi.fn(async () => [{ id: "tenant-z", name: "Tenant Z", tenant_status: "active" }]),
        },
      });

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireAuth,
    }));

    const { POST } = await import("../../app/api/v1/auth/active-tenant/route.js");

    const forbiddenResponse = await POST(
      new Request("http://localhost/api/v1/auth/active-tenant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "tenant-b", readOnly: false }),
      }),
    );
    expect(forbiddenResponse.status).toBe(403);

    const okResponse = await POST(
      new Request("http://localhost/api/v1/auth/active-tenant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "tenant-z", readOnly: true }),
      }),
    );
    const payload = await parseBody(okResponse);
    expect(okResponse.status).toBe(200);
    expect(payload.impersonationReadOnly).toBe(true);
    expect(payload.activeTenantId).toBe("tenant-z");
    expect(buildSessionCookie).toHaveBeenCalled();
  });
});
