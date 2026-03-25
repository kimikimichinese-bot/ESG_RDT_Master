import { getMembership, getSessionContext } from "./auth.js";
import { PLATFORM_ROLES, TENANT_STATUSES, getTenantStatus, incrementTenantUsage } from "./db.js";
import { errorJson, isReadMethod, parseJsonColumn, toIso } from "./http.js";
import { ROLES, canAccessResource } from "./rbac.js";

const API_USAGE_SAMPLE_RATE = (() => {
  const raw = Number.parseInt(process.env.TENANT_API_USAGE_SAMPLE_RATE ?? "5", 10);
  if (!Number.isFinite(raw) || raw < 1) {
    return 5;
  }
  return Math.min(raw, 20);
})();

const shouldSampleTenantApiUsage = () => Math.random() < 1 / API_USAGE_SAMPLE_RATE;

const maybeTrackTenantApiCall = async (request, sql, tenantId) => {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/v1/tenants/")) {
    return;
  }
  if (!shouldSampleTenantApiUsage()) {
    return;
  }
  await incrementTenantUsage(sql, tenantId, { apiCallsCount: API_USAGE_SAMPLE_RATE });
};

export const parsePagination = (request, defaults = { limit: 100, max: 250 }) => {
  const url = new URL(request.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), defaults.max)
    : Math.min(defaults.limit, defaults.max);
  return { limit };
};

export const requireWriteAllowed = async (request, preloadedContext = null) => {
  const context = preloadedContext || (await getSessionContext(request));
  if (context?.error) {
    return {
      response: errorJson(context.error, context.status || 401),
    };
  }
  if (isReadMethod(request.method || "GET")) {
    return { context };
  }
  if (context.impersonationReadOnly) {
    return {
      response: errorJson("Write blocked during read-only impersonation", 403, {
        code: "impersonation_read_only",
      }),
    };
  }
  return { context };
};

export const requireAuthContext = async (request, { enforceWrite = true } = {}) => {
  const context = await getSessionContext(request);
  if (context?.error) {
    return {
      response: errorJson(context.error, context.status || 401),
    };
  }
  if (enforceWrite) {
    const writeCheck = await requireWriteAllowed(request, context);
    if (writeCheck.response) {
      return writeCheck;
    }
  }
  return { context };
};

export const requireAuth = async (request, options = {}) => requireAuthContext(request, options);

export const requirePlatformRole = async (request, allowedRoles = [PLATFORM_ROLES.SUPERADMIN], options = {}) => {
  const auth = await requireAuthContext(request, options);
  if (auth.response) {
    return auth;
  }

  const { context } = auth;
  const normalizedAllowed = Array.isArray(allowedRoles) && allowedRoles.length > 0
    ? allowedRoles
    : [PLATFORM_ROLES.SUPERADMIN];
  if (!normalizedAllowed.includes(context.platformRole)) {
    return {
      response: errorJson("Forbidden for platform role", 403, {
        code: "platform_role_forbidden",
        role: context.platformRole,
      }),
    };
  }
  return { context };
};

export const requireTenantAccess = async (request, tenantId, options = {}) => {
  const auth = await requireAuthContext(request, options);
  if (auth.response) {
    return auth;
  }

  const { context } = auth;
  if (!tenantId || typeof tenantId !== "string") {
    return { response: errorJson("Missing tenant id", 400) };
  }

  const membership = getMembership(context.memberships, tenantId);
  if (!membership && !context.isSuperadmin) {
    return { response: errorJson("Forbidden for tenant", 403) };
  }

  return {
    context: {
      ...context,
      tenantId,
      membership: membership || null,
    },
  };
};

export const requireTenantActiveOrSuperadmin = async (request, tenantId, preloadedContext = null) => {
  const context = preloadedContext || (await getSessionContext(request));
  if (context?.error) {
    return {
      response: errorJson(context.error, context.status || 401),
    };
  }
  if (context.isSuperadmin) {
    return { context };
  }
  const status = await getTenantStatus(context.sql, tenantId);
  if (!status) {
    return { response: errorJson("Tenant not found", 404) };
  }
  if (status === TENANT_STATUSES.SUSPENDED || status === TENANT_STATUSES.ARCHIVED) {
    return {
      response: errorJson("Tenant is not active", 403, {
        code: status === TENANT_STATUSES.SUSPENDED ? "tenant_suspended" : "tenant_archived",
      }),
    };
  }
  return { context };
};

export const requireTenantContext = async (request, tenantId, resource = "tenant") => {
  const tenantAccess = await requireTenantAccess(request, tenantId);
  if (tenantAccess.response) {
    return tenantAccess;
  }

  const { context } = tenantAccess;
  if (!context.isSuperadmin) {
    if (!context.membership) {
      return { response: errorJson("Forbidden for tenant", 403) };
    }

    if (!canAccessResource(context.membership.role, resource, request.method || "GET")) {
      const isWriteAttempt = !isReadMethod(request.method || "GET");
      const isAuditor = context.membership.role === ROLES.AUDITOR;
      return {
        response: errorJson("Forbidden by role policy", 403, {
          code: isWriteAttempt && isAuditor ? "rbac_read_only" : "forbidden",
          role: context.membership.role,
          resource,
          method: request.method || "GET",
        }),
      };
    }
  }

  const tenantState = await requireTenantActiveOrSuperadmin(request, tenantId, context);
  if (tenantState.response) {
    return tenantState;
  }

  const writeCheck = await requireWriteAllowed(request, context);
  if (writeCheck.response) {
    return writeCheck;
  }

  try {
    await maybeTrackTenantApiCall(request, context.sql, tenantId);
  } catch (_error) {
    // Usage tracking should not block primary tenant workflows.
  }

  return {
    context: {
      ...context,
      tenantId,
      membership: context.membership,
    },
  };
};

export const normalizeTenant = (row) => ({
  id: row.id,
  name: row.name,
  tenantStatus: row.tenant_status || TENANT_STATUSES.ACTIVE,
  createdByUserId: row.created_by_user_id || null,
  internalNotes: row.internal_notes || null,
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
  storageBackend: row.storage_backend || (row.external_file_id ? "onedrive" : row.blob_url ? "vercel_blob" : "vercel_blob"),
  storageKey: row.storage_key || null,
  externalFileId: row.external_file_id || null,
  externalDriveId: row.external_drive_id || null,
  externalParentId: row.external_parent_id || null,
  externalWebUrl: row.external_web_url || null,
  sourceOfTruth: row.source_of_truth || null,
  storageStatus: row.storage_status || null,
  lastVerifiedAt: toIso(row.last_verified_at),
  issueDate: row.issue_date || null,
  docType: row.doc_type || null,
  scopeCoverage: row.scope_coverage || null,
  isEncrypted: Boolean(row.is_encrypted),
  language: row.language || null,
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
