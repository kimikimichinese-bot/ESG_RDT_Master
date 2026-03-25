#!/usr/bin/env node
import { neon } from "@neondatabase/serverless";

const REQUIRED_CONFIRM = "YES";
const requiredEnv = {
  CONFIRM_LOCAL_CLEANUP: process.env.CONFIRM_LOCAL_CLEANUP,
  APP_ENV: process.env.APP_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};

if (requiredEnv.CONFIRM_LOCAL_CLEANUP !== REQUIRED_CONFIRM || requiredEnv.APP_ENV !== "local") {
  console.error("Refusing to run cleanup.");
  console.error("Required:");
  console.error("  APP_ENV=local");
  console.error("  CONFIRM_LOCAL_CLEANUP=YES");
  console.error("Example:");
  console.error("  APP_ENV=local CONFIRM_LOCAL_CLEANUP=YES DATABASE_URL=... node scripts/dev/cleanup-local-data.mjs");
  process.exit(1);
}

if (!requiredEnv.DATABASE_URL || !requiredEnv.DATABASE_URL.trim()) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sql = neon(requiredEnv.DATABASE_URL.trim());

const KEEP_SUPER_EMAIL = "superadmin@windwardnexus.local";
const KEEP_ADMIN_EMAIL = "admin@demoholding.local";
const KEEP_EMAILS = [KEEP_SUPER_EMAIL, KEEP_ADMIN_EMAIL];

const tableExists = async (tableName) => {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
    LIMIT 1
  `;
  return rows.length > 0;
};

const runDeleteAll = async (tableName) => {
  if (!(await tableExists(tableName))) {
    return { table: tableName, deleted: false, reason: "missing" };
  }
  await sql.unsafe(`DELETE FROM "${tableName}"`);
  return { table: tableName, deleted: true };
};

const transactionalTables = [
  "entity_evidence",
  "site_metrics",
  "ghg_activity_records",
  "ghg_emissions_results",
  "social_records",
  "workforce_monthly",
  "leavers_yearly",
  "management_kpis_yearly",
  "social_company_flags",
  "governance_policies",
  "governance_yearly",
  "materiality_selected_topics",
  "materiality_scores",
  "ecovadis_answer_evidence",
  "ecovadis_answers",
  "ecovadis_options",
  "ecovadis_questions",
  "ecovadis_assessments",
  "activities",
  "answers",
  "questions",
  "projects",
  "audit_log",
  "jobs",
  "evidence",
];

const main = async () => {
  const summary = [];

  const users = await sql`
    SELECT id, email
    FROM users
    WHERE LOWER(email) = ANY(${KEEP_EMAILS.map((item) => item.toLowerCase())})
  `;

  if (users.length !== 2) {
    throw new Error(
      `Expected 2 keeper users (${KEEP_EMAILS.join(", ")}), found ${users.length}. Seed users first and retry cleanup.`,
    );
  }

  const keepUserIds = users.map((row) => row.id);

  for (const tableName of transactionalTables) {
    // eslint-disable-next-line no-await-in-loop
    summary.push(await runDeleteAll(tableName));
  }

  if (await tableExists("memberships")) {
    await sql`
      DELETE FROM memberships
      WHERE user_id <> ALL(${keepUserIds})
    `;
  }

  if (await tableExists("users")) {
    await sql`
      DELETE FROM users
      WHERE id <> ALL(${keepUserIds})
    `;
  }

  await sql`
    UPDATE users
    SET platform_role = CASE
      WHEN LOWER(email) = ${KEEP_SUPER_EMAIL.toLowerCase()} THEN 'superadmin'
      ELSE 'none'
    END,
    updated_at = NOW()
    WHERE id = ANY(${keepUserIds})
  `;

  const tenantRows = await sql`
    SELECT DISTINCT t.id
    FROM tenants t
    LEFT JOIN memberships m ON m.tenant_id = t.id
    WHERE m.user_id = ANY(${keepUserIds})
    ORDER BY t.id ASC
  `;

  let targetTenantId = tenantRows?.[0]?.id || null;
  if (!targetTenantId) {
    const fallbackTenant = await sql`
      SELECT id
      FROM tenants
      ORDER BY created_at ASC
      LIMIT 1
    `;
    targetTenantId = fallbackTenant?.[0]?.id || null;
  }

  if (!targetTenantId) {
    throw new Error("No tenant available. Create at least one tenant before cleanup.");
  }

  for (const userId of keepUserIds) {
    // eslint-disable-next-line no-await-in-loop
    await sql`
      INSERT INTO memberships (user_id, tenant_id, role, created_at)
      VALUES (${userId}, ${targetTenantId}, 'TenantAdmin', NOW())
      ON CONFLICT (user_id, tenant_id)
      DO UPDATE SET role = EXCLUDED.role
    `;
  }

  if (process.env.ARCHIVE_EXTRA_TENANTS === "true" && (await tableExists("tenants"))) {
    await sql`
      UPDATE tenants
      SET tenant_status = CASE WHEN id = ${targetTenantId} THEN tenant_status ELSE 'archived' END,
          updated_at = NOW()
    `;
  }

  console.log("Local cleanup completed.");
  console.log(`Kept users: ${KEEP_EMAILS.join(", ")}`);
  console.log(`Primary tenant for memberships: ${targetTenantId}`);
  console.log("Transactional tables cleaned:");
  for (const row of summary) {
    const status = row.deleted ? "deleted" : `skipped (${row.reason})`;
    console.log(`  - ${row.table}: ${status}`);
  }
};

main().catch((error) => {
  console.error("cleanup-local-data failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
