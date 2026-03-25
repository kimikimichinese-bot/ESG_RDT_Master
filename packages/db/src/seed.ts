import { neon } from "@neondatabase/serverless";

const getDatabaseUrl = () => {
  const value = process.env.DATABASE_URL;
  if (!value || !value.trim()) {
    throw new Error("Missing DATABASE_URL");
  }
  return value.trim();
};

const toBool = (value: unknown) => value === true || value === "t" || value === "true" || value === 1 || value === "1";

const run = async () => {
  const sql = neon(getDatabaseUrl());
  const now = new Date().toISOString();

  await sql`SELECT 1`;

  await sql`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY,
      owner_name TEXT NOT NULL DEFAULT 'WindwardNexus Labs',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT platform_settings_singleton_check CHECK (id = 1)
    )
  `;

  await sql`
    INSERT INTO platform_settings (id, owner_name)
    VALUES (1, 'WindwardNexus Labs')
    ON CONFLICT (id) DO NOTHING
  `;

  const tenantsExistsRows = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
    ) AS ok
  `;
  const tenantsTableExists = toBool(tenantsExistsRows?.[0]?.ok);

  if (tenantsTableExists) {
    await sql`
      CREATE TABLE IF NOT EXISTS tenant_entitlements (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        plan TEXT NOT NULL DEFAULT 'free',
        max_users INTEGER NOT NULL DEFAULT 5,
        max_evidence_bytes BIGINT NOT NULL DEFAULT 1073741824,
        max_exports_per_month INTEGER NOT NULL DEFAULT 50,
        max_jobs_per_month INTEGER NOT NULL DEFAULT 500,
        modules JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      INSERT INTO tenant_entitlements (tenant_id)
      SELECT id
      FROM tenants
      ON CONFLICT (tenant_id) DO NOTHING
    `;
  }

  console.log(
    JSON.stringify({
      ok: true,
      seededAt: now,
      tables: {
        platformSettings: true,
        tenantEntitlements: tenantsTableExists,
      },
    }),
  );
};

run().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown seed error",
    }),
  );
  process.exit(1);
});
