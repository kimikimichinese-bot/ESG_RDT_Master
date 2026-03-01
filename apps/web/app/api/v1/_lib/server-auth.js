import { ensureEnterpriseSchema, getSql } from "./db.js";
import { getBootstrapCounts, getMembership, getUserWithMemberships, readSessionFromCookieStore } from "./auth.js";

export const getBootstrapMetrics = async () => {
  await ensureEnterpriseSchema();
  const sql = getSql();
  return getBootstrapCounts(sql);
};

export const getBootstrapStatus = async () => {
  const { usersCount, tenantsCount, membershipsCount } = await getBootstrapMetrics();
  return {
    userCount: usersCount,
    usersCount,
    tenantsCount,
    membershipsCount,
    needsSetup: usersCount === 0,
  };
};

export const getServerSessionState = async (cookieStore) => {
  await ensureEnterpriseSchema();
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
  };
};
