import { errorJson, isReadMethod, parseJsonColumn, toIso } from "./http.js";
import { getMembership, getSessionContext } from "./auth.js";
import { canAccessResource } from "./rbac.js";

export const parsePagination = (request, defaults = { limit: 100, max: 250 }) => {
  const url = new URL(request.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), defaults.max)
    : Math.min(defaults.limit, defaults.max);
  return { limit };
};

export const requireAuthContext = async (request) => {
  const context = await getSessionContext(request);
  if (context?.error) {
    return {
      response: errorJson(context.error, context.status || 401),
    };
  }
  return { context };
};

export const requireTenantContext = async (request, tenantId, resource = "tenant") => {
  const auth = await requireAuthContext(request);
  if (auth.response) {
    return auth;
  }

  const { context } = auth;
  const membership = getMembership(context.memberships, tenantId);
  if (!membership) {
    return { response: errorJson("Forbidden for tenant", 403) };
  }

  if (!canAccessResource(membership.role, resource, request.method || "GET")) {
    return {
      response: errorJson("Forbidden by role policy", 403, {
        role: membership.role,
        resource,
        method: request.method || "GET",
      }),
    };
  }

  return {
    context: {
      ...context,
      tenantId,
      membership,
    },
  };
};

export const normalizeTenant = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const normalizeSite = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  companyId: row.company_id || null,
  name: row.name,
  country: row.country || null,
  address: row.address,
  waterStressed: Boolean(row.water_stressed),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const normalizeCompany = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  legalName: row.legal_name,
  country: row.country,
  isHolding: Boolean(row.is_holding),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const normalizePerson = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  siteId: (() => {
    const parsedSiteIds = (() => {
      if (Array.isArray(row.site_ids)) {
        return row.site_ids.filter((item) => typeof item === "string" && item.length > 0);
      }
      if (typeof row.site_ids === "string") {
        if (row.site_ids.startsWith("{") && row.site_ids.endsWith("}")) {
          return row.site_ids
            .slice(1, -1)
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
        }
        return row.site_ids.trim() ? [row.site_ids.trim()] : [];
      }
      return [];
    })();
    return row.site_id || parsedSiteIds[0] || null;
  })(),
  siteIds: (() => {
    const ids = [];
    if (Array.isArray(row.site_ids)) {
      for (const item of row.site_ids) {
        if (typeof item === "string" && item.length > 0) {
          ids.push(item);
        }
      }
    } else if (typeof row.site_ids === "string") {
      if (row.site_ids.startsWith("{") && row.site_ids.endsWith("}")) {
        for (const item of row.site_ids.slice(1, -1).split(",")) {
          const normalized = item.trim();
          if (normalized) {
            ids.push(normalized);
          }
        }
      } else if (row.site_ids.trim()) {
        ids.push(row.site_ids.trim());
      }
    }
    if (typeof row.site_id === "string" && row.site_id.length > 0 && !ids.includes(row.site_id)) {
      ids.unshift(row.site_id);
    }
    return ids;
  })(),
  fullName: row.full_name,
  email: row.email,
  title: row.title,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const normalizeActivity = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  siteId: row.site_id,
  activityType: row.activity_type,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  quantity: Number(row.quantity),
  unit: row.unit,
  notes: row.notes,
  evidenceId: row.evidence_id,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const normalizeEvidence = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  siteId: row.site_id,
  filename: row.filename,
  contentType: row.content_type,
  sizeBytes: Number(row.size_bytes ?? 0),
  sha256: row.sha256,
  blobUrl: row.blob_url,
  createdAt: toIso(row.created_at),
});

export const normalizeAudit = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  actorUserId: row.actor_user_id,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  payload: parseJsonColumn(row.payload),
  createdAt: toIso(row.created_at),
});

export const methodNotAllowed = (allowed) =>
  errorJson("Method not allowed", 405, {
    allowed,
  });

export const canMutate = (method) => !isReadMethod(method);
