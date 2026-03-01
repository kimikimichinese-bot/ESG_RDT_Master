import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { ensureEnterpriseSchema, getSql } from "./db.js";
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
    await ensureEnterpriseSchema();
  }
  const sql = getSql();
  return getBootstrapCounts(sql);
};

export const getBootstrapStatus = async ({ ensureSchema = true, suppressErrors = false } = {}) => {
  try {
    const { usersCount, tenantsCount, membershipsCount } = await getBootstrapMetrics({ ensureSchema });
    return {
      userCount: usersCount,
      usersCount,
      tenantsCount,
      membershipsCount,
      needsSetup: usersCount === 0,
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
      await ensureEnterpriseSchema();
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
        unavailable: false,
        renderError: null,
      };
    }

    const data = await getUserWithMemberships(sql, session.userId);
    if (!data?.user || data.memberships.length === 0) {
      return {
        authenticated: false,
        session: null,
        user: null,
        memberships: [],
        activeTenantId: null,
        activeMembership: null,
        unavailable: false,
        renderError: null,
      };
    }

    const activeTenantId =
      session.activeTenantId && data.memberships.some((item) => item.tenantId === session.activeTenantId)
        ? session.activeTenantId
        : data.memberships[0].tenantId;

    return {
      authenticated: true,
      session,
      user: data.user,
      memberships: data.memberships,
      activeTenantId,
      activeMembership: getMembership(data.memberships, activeTenantId),
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
      unavailable: true,
      renderError: toRenderError(error),
    };
  }
};
