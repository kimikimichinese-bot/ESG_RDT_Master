import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { PLATFORM_ROLES, ensurePlatformSchema, getSql } from "./db.js";
import { getBootstrapCounts, getMembership, getUserWithMemberships, readSessionFromCookieStore } from "./auth.js";

const readRequestId = () => {
  try {
    const headerStore = headers();
    return headerStore.get("x-vercel-id") || headerStore.get("x-request-id") || randomUUID();
  } catch (_error) {
    return randomUUID();
  }
};

const toRenderError = (error) => ({
  requestId: readRequestId(),
  message: error instanceof Error ? error.message : "Unexpected server error",
});

export const getBootstrapMetrics = async ({ ensureSchema = true } = {}) => {
  if (ensureSchema) {
    await ensurePlatformSchema();
  }
  const sql = getSql();
  return getBootstrapCounts(sql);
};

export const getBootstrapStatus = async ({ ensureSchema = true, suppressErrors = false } = {}) => {
  try {
    const { usersCount, superadminsCount, tenantsCount, membershipsCount } = await getBootstrapMetrics({ ensureSchema });
    return {
      userCount: usersCount,
      usersCount,
      superadminsCount,
      tenantsCount,
      membershipsCount,
      needsSetup: superadminsCount === 0,
      unavailable: false,
      renderError: null,
    };
  } catch (error) {
    if (!suppressErrors) {
      throw error;
    }
    return {
      userCount: 0,
      usersCount: 0,
      superadminsCount: 0,
      tenantsCount: 0,
      membershipsCount: 0,
      needsSetup: false,
      unavailable: true,
      renderError: toRenderError(error),
    };
  }
};

export const getServerSessionState = async (cookieStore, { ensureSchema = true, suppressErrors = false } = {}) => {
  try {
    if (ensureSchema) {
      await ensurePlatformSchema();
    }
    const sql = getSql();
    const session = readSessionFromCookieStore(cookieStore);

    if (!session?.userId) {
      return {
        authenticated: false,
        session: null,
        user: null,
        memberships: [],
        activeTenantId: null,
        activeMembership: null,
        platformRole: PLATFORM_ROLES.NONE,
        impersonationReadOnly: false,
        unavailable: false,
        renderError: null,
      };
    }

    const data = await getUserWithMemberships(sql, session.userId);
    if (!data?.user) {
      return {
        authenticated: false,
        session: null,
        user: null,
        memberships: [],
        activeTenantId: null,
        activeMembership: null,
        platformRole: PLATFORM_ROLES.NONE,
        impersonationReadOnly: false,
        unavailable: false,
        renderError: null,
      };
    }

    const isPlatformOperator = data.user.platformRole !== PLATFORM_ROLES.NONE;
    const isSuperadmin = data.user.platformRole === PLATFORM_ROLES.SUPERADMIN;
    const availableTenantRows = isPlatformOperator
      ? await sql`
          SELECT id
          FROM tenants
          ORDER BY created_at ASC
        `
      : [];
    const availableTenantIds = isPlatformOperator
      ? availableTenantRows.map((row) => row.id)
      : data.memberships.map((item) => item.tenantId);
    const activeTenantId =
      session.activeTenantId && availableTenantIds.includes(session.activeTenantId)
        ? session.activeTenantId
        : availableTenantIds[0] || null;
    const impersonationReadOnly = isSuperadmin ? Boolean(session.impersonationReadOnly) : false;

    return {
      authenticated: true,
      session,
      user: data.user,
      memberships: data.memberships,
      activeTenantId,
      activeMembership: activeTenantId ? getMembership(data.memberships, activeTenantId) : null,
      platformRole: data.user.platformRole,
      impersonationReadOnly,
      unavailable: false,
      renderError: null,
    };
  } catch (error) {
    if (!suppressErrors) {
      throw error;
    }
    return {
      authenticated: false,
      session: null,
      user: null,
      memberships: [],
      activeTenantId: null,
      activeMembership: null,
      platformRole: PLATFORM_ROLES.NONE,
      impersonationReadOnly: false,
      unavailable: true,
      renderError: toRenderError(error),
    };
  }
};
