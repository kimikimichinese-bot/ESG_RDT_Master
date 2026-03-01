import { writeAuditLog } from "../../../_lib/audit.js";
import { getFactorDefaults, normalizeFactorRow } from "../../../_lib/esg-api.js";
import { requireTenantContext } from "../../../_lib/enterprise-api.js";
import { cleanString, errorJson, json, parseJsonBody } from "../../../_lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const normalizePayloadRows = (payload) => {
  if (Array.isArray(payload.factors)) {
    return payload.factors;
  }
  if (payload && typeof payload === "object") {
    return [payload];
  }
  return [];
};

export async function GET(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "factors");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;

  const rows = await context.sql`
    SELECT tenant_id, key, label, unit, value, source, created_at, updated_at
    FROM emission_factors
    WHERE tenant_id = ${tenantId}
    ORDER BY key ASC
  `;

  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const defaults = getFactorDefaults();

  const factors = defaults.map((item) => {
    const row = rowMap.get(item.key) || {
      key: item.key,
      label: item.label,
      unit: item.unit,
      value: null,
      source: null,
      created_at: null,
      updated_at: null,
    };
    return normalizeFactorRow(row, item.required);
  });

  const missingRequiredFactors = factors.filter((item) => item.required && item.value == null).map((item) => item.key);

  return json({
    factors,
    missingRequiredFactors,
  });
}

export async function PUT(request, { params }) {
  const tenantId = params?.id;
  const scoped = await requireTenantContext(request, tenantId, "factors");
  if (scoped.response) {
    return scoped.response;
  }

  const { context } = scoped;
  const payload = await parseJsonBody(request);
  const updates = normalizePayloadRows(payload);

  if (updates.length === 0) {
    return errorJson("factors[] update payload is required", 400);
  }

  const defaults = getFactorDefaults();
  const defaultMap = new Map(defaults.map((item) => [item.key, item]));

  const updatedKeys = [];
  for (const entry of updates) {
    const key = cleanString(entry.key);
    const def = defaultMap.get(key);
    if (!def) {
      return errorJson(`Unknown factor key: ${key || "<empty>"}`, 400);
    }

    const value = parseNumber(entry.value);
    if (entry.value !== null && entry.value !== "" && value == null) {
      return errorJson(`Invalid factor value for ${key}`, 400);
    }

    await context.sql`
      INSERT INTO emission_factors (tenant_id, key, label, unit, value, source)
      VALUES (${tenantId}, ${key}, ${def.label}, ${def.unit}, ${value}, ${cleanString(entry.source) || null})
      ON CONFLICT (tenant_id, key) DO UPDATE
        SET
          label = EXCLUDED.label,
          unit = EXCLUDED.unit,
          value = EXCLUDED.value,
          source = EXCLUDED.source,
          updated_at = NOW()
    `;

    updatedKeys.push(key);

    await writeAuditLog(context.sql, {
      tenantId,
      actorUserId: context.user.id,
      action: "factor.upsert",
      entityType: "factor",
      entityId: key,
      payload: {
        key,
        value,
        source: cleanString(entry.source) || null,
      },
    });
  }

  const rows = await context.sql`
    SELECT tenant_id, key, label, unit, value, source, created_at, updated_at
    FROM emission_factors
    WHERE tenant_id = ${tenantId}
    ORDER BY key ASC
  `;

  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const factors = defaults.map((item) => {
    const row = rowMap.get(item.key) || {
      key: item.key,
      label: item.label,
      unit: item.unit,
      value: null,
      source: null,
      created_at: null,
      updated_at: null,
    };
    return normalizeFactorRow(row, item.required);
  });

  const missingRequiredFactors = factors.filter((item) => item.required && item.value == null).map((item) => item.key);

  return json({
    factors,
    missingRequiredFactors,
    updatedKeys,
  });
}
