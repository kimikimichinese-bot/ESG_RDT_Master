import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { EMISSION_FACTOR_DEFINITIONS, METRIC_DEFINITIONS } from "./esg-domain.js";
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

const normalizeHoldingCompanyName = (value) => {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || "Holding";
};

export const ensureHoldingCompanyForTenant = async (sql, tenantId, tenantName = "Holding") => {
  const existingRows = await sql`
    SELECT id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    FROM companies
    WHERE tenant_id = ${tenantId} AND is_holding = TRUE
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (existingRows?.[0]) {
    return existingRows[0];
  }

  const preferredName = normalizeHoldingCompanyName(tenantName);
  const candidateNames = [...new Set([preferredName, "Holding", `${preferredName} Holding`])];

  for (const candidateName of candidateNames) {
    const rows = await sql`
      INSERT INTO companies (id, tenant_id, name, legal_name, country, is_holding)
      VALUES (${randomUUID()}, ${tenantId}, ${candidateName}, NULL, NULL, TRUE)
      ON CONFLICT (tenant_id, name) DO NOTHING
      RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
    `;
    if (rows?.[0]) {
      return rows[0];
    }
  }

  const fallbackRows = await sql`
    UPDATE companies
    SET is_holding = TRUE, updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM companies
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
  `;
  if (fallbackRows?.[0]) {
    return fallbackRows[0];
  }

  const insertedRows = await sql`
    INSERT INTO companies (id, tenant_id, name, legal_name, country, is_holding)
    VALUES (${randomUUID()}, ${tenantId}, 'Holding', NULL, NULL, TRUE)
    RETURNING id, tenant_id, name, legal_name, country, is_holding, created_at, updated_at
  `;
  return insertedRows?.[0] || null;
};

export const ensureDefaultEmissionFactorsForTenant = async (sql, tenantId) => {
  for (const definition of EMISSION_FACTOR_DEFINITIONS) {
    await sql`
      INSERT INTO emission_factors (tenant_id, key, label, unit, value, source)
      VALUES (${tenantId}, ${definition.key}, ${definition.label}, ${definition.unit}, NULL, NULL)
      ON CONFLICT (tenant_id, key) DO UPDATE SET
        label = EXCLUDED.label,
        unit = EXCLUDED.unit
    `;
  }
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
        CREATE TABLE IF NOT EXISTS companies (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          legal_name TEXT NULL,
          country TEXT NULL,
          is_holding BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS company_id UUID NULL`;
      await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS water_stressed BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE sites ALTER COLUMN country DROP NOT NULL`;
      await sql`ALTER TABLE sites ALTER COLUMN country DROP DEFAULT`;

      await sql`
        CREATE TABLE IF NOT EXISTS entity_evidence (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL,
          entity_id UUID NOT NULL,
          evidence_id UUID NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, entity_type, entity_id, evidence_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS metric_definitions (
          key TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          unit TEXT NOT NULL,
          description TEXT NULL,
          is_required BOOLEAN NOT NULL DEFAULT FALSE,
          validation JSONB NULL
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS site_metrics (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          metric_key TEXT NOT NULL REFERENCES metric_definitions(key) ON DELETE RESTRICT,
          value NUMERIC NOT NULL,
          unit TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS workforce_monthly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
          contract_type TEXT NOT NULL CHECK (contract_type IN ('total', 'permanent', 'temporary')),
          gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'D')),
          headcount INTEGER NOT NULL CHECK (headcount >= 0),
          hours_worked NUMERIC NOT NULL CHECK (hours_worked >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, site_id, reporting_year, month, contract_type, gender)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS workforce_leavers_monthly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
          gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'D')),
          leavers INTEGER NOT NULL CHECK (leavers >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, site_id, reporting_year, month, gender)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS management_headcount_yearly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'D')),
          headcount INTEGER NOT NULL CHECK (headcount >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, site_id, reporting_year, gender)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS company_year_flags (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          gender_pay_gap_reported BOOLEAN NOT NULL DEFAULT FALSE,
          scope3_screening_performed BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, reporting_year)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS emission_factors (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          unit TEXT NOT NULL,
          value NUMERIC NULL,
          source TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, key)
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
          file_base64 TEXT NULL,
          storage_kind TEXT NOT NULL DEFAULT 'db',
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
      await sql`CREATE INDEX IF NOT EXISTS idx_sites_tenant_company_created_at ON sites (tenant_id, company_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_tenant_created_at ON people (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_sites_tenant_site ON people_sites (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_sites_tenant_person ON people_sites (tenant_id, person_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activities_tenant_created_at ON activities (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_evidence_tenant_created_at ON evidence (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created_at ON audit_log (tenant_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_companies_tenant_created_at ON companies (tenant_id, created_at DESC)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tenant_name_unique ON companies (tenant_id, name)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_year ON site_metrics (tenant_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_company_year ON site_metrics (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_metrics_tenant_site_year ON site_metrics (tenant_id, site_id, reporting_year)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_site_metrics_unique_site_year_key ON site_metrics (tenant_id, site_id, reporting_year, metric_key)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_entity_evidence_lookup ON entity_evidence (tenant_id, entity_type, entity_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_workforce_tenant_company_year ON workforce_monthly (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_workforce_tenant_site_year ON workforce_monthly (tenant_id, site_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leavers_tenant_company_year ON workforce_leavers_monthly (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leavers_tenant_site_year ON workforce_leavers_monthly (tenant_id, site_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_management_tenant_company_year ON management_headcount_yearly (tenant_id, company_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_management_tenant_site_year ON management_headcount_yearly (tenant_id, site_id, reporting_year)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_company_year_flags_lookup ON company_year_flags (tenant_id, reporting_year, company_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_emission_factors_lookup ON emission_factors (tenant_id, key)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_people_tenant_site ON people (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activities_tenant_site ON activities (tenant_id, site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_evidence_tenant_site ON evidence (tenant_id, site_id)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_tenant_name_unique ON sites (tenant_id, name)`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_people_tenant_email_unique
        ON people (tenant_id, LOWER(email))
        WHERE email IS NOT NULL
      `;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS file_base64 TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS storage_kind TEXT NOT NULL DEFAULT 'db'`;
      await sql`
        UPDATE evidence
        SET storage_kind = CASE
          WHEN blob_url IS NOT NULL AND blob_url <> '' THEN 'blob'
          ELSE 'db'
        END
        WHERE storage_kind IS NULL OR storage_kind = ''
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

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'sites_company_id_fkey'
          ) THEN
            ALTER TABLE sites
              ADD CONSTRAINT sites_company_id_fkey
              FOREIGN KEY (company_id)
              REFERENCES companies(id)
              ON DELETE RESTRICT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'entity_evidence_evidence_id_fkey'
          ) THEN
            ALTER TABLE entity_evidence
              ADD CONSTRAINT entity_evidence_evidence_id_fkey
              FOREIGN KEY (evidence_id)
              REFERENCES evidence(id)
              ON DELETE CASCADE;
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

      const tenantRows = await sql`
        SELECT id, name
        FROM tenants
      `;
      for (const tenant of tenantRows) {
        await ensureHoldingCompanyForTenant(sql, tenant.id, tenant.name);
      }

      await sql`
        WITH ranked AS (
          SELECT
            id,
            tenant_id,
            ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, id ASC) AS rn
          FROM companies
          WHERE is_holding = TRUE
        )
        UPDATE companies c
        SET is_holding = FALSE, updated_at = NOW()
        FROM ranked r
        WHERE c.id = r.id
          AND r.rn > 1
      `;

      await sql`
        UPDATE sites s
        SET company_id = c.id
        FROM companies c
        WHERE s.tenant_id = c.tenant_id
          AND c.is_holding = TRUE
          AND s.company_id IS NULL
      `;

      await sql`
        UPDATE sites
        SET company_id = fallback_company.company_id
        FROM (
          SELECT DISTINCT ON (c.tenant_id) c.tenant_id, c.id AS company_id
          FROM companies c
          ORDER BY c.tenant_id, c.is_holding DESC, c.created_at ASC
        ) fallback_company
        WHERE sites.company_id IS NULL
          AND fallback_company.tenant_id = sites.tenant_id
      `;

      await sql`ALTER TABLE sites ALTER COLUMN company_id SET NOT NULL`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_single_holding_per_tenant ON companies (tenant_id) WHERE is_holding = TRUE`;

      for (const definition of METRIC_DEFINITIONS) {
        await sql`
          INSERT INTO metric_definitions (key, category, label, unit, description, is_required, validation)
          VALUES (
            ${definition.key},
            ${definition.category},
            ${definition.label},
            ${definition.unit},
            ${definition.description || null},
            ${Boolean(definition.isRequired)},
            ${JSON.stringify(definition.validation || null)}
          )
          ON CONFLICT (key) DO UPDATE SET
            category = EXCLUDED.category,
            label = EXCLUDED.label,
            unit = EXCLUDED.unit,
            description = EXCLUDED.description,
            is_required = EXCLUDED.is_required,
            validation = EXCLUDED.validation
        `;
      }

      for (const definition of EMISSION_FACTOR_DEFINITIONS) {
        await sql`
          INSERT INTO emission_factors (tenant_id, key, label, unit, value, source)
          SELECT t.id, ${definition.key}, ${definition.label}, ${definition.unit}, NULL, NULL
          FROM tenants t
          ON CONFLICT (tenant_id, key) DO UPDATE SET
            label = EXCLUDED.label,
            unit = EXCLUDED.unit
        `;
      }

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
