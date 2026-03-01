import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { ensureDefaultEmissionFactorsForTenant, ensureEnterpriseSchema, ensureHoldingCompanyForTenant, getSql } from "./db.js";
import { cleanString } from "./http.js";

const SESSION_COOKIE_NAME = "esg_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const toBase64Url = (value) => Buffer.from(value, "utf8").toString("base64url");
const fromBase64Url = (value) => Buffer.from(value, "base64url").toString("utf8");

const getAuthSecret = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error("Missing AUTH_SECRET");
  }
  return secret.trim();
};

const signValue = (value) => createHmac("sha256", getAuthSecret()).update(value).digest("base64url");

const parseCookieHeader = (header) => {
  const jar = {};
  const raw = header || "";
  const chunks = raw.split(";");
  for (const chunk of chunks) {
    const [key, ...rest] = chunk.trim().split("=");
    if (!key) {
      continue;
    }
    jar[key] = rest.join("=");
  }
  return jar;
};

const toSessionPayload = (payload) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    userId: payload.userId,
    activeTenantId: payload.activeTenantId || null,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
};

export const hashPassword = (password) => {
  const source = cleanString(password);
  if (source.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(source, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
};

export const verifyPassword = (password, stored) => {
  const source = cleanString(password);
  if (!stored || typeof stored !== "string") {
    return false;
  }

  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) {
    return false;
  }

  const computed = scryptSync(source, salt, 64).toString("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

export const encodeSession = (payload) => {
  const body = toBase64Url(JSON.stringify(toSessionPayload(payload)));
  const signature = signValue(body);
  return `${body}.${signature}`;
};

export const decodeSession = (token) => {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = signValue(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(body));
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.userId || !payload?.exp || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
};

export const buildSessionCookie = (payload) => {
  const token = encodeSession(payload);
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
};

export const buildClearSessionCookie = () => {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
};

export const readSessionFromRequest = (request) => {
  const cookies = parseCookieHeader(request.headers.get("cookie") || "");
  return decodeSession(cookies[SESSION_COOKIE_NAME]);
};

export const readSessionFromCookieStore = (cookieStore) => {
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return decodeSession(token);
};

export const getUserCount = async (sql) => {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM users`;
  const count = Number(rows?.[0]?.count);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Invalid users count payload");
  }
  return count;
};

export const getBootstrapCounts = async (sql) => {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users_count,
      (SELECT COUNT(*)::int FROM tenants) AS tenants_count,
      (SELECT COUNT(*)::int FROM memberships) AS memberships_count
  `;

  const row = rows?.[0];
  const usersCount = Number(row?.users_count);
  const tenantsCount = Number(row?.tenants_count);
  const membershipsCount = Number(row?.memberships_count);

  if (
    !Number.isInteger(usersCount) ||
    usersCount < 0 ||
    !Number.isInteger(tenantsCount) ||
    tenantsCount < 0 ||
    !Number.isInteger(membershipsCount) ||
    membershipsCount < 0
  ) {
    throw new Error("Invalid bootstrap count payload");
  }

  return {
    usersCount,
    tenantsCount,
    membershipsCount,
  };
};

const normalizeMembership = (row) => ({
  tenantId: row.tenant_id,
  tenantName: row.tenant_name,
  role: row.role,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
});

const normalizeUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export const getUserWithMemberships = async (sql, userId) => {
  const userRows = await sql`
    SELECT id, email, name, created_at, updated_at
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  if (!userRows?.[0]) {
    return null;
  }

  const memberships = await sql`
    SELECT m.tenant_id, t.name AS tenant_name, m.role, m.created_at
    FROM memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = ${userId}
    ORDER BY t.name ASC
  `;

  return {
    user: normalizeUser(userRows[0]),
    memberships: memberships.map((row) => normalizeMembership(row)),
  };
};

export const getMembership = (memberships, tenantId) => memberships.find((item) => item.tenantId === tenantId) || null;

export const createTenantAndAdmin = async ({ tenantName, email, name, password }) => {
  await ensureEnterpriseSchema();
  const sql = getSql();

  const cleanedTenantName = cleanString(tenantName) || "Default Tenant";
  const cleanedName = cleanString(name) || "Tenant Admin";
  const cleanedEmail = cleanString(email).toLowerCase();
  const cleanedPassword = cleanString(password);

  if (!cleanedEmail.includes("@")) {
    return { error: "Valid email is required", status: 400 };
  }

  if (cleanedPassword.length < 8) {
    return { error: "Password must be at least 8 characters", status: 400 };
  }

  const existingUserRows = await sql`
    SELECT id
    FROM users
    WHERE email = ${cleanedEmail}
    LIMIT 1
  `;

  if (existingUserRows?.[0]) {
    return {
      error: "User already exists, go to login",
      status: 409,
      code: "USER_EXISTS",
    };
  }

  const counts = await getBootstrapCounts(sql);
  if (counts.usersCount > 0) {
    return {
      error: "Setup already completed",
      status: 409,
      code: "SETUP_COMPLETED",
    };
  }

  const passwordHash = hashPassword(cleanedPassword);
  const userId = randomUUID();

  const tenantByNameRows = await sql`
    SELECT id
    FROM tenants
    WHERE LOWER(name) = LOWER(${cleanedTenantName})
    ORDER BY created_at ASC
    LIMIT 1
  `;

  const existingTenantId = tenantByNameRows?.[0]?.id || null;
  const tenantId = existingTenantId || randomUUID();

  try {
    const queries = [];
    if (!existingTenantId) {
      queries.push(sql`
        INSERT INTO tenants (id, name)
        VALUES (${tenantId}, ${cleanedTenantName})
      `);
    }
    queries.push(sql`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (${userId}, ${cleanedEmail}, ${cleanedName}, ${passwordHash})
    `);
    queries.push(sql`
      INSERT INTO memberships (user_id, tenant_id, role)
      VALUES (${userId}, ${tenantId}, 'TenantAdmin')
      ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET role = EXCLUDED.role
    `);

    await sql.transaction(queries);
    await ensureHoldingCompanyForTenant(sql, tenantId, cleanedTenantName);
    await ensureDefaultEmissionFactorsForTenant(sql, tenantId);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return {
        error: "User already exists, go to login",
        status: 409,
        code: "USER_EXISTS",
      };
    }
    throw error;
  }

  return {
    userId,
    tenantId,
  };
};

export const authenticateWithPassword = async ({ email, password }) => {
  await ensureEnterpriseSchema();
  const sql = getSql();

  const cleanedEmail = cleanString(email).toLowerCase();
  if (!cleanedEmail || !password) {
    return { error: "Email and password are required", status: 400, code: "MISSING_CREDENTIALS" };
  }

  const rows = await sql`
    SELECT id, email, name, password_hash
    FROM users
    WHERE email = ${cleanedEmail}
    LIMIT 1
  `;

  const user = rows?.[0];
  if (!user) {
    return { error: "Invalid credentials", status: 401, code: "INVALID_CREDENTIALS" };
  }

  if (!verifyPassword(password, user.password_hash)) {
    return { error: "Invalid credentials", status: 401, code: "INVALID_CREDENTIALS" };
  }

  const memberships = await sql`
    SELECT tenant_id, role
    FROM memberships
    WHERE user_id = ${user.id}
    ORDER BY created_at ASC
  `;

  if (!memberships.length) {
    return { error: "User has no tenant membership", status: 403, code: "NO_MEMBERSHIP" };
  }

  return {
    userId: user.id,
    activeTenantId: memberships[0].tenant_id,
  };
};

export const getSessionContext = async (request) => {
  await ensureEnterpriseSchema();
  const sql = getSql();
  const session = readSessionFromRequest(request);

  if (!session?.userId) {
    return { error: "Unauthorized", status: 401 };
  }

  const data = await getUserWithMemberships(sql, session.userId);
  if (!data?.user) {
    return { error: "Unauthorized", status: 401 };
  }

  if (!Array.isArray(data.memberships) || data.memberships.length === 0) {
    return { error: "User has no tenant membership", status: 403 };
  }

  const activeTenantId =
    session.activeTenantId && data.memberships.some((item) => item.tenantId === session.activeTenantId)
      ? session.activeTenantId
      : data.memberships[0].tenantId;

  return {
    sql,
    session,
    user: data.user,
    memberships: data.memberships,
    activeTenantId,
  };
};

export const createSessionPayload = ({ userId, activeTenantId }) => ({
  userId,
  activeTenantId,
});

export const issueSessionForUser = async (userId, preferredTenantId = null) => {
  await ensureEnterpriseSchema();
  const sql = getSql();
  const data = await getUserWithMemberships(sql, userId);
  if (!data?.user || data.memberships.length === 0) {
    return null;
  }

  const activeTenantId =
    preferredTenantId && data.memberships.some((item) => item.tenantId === preferredTenantId)
      ? preferredTenantId
      : data.memberships[0].tenantId;

  return {
    token: encodeSession({ userId, activeTenantId }),
    cookie: buildSessionCookie({ userId, activeTenantId }),
    activeTenantId,
    user: data.user,
    memberships: data.memberships,
  };
};

export const randomId = () => randomUUID();

export { SESSION_COOKIE_NAME };
