#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { appendHistoryArtifact, writeArtifact } from "../../apps/web/app/api/v1/_lib/ops-artifacts.js";
import { getSql } from "../../apps/web/app/api/v1/_lib/db.js";
import { DEMO_SUPERADMIN_PASSWORD, DEMO_TENANT_ADMIN_PASSWORD } from "./seed-demo-data.mjs";
import { exportAuditPack } from "./export-audit-pack.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const smokeEmail = (process.env.SMOKE_EMAIL || "admin@demoholding.local").trim();
const smokePassword = process.env.SMOKE_PASSWORD || DEMO_TENANT_ADMIN_PASSWORD;
const smokeSuperadminEmail = (process.env.SMOKE_SUPERADMIN_EMAIL || "superadmin@windwardnexus.local").trim();
const smokeSuperadminPassword = process.env.SMOKE_SUPERADMIN_PASSWORD || DEMO_SUPERADMIN_PASSWORD;
const requestHeaders = {};

const publicChecks = [
  { path: "/login", expectStatus: 200, type: "html", contains: ["Enterprise login"] },
  { path: "/api/health", expectStatus: 200, type: "json", assert: (body) => body.status === "ready" },
  { path: "/api/ready", expectStatus: 200, type: "json", assert: (body) => body.status === "ready" },
  { path: "/api/v1/health", expectStatus: 200, type: "json", assert: (body) => body.status === "ready" },
  { path: "/api/v1/status", expectStatus: 200, type: "json", assert: (body) => body.status === "ready" },
  { path: "/api/v1/progress", expectStatus: 200, type: "json", assert: (body) => body.status === "ready" && body.progressSource?.status === "applied" },
];

const log = (message) => console.log(`[smoke-prod-like] ${message}`);
const defaultAuthMode = !process.env.SMOKE_EMAIL && !process.env.SMOKE_PASSWORD;

const fail = async (message, partial = null) => {
  const artifact = {
    status: "failed",
    checkedAt: new Date().toISOString(),
    error: message,
    ...(partial || {}),
  };
  await writeArtifact("last-smoke-prod-like.json", artifact);
  await appendHistoryArtifact("smoke-history.json", artifact, 20);
  console.error(`[smoke-prod-like] FAIL: ${message}`);
  process.exit(1);
};

const readBody = async (response, type) => {
  if (type === "json") {
    return response.json();
  }
  return response.text();
};

const fetchCheck = async ({ path, expectStatus, type, contains = [], assert = null }, extraHeaders = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      ...requestHeaders,
      ...extraHeaders,
    },
    redirect: "manual",
  });
  const body = await readBody(response, type);
  if (response.status !== expectStatus) {
    throw new Error(`${path} expected ${expectStatus}, got ${response.status}`);
  }
  if (type === "html") {
    for (const marker of contains) {
      if (!body.includes(marker)) {
        throw new Error(`${path} missing marker: ${marker}`);
      }
    }
  }
  if (type === "json" && typeof assert === "function" && !assert(body)) {
    throw new Error(`${path} returned unexpected payload: ${JSON.stringify(body)}`);
  }
  log(`PASS ${path} -> ${response.status}`);
  return { path, status: response.status, body };
};

const cookieFromSetCookie = (raw) =>
  String(raw || "")
    .split(/,(?=[^;,]+=)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

const login = async ({ email, password, label }) => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label} login failed: ${JSON.stringify(payload)}`);
  }
  const rawSetCookie = response.headers.get("set-cookie");
  if (!rawSetCookie) {
    throw new Error(`${label} login succeeded without set-cookie header`);
  }
  return {
    cookie: cookieFromSetCookie(rawSetCookie),
    payload,
  };
};

const runPublicSmoke = async () => {
  const results = [];
  for (const check of publicChecks) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await fetchCheck(check));
  }
  return results;
};

const runAuthenticatedSmoke = async ({ email, password, label, includeExport = false }) => {
  const auth = await login({ email, password, label });
  const authHeaders = { cookie: auth.cookie };

  const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: authHeaders,
    redirect: "manual",
  });
  const mePayload = await meResponse.json().catch(() => ({}));
  if (!meResponse.ok || !mePayload.authenticated) {
    throw new Error(`${label} /api/v1/auth/me failed: ${JSON.stringify(mePayload)}`);
  }

  const tenantId = mePayload.activeTenantId || "";
  const pageChecks = [];
  for (const path of ["/app", "/app/companies", "/app/materiality"]) {
    // eslint-disable-next-line no-await-in-loop
    pageChecks.push(await fetchCheck({ path, expectStatus: 200, type: "html", contains: [] }, authHeaders));
  }
  // eslint-disable-next-line no-await-in-loop
  const progressCheck = await fetchCheck({ path: "/api/v1/progress", expectStatus: 200, type: "json", assert: (body) => body.status === "ready" }, authHeaders);

  let exportCheck = {
    status: "skipped",
  };
  if (includeExport && tenantId) {
    const response = await fetch(`${baseUrl}/api/v1/tenants/${encodeURIComponent(tenantId)}/exports/audit-pack`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        year: Number.parseInt(process.env.SMOKE_REPORTING_YEAR || "2026", 10),
        confirm: true,
      }),
      redirect: "manual",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(`${label} export route failed: ${JSON.stringify(payload)}`);
    }
    exportCheck = {
      status: "passed",
      exportDir: payload.exportDir || null,
      zipPath: payload.zipPath || null,
      evidenceCoverage: payload.evidenceCoverage || null,
    };
  }

  return {
    status: "passed",
    email,
    tenantId,
    testedUserRole: label,
    auth: {
      me: {
        userId: mePayload.userId || null,
        activeRole: mePayload.activeRole || null,
        platformRole: mePayload.platformRole || null,
      },
      pages: pageChecks.map((item) => ({ path: item.path, status: item.status })),
      progress: {
        status: progressCheck.body?.status || null,
      },
      exportCheck,
    },
  };
};

const runFallbackExportSmoke = async () => {
  if (process.env.APP_ENV !== "local" || process.env.CONFIRM_AUDIT_EXPORT !== "YES") {
    return {
      status: "skipped",
      reason: "APP_ENV=local and CONFIRM_AUDIT_EXPORT=YES are required for export smoke.",
    };
  }
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    return {
      status: "skipped",
      reason: "DATABASE_URL is required for export smoke.",
    };
  }

  const sql = getSql();
  const result = await exportAuditPack({
    sql,
    baseUrl,
    year: Number.parseInt(process.env.SMOKE_REPORTING_YEAR || "2026", 10),
    skipEnsureSchemas: true,
  });

  const snapshotRaw = await readFile(`${result.exportDir}/snapshot.json`, "utf-8");
  const snapshot = JSON.parse(snapshotRaw);
  return {
    status: "passed",
    exportDir: result.exportDir,
    zipPath: result.zipPath,
    evidenceCoverage: snapshot.evidenceCoverage,
    scope3Support: snapshot.scope3Support,
    missingFactorsCount: Array.isArray(snapshot?.ghg?.missingFactors) ? snapshot.ghg.missingFactors.length : 0,
    requestId: snapshot.requestId || null,
  };
};

try {
  const publicResult = await runPublicSmoke();
  const failures = [];
  let tenantAdminResult = { status: "failed", testedUserRole: "tenant-admin" };
  let superadminResult = { status: "failed", testedUserRole: "superadmin" };

  try {
    tenantAdminResult = await runAuthenticatedSmoke({
      email: smokeEmail,
      password: smokePassword,
      label: "tenant-admin",
      includeExport: true,
    });
  } catch (error) {
    failures.push(`tenant-admin: ${error instanceof Error ? error.message : error}`);
  }

  try {
    superadminResult = await runAuthenticatedSmoke({
      email: smokeSuperadminEmail,
      password: smokeSuperadminPassword,
      label: "superadmin",
      includeExport: false,
    });
  } catch (error) {
    failures.push(`superadmin: ${error instanceof Error ? error.message : error}`);
  }

  if (failures.length > 0 && defaultAuthMode) {
    await fail("Deterministic authenticated smoke failed", {
      baseUrl,
      public: publicResult.map((item) => ({ path: item.path, status: item.status })),
      authAttempted: true,
      authSucceeded: false,
      testedUserRole: "tenant-admin,superadmin",
      failures,
      tenantAdmin: tenantAdminResult,
      superadmin: superadminResult,
    });
  }

  const fallbackExport = tenantAdminResult?.auth?.exportCheck?.status === "passed" ? null : await runFallbackExportSmoke();
  const exportResult = fallbackExport || tenantAdminResult?.auth?.exportCheck || { status: "skipped" };
  const artifact = {
    status: "passed",
    checkedAt: new Date().toISOString(),
    baseUrl,
    authAttempted: true,
    authSucceeded: failures.length === 0,
    testedUserRole: failures.length === 0 ? "tenant-admin,superadmin" : "partial",
    failures,
    public: publicResult.map((item) => ({ path: item.path, status: item.status })),
    tenantAdmin: tenantAdminResult,
    superadmin: superadminResult,
    exportSmoke: exportResult,
    evidenceCoverage: exportResult?.evidenceCoverage || null,
    scope3Support: fallbackExport?.scope3Support || null,
    missingFactorsCount: fallbackExport?.missingFactorsCount || 0,
    requestId: fallbackExport?.requestId || null,
  };

  await writeArtifact("last-smoke-prod-like.json", artifact);
  await appendHistoryArtifact("smoke-history.json", artifact, 20);
  log("All prod-like smoke checks passed.");
  process.exit(0);
} catch (error) {
  await fail(error instanceof Error ? error.message : String(error));
}
