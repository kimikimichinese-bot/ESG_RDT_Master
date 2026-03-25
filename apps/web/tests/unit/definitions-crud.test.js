import { afterEach, describe, expect, it, vi } from "vitest";

const parseBody = async (response) => {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
};

const tenantId = "42db081f-b696-4ad7-a9f9-825d6aea74ce";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("../../app/api/v1/_lib/enterprise-api.js");
  vi.unmock("../../app/api/v1/_lib/db.js");
  vi.unmock("../../app/api/v1/_lib/audit.js");
  vi.unmock("../../app/api/v1/_lib/standards-api.js");
});

const setupRouteWithStore = ({ initial = [] } = {}) => {
  const rowsByKey = new Map(initial.map((item) => [item.key, { ...item }]));
  const cleanupCalls = {
    companyEnabled: 0,
  };

  const sql = vi.fn(async (parts, ...values) => {
    const query = String(parts?.join?.(" ") || "");

    if (query.includes("SELECT") && query.includes("FROM ghg_activity_definitions") && query.includes("AND key =")) {
      const key = values[1];
      const row = rowsByKey.get(key);
      return row ? [row] : [];
    }

    if (query.includes("INSERT INTO ghg_activity_definitions")) {
      const key = values[4];
      rowsByKey.set(key, {
        id: `id-${key}`,
        key,
        name: values[5],
        scope: values[2],
        scope3_category: values[3],
        group_key: values[6],
        sub_group: values[7],
        method: values[8],
        unit: values[9],
        requires_factor: values[10],
        default_factor_key: values[11],
        input_schema: values[12],
        sdgs: values[13],
        evidence_required: values[14],
        is_system: false,
        is_active: true,
        deleted_at: null,
        sort_order: values[18],
      });
      return [];
    }

    if (query.includes("UPDATE ghg_activity_definitions") && query.includes("SET") && query.includes("is_active = FALSE")) {
      const key = values[1];
      const row = rowsByKey.get(key);
      if (row) {
        row.is_active = false;
        row.deleted_at = new Date().toISOString();
      }
      return [];
    }

    if (query.includes("DELETE FROM company_enabled_definitions")) {
      cleanupCalls.companyEnabled += 1;
      return [];
    }
    if (query.includes("DELETE FROM standards_mappings") || query.includes("DELETE FROM topic_to_metric")) {
      return [];
    }
    if (query.includes("FROM ghg_activity_records")) {
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
    ensureStandardsSchema: vi.fn(async () => null),
    ensureGhgSchema: vi.fn(async () => null),
    ensureMetricsSchema: vi.fn(async () => null),
    ensureSocialSchema: vi.fn(async () => null),
    ensureGovernanceSchema: vi.fn(async () => null),
  }));

  vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
    writeAuditLog: vi.fn(async () => null),
  }));

  vi.doMock("../../app/api/v1/_lib/standards-api.js", () => ({
    isUuid: vi.fn(() => true),
    normalizeDefinitionType: vi.fn((value) => value),
    filterDefinitionsByCompanyEnabled: vi.fn(async ({ definitions }) => definitions),
    loadInternalDefinitionCatalog: vi.fn(async () => ({
      environment_metric: [],
      ghg_activity: [...rowsByKey.values()]
        .filter((row) => row.is_active !== false && !row.deleted_at)
        .map((row) => ({
          key: row.key,
          id: row.id,
          name: row.name,
          unit: row.unit,
          method: row.method,
          scope: row.scope,
          scope3Category: row.scope3_category,
          isSystem: row.is_system === true,
          isActive: row.is_active !== false,
          custom: row.is_system !== true,
        })),
      social_metric: [],
      governance_field: [],
    })),
  }));

  return { cleanupCalls };
};

describe("definitions CRUD", () => {
  it("create custom GHG definition then GET includes it", async () => {
    setupRouteWithStore();
    const { POST, GET } = await import("../../app/api/v1/tenants/[id]/definitions/[type]/route.js");

    const postResponse = await POST(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "ghg_custom_new_field",
          name: "Custom GHG Field",
          scope: "scope3",
          scope3Category: 6,
          method: "activity",
          unit: "pax_km",
        }),
      }),
      { params: { id: tenantId, type: "ghg" } },
    );
    expect(postResponse.status).toBe(201);

    const getResponse = await GET(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg", { method: "GET" }),
      { params: { id: tenantId, type: "ghg" } },
    );
    const getBody = await parseBody(getResponse);
    expect(getResponse.status).toBe(200);
    expect(getBody.ok).toBe(true);
    expect(getBody.definitions.some((item) => item.key === "ghg_custom_new_field")).toBe(true);
  });

  it("delete custom GHG definition then GET does not include it", async () => {
    setupRouteWithStore();
    const { POST, DELETE, GET } = await import("../../app/api/v1/tenants/[id]/definitions/[type]/route.js");

    await POST(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "ghg_custom_scuregge_pollution",
          name: "Scuregge pollution",
          scope: "scope3",
          scope3Category: 6,
          method: "activity",
          unit: "pax_km",
        }),
      }),
      { params: { id: tenantId, type: "ghg" } },
    );

    const deleteResponse = await DELETE(
      new Request(
        "http://localhost/api/v1/tenants/x/definitions/ghg?key=ghg_custom_scuregge_pollution",
        { method: "DELETE" },
      ),
      { params: { id: tenantId, type: "ghg" } },
    );
    const deleteBody = await parseBody(deleteResponse);
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody.ok).toBe(true);

    const getResponse = await GET(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg", { method: "GET" }),
      { params: { id: tenantId, type: "ghg" } },
    );
    const getBody = await parseBody(getResponse);
    expect(getBody.definitions.some((item) => item.key === "ghg_custom_scuregge_pollution")).toBe(false);
  });

  it("delete system definition is blocked", async () => {
    setupRouteWithStore({
      initial: [
        {
          id: "id-system",
          key: "s1_stationary_natural_gas_mwh",
          name: "System definition",
          scope: "scope1",
          scope3_category: null,
          group_key: "GHG",
          sub_group: "Combustion",
          method: "activity",
          unit: "MWh",
          requires_factor: true,
          default_factor_key: "ef_natural_gas_kgco2e_per_mwh",
          input_schema: {},
          sdgs: [],
          evidence_required: true,
          is_system: true,
          is_active: true,
          deleted_at: null,
          sort_order: 1,
        },
      ],
    });

    const { DELETE } = await import("../../app/api/v1/tenants/[id]/definitions/[type]/route.js");
    const response = await DELETE(
      new Request(
        "http://localhost/api/v1/tenants/x/definitions/ghg?key=s1_stationary_natural_gas_mwh",
        { method: "DELETE" },
      ),
      { params: { id: tenantId, type: "ghg" } },
    );

    const body = await parseBody(response);
    expect(response.status).toBe(403);
    expect(body.code).toBe("system_definition_locked");
  });

  it("auditor cannot delete definitions", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        response: new Response(
          JSON.stringify({ ok: false, code: "rbac_read_only", message: "Forbidden by role policy" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureStandardsSchema: vi.fn(async () => null),
      ensureGhgSchema: vi.fn(async () => null),
      ensureMetricsSchema: vi.fn(async () => null),
      ensureSocialSchema: vi.fn(async () => null),
      ensureGovernanceSchema: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/standards-api.js", () => ({
      isUuid: vi.fn(() => true),
      normalizeDefinitionType: vi.fn((value) => value),
      filterDefinitionsByCompanyEnabled: vi.fn(async ({ definitions }) => definitions),
      loadInternalDefinitionCatalog: vi.fn(async () => ({
        environment_metric: [],
        ghg_activity: [],
        social_metric: [],
        governance_field: [],
      })),
    }));

    const { DELETE } = await import("../../app/api/v1/tenants/[id]/definitions/[type]/route.js");
    const response = await DELETE(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg?key=ghg_custom", { method: "DELETE" }),
      { params: { id: tenantId, type: "ghg" } },
    );
    const body = await parseBody(response);
    expect(response.status).toBe(403);
    expect(body.code).toBe("rbac_read_only");
  });

  it("impersonation read-only blocks delete", async () => {
    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        response: new Response(
          JSON.stringify({ ok: false, code: "impersonation_read_only", message: "Write blocked during read-only impersonation" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/db.js", () => ({
      ensureStandardsSchema: vi.fn(async () => null),
      ensureGhgSchema: vi.fn(async () => null),
      ensureMetricsSchema: vi.fn(async () => null),
      ensureSocialSchema: vi.fn(async () => null),
      ensureGovernanceSchema: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/audit.js", () => ({
      writeAuditLog: vi.fn(async () => null),
    }));
    vi.doMock("../../app/api/v1/_lib/standards-api.js", () => ({
      isUuid: vi.fn(() => true),
      normalizeDefinitionType: vi.fn((value) => value),
      filterDefinitionsByCompanyEnabled: vi.fn(async ({ definitions }) => definitions),
      loadInternalDefinitionCatalog: vi.fn(async () => ({
        environment_metric: [],
        ghg_activity: [],
        social_metric: [],
        governance_field: [],
      })),
    }));

    const { DELETE } = await import("../../app/api/v1/tenants/[id]/definitions/[type]/route.js");
    const response = await DELETE(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg?key=ghg_custom", { method: "DELETE" }),
      { params: { id: tenantId, type: "ghg" } },
    );
    const body = await parseBody(response);
    expect(response.status).toBe(403);
    expect(body.code).toBe("impersonation_read_only");
  });

  it("delete cleans company_enabled_definitions", async () => {
    const { cleanupCalls } = setupRouteWithStore({
      initial: [
        {
          id: "id-custom",
          key: "ghg_custom_cleanup_target",
          name: "Cleanup target",
          scope: "scope3",
          scope3_category: 6,
          group_key: "GHG",
          sub_group: "Travel",
          method: "activity",
          unit: "pax_km",
          requires_factor: true,
          default_factor_key: "ef_s3_cat6_flights_kgco2e_per_pax_km",
          input_schema: {},
          sdgs: [],
          evidence_required: true,
          is_system: false,
          is_active: true,
          deleted_at: null,
          sort_order: 1,
        },
      ],
    });
    const { DELETE } = await import("../../app/api/v1/tenants/[id]/definitions/[type]/route.js");
    const response = await DELETE(
      new Request("http://localhost/api/v1/tenants/x/definitions/ghg?key=ghg_custom_cleanup_target", { method: "DELETE" }),
      { params: { id: tenantId, type: "ghg" } },
    );
    expect(response.status).toBe(200);
    expect(cleanupCalls.companyEnabled).toBeGreaterThan(0);
  });
});
