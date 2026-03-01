import { neon } from "@neondatabase/serverless";
import { ESG_PARAMETER_DEFINITIONS } from "./esg-parameters.js";

const SCHEMA_READY_KEY = "__esg_rdt_jobs_schema_ready__";
const SCHEMA_PROMISE_KEY = "__esg_rdt_jobs_schema_promise__";
const ENTERPRISE_SCHEMA_READY_KEY = "__esg_rdt_enterprise_schema_ready__";
const ENTERPRISE_SCHEMA_PROMISE_KEY = "__esg_rdt_enterprise_schema_promise__";
const ASSESSMENT_SCHEMA_READY_KEY = "__esg_rdt_assessment_schema_ready__";
const ASSESSMENT_SCHEMA_PROMISE_KEY = "__esg_rdt_assessment_schema_promise__";

const LEGACY_TENANT_ID = "00000000-0000-0000-0000-000000000001";

let cachedSql = null;

const getDatabaseUrl = () => {
  const value = process.env.DATABASE_URL;
  if (!value || !value.trim()) {
    throw new Error("Missing DATABASE_URL");
  }
  return value.trim();
};

export const getSql = () => {
  if (!cachedSql) {
    cachedSql = neon(getDatabaseUrl());
  }
  return cachedSql;
};

export const ensureSchema = async () => {
  if (globalThis[SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[SCHEMA_PROMISE_KEY]) {
    globalThis[SCHEMA_PROMISE_KEY] = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          status TEXT NOT NULL,
          input JSONB NOT NULL DEFAULT '{}'::jsonb,
          output JSONB NULL,
          error TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ NULL,
          finished_at TIMESTAMPTZ NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC)`;
      globalThis[SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[SCHEMA_PROMISE_KEY];
};

export const ensureEnterpriseSchema = async () => {
  if (globalThis[ENTERPRISE_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY]) {
    globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS tenants (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS memberships (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, tenant_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS sites (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS people (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE SET NULL,
          full_name TEXT NOT NULL,
          email TEXT NULL,
          title TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS people_sites (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, person_id, site_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS evidence (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id UUID NULL REFERENCES sites(id) ON DELETE SET NULL,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes BIGINT NOT NULL DEFAULT 0,
          sha256 TEXT NULL,
          blob_url TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS activities (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          activity_type TEXT NOT NULL,
          period_start DATE NOT NULL,
          period_end DATE NOT NULL,
          quantity NUMERIC NOT NULL,
          unit TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          evidence_id UUID NULL REFERENCES evidence(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS audit_log (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_tenants_created_at ON tenants (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memberships_tenant_created_at ON memberships (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_memberships_user_created_at ON memberships (user_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sites_tenant_created_at ON sites (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_tenant_created_at ON people (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_sites_tenant_site ON people_sites (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_sites_tenant_person ON people_sites (tenant_id, person_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activities_tenant_created_at ON activities (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_evidence_tenant_created_at ON evidence (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created_at ON audit_log (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_tenant_site ON people (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activities_tenant_site ON activities (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_evidence_tenant_site ON evidence (tenant_id, site_id)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_tenant_name_unique ON sites (tenant_id, name)`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_people_tenant_email_unique
        ON people (tenant_id, LOWER(email))
        WHERE email IS NOT NULL
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'memberships_role_check'
          ) THEN
            ALTER TABLE memberships
              ADD CONSTRAINT memberships_role_check
              CHECK (role IN ('TenantAdmin', 'Manager', 'Personnel', 'Auditor'));
          END IF;
        END $$;
      `;

      await sql`
        INSERT INTO tenants (id, name)
        VALUES (${LEGACY_TENANT_ID}, 'Legacy Tenant')
        ON CONFLICT (id) DO NOTHING
      `;

      await sql`
        INSERT INTO people_sites (tenant_id, person_id, site_id)
        SELECT p.tenant_id, p.id, p.site_id
        FROM people p
        WHERE p.site_id IS NOT NULL
        ON CONFLICT (tenant_id, person_id, site_id) DO NOTHING
      `;

      globalThis[ENTERPRISE_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[ENTERPRISE_SCHEMA_PROMISE_KEY];
};

export const ensureAssessmentSchema = async () => {
  if (globalThis[ASSESSMENT_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY]) {
    globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          tenant_id UUID NULL,
          site_id UUID NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id UUID NULL`;
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_id UUID NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS parameters (
          key TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          options JSONB NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS answers (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          tenant_id UUID NULL,
          parameter_key TEXT NOT NULL REFERENCES parameters(key) ON DELETE CASCADE,
          value JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (project_id, parameter_key)
        )
      `;

      await sql`ALTER TABLE answers ADD COLUMN IF NOT EXISTS tenant_id UUID NULL`;
      await sql`ALTER TABLE answers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

      await sql`
        UPDATE projects
        SET tenant_id = ${LEGACY_TENANT_ID}
        WHERE tenant_id IS NULL
      `;

      await sql`
        UPDATE answers a
        SET tenant_id = p.tenant_id
        FROM projects p
        WHERE a.project_id = p.id
          AND a.tenant_id IS NULL
      `;

      await sql`
        UPDATE answers
        SET tenant_id = ${LEGACY_TENANT_ID}
        WHERE tenant_id IS NULL
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_id_fkey'
          ) THEN
            ALTER TABLE projects
              ADD CONSTRAINT projects_tenant_id_fkey
              FOREIGN KEY (tenant_id)
              REFERENCES tenants(id)
              ON DELETE CASCADE;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'projects_site_id_fkey'
          ) THEN
            ALTER TABLE projects
              ADD CONSTRAINT projects_site_id_fkey
              FOREIGN KEY (site_id)
              REFERENCES sites(id)
              ON DELETE SET NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'answers_tenant_id_fkey'
          ) THEN
            ALTER TABLE answers
              ADD CONSTRAINT answers_tenant_id_fkey
              FOREIGN KEY (tenant_id)
              REFERENCES tenants(id)
              ON DELETE CASCADE;
          END IF;
        END $$;
      `;

      await sql`ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL`;
      await sql`ALTER TABLE answers ALTER COLUMN tenant_id SET NOT NULL`;

      await sql`CREATE INDEX IF NOT EXISTS idx_projects_tenant_created_at ON projects (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_projects_tenant_updated_at ON projects (tenant_id, updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_projects_tenant_site ON projects (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_parameters_category_sort ON parameters (category, sort_order, key)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_answers_tenant_created_at ON answers (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_answers_project_updated_at ON answers (project_id, updated_at DESC)`;

      for (const parameter of ESG_PARAMETER_DEFINITIONS) {
        await sql`
          INSERT INTO parameters (key, category, label, description, type, required, options, sort_order)
          VALUES (
            ${parameter.key},
            ${parameter.category},
            ${parameter.label},
            ${parameter.description},
            ${parameter.type},
            ${parameter.required},
            ${JSON.stringify(parameter.options)},
            ${parameter.sortOrder}
          )
          ON CONFLICT (key) DO UPDATE SET
            category = EXCLUDED.category,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            type = EXCLUDED.type,
            required = EXCLUDED.required,
            options = EXCLUDED.options,
            sort_order = EXCLUDED.sort_order
        `;
      }

      globalThis[ASSESSMENT_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY];
};
