import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { EMISSION_FACTOR_DEFINITIONS, METRIC_DEFINITIONS } from "./esg-domain.js";
import { ESG_PARAMETER_DEFINITIONS } from "./esg-parameters.js";

const SCHEMA_READY_KEY = "__esg_rdt_jobs_schema_ready__";
const SCHEMA_PROMISE_KEY = "__esg_rdt_jobs_schema_promise__";
const ENTERPRISE_SCHEMA_READY_KEY = "__esg_rdt_enterprise_schema_ready__";
const ENTERPRISE_SCHEMA_PROMISE_KEY = "__esg_rdt_enterprise_schema_promise__";
const SOCIAL_SCHEMA_READY_KEY = "__esg_rdt_social_schema_ready__";
const SOCIAL_SCHEMA_PROMISE_KEY = "__esg_rdt_social_schema_promise__";
const GOVERNANCE_SCHEMA_READY_KEY = "__esg_rdt_governance_schema_ready__";
const GOVERNANCE_SCHEMA_PROMISE_KEY = "__esg_rdt_governance_schema_promise__";
const ASSESSMENT_SCHEMA_READY_KEY = "__esg_rdt_assessment_schema_ready__";
const ASSESSMENT_SCHEMA_PROMISE_KEY = "__esg_rdt_assessment_schema_promise__";
const ECOVADIS_SCHEMA_READY_KEY = "__esg_rdt_ecovadis_schema_ready__";
const ECOVADIS_SCHEMA_PROMISE_KEY = "__esg_rdt_ecovadis_schema_promise__";
const MATERIALITY_SCHEMA_READY_KEY = "__esg_rdt_materiality_schema_ready__";
const MATERIALITY_SCHEMA_PROMISE_KEY = "__esg_rdt_materiality_schema_promise__";

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

export const ensureSocialSchema = async () => {
  if (globalThis[SOCIAL_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[SOCIAL_SCHEMA_PROMISE_KEY]) {
    globalThis[SOCIAL_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      globalThis[SOCIAL_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[SOCIAL_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[SOCIAL_SCHEMA_PROMISE_KEY];
};

export const ensureGovernanceSchema = async () => {
  if (globalThis[GOVERNANCE_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY]) {
    globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS governance_yearly (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          board_total INTEGER NOT NULL DEFAULT 0 CHECK (board_total >= 0),
          board_women INTEGER NOT NULL DEFAULT 0 CHECK (board_women >= 0),
          board_independent INTEGER NOT NULL DEFAULT 0 CHECK (board_independent >= 0),
          board_meetings INTEGER NOT NULL DEFAULT 0 CHECK (board_meetings >= 0),
          anti_corruption_policy BOOLEAN NOT NULL DEFAULT FALSE,
          whistleblowing_channel BOOLEAN NOT NULL DEFAULT FALSE,
          data_privacy_policy BOOLEAN NOT NULL DEFAULT FALSE,
          supplier_code_of_conduct BOOLEAN NOT NULL DEFAULT FALSE,
          gdpr_training BOOLEAN NOT NULL DEFAULT FALSE,
          data_breaches_count INTEGER NOT NULL DEFAULT 0 CHECK (data_breaches_count >= 0),
          corruption_incidents_count INTEGER NOT NULL DEFAULT 0 CHECK (corruption_incidents_count >= 0),
          fines_amount_eur NUMERIC NOT NULL DEFAULT 0 CHECK (fines_amount_eur >= 0),
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, company_id, reporting_year)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS governance_policies (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          policy_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'no' CHECK (status IN ('yes', 'no', 'in_progress')),
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, company_id, reporting_year, policy_key)
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_governance_yearly_lookup
        ON governance_yearly (tenant_id, company_id, reporting_year)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_governance_policies_lookup
        ON governance_policies (tenant_id, company_id, reporting_year, policy_key)
      `;

      globalThis[GOVERNANCE_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[GOVERNANCE_SCHEMA_PROMISE_KEY];
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

export const ensureEcoVadisSchema = async () => {
  if (globalThis[ECOVADIS_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ECOVADIS_SCHEMA_PROMISE_KEY]) {
    globalThis[ECOVADIS_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS issue_date DATE NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS doc_type TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS scope_coverage TEXT NULL`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS language TEXT NULL`;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_assessments (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL,
          reporting_year INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_questions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          assessment_id UUID NOT NULL REFERENCES ecovadis_assessments(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          theme TEXT NOT NULL,
          indicator TEXT NOT NULL,
          text TEXT NOT NULL,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_options (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          question_id UUID NOT NULL REFERENCES ecovadis_questions(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          requires_evidence BOOLEAN NOT NULL DEFAULT TRUE,
          has_free_text BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_answers (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          option_id UUID NOT NULL REFERENCES ecovadis_options(id) ON DELETE CASCADE,
          selected BOOLEAN NOT NULL DEFAULT FALSE,
          free_text TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ecovadis_answer_evidence (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          answer_id UUID NOT NULL REFERENCES ecovadis_answers(id) ON DELETE CASCADE,
          evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
          pages TEXT NOT NULL,
          comment TEXT NULL,
          visibility TEXT NOT NULL DEFAULT 'private',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, answer_id, evidence_id)
        )
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'evidence_doc_type_check'
          ) THEN
            ALTER TABLE evidence
            ADD CONSTRAINT evidence_doc_type_check
            CHECK (
              doc_type IS NULL
              OR doc_type IN ('policy', 'action', 'reporting', 'audit', 'certification', 'other')
            );
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'evidence_scope_coverage_check'
          ) THEN
            ALTER TABLE evidence
            ADD CONSTRAINT evidence_scope_coverage_check
            CHECK (
              scope_coverage IS NULL
              OR scope_coverage IN ('tenant', 'company', 'site')
            );
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ecovadis_scope_type_check'
          ) THEN
            ALTER TABLE ecovadis_assessments
            ADD CONSTRAINT ecovadis_scope_type_check
            CHECK (scope_type IN ('Group', 'Entity', 'Site'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ecovadis_status_check'
          ) THEN
            ALTER TABLE ecovadis_assessments
            ADD CONSTRAINT ecovadis_status_check
            CHECK (status IN ('draft', 'ready', 'submitted'));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ecovadis_answer_evidence_visibility_check'
          ) THEN
            ALTER TABLE ecovadis_answer_evidence
            ADD CONSTRAINT ecovadis_answer_evidence_visibility_check
            CHECK (visibility IN ('private', 'public'));
          END IF;
        END $$;
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ecovadis_assessment_scope_unique
        ON ecovadis_assessments (tenant_id, company_id, reporting_year, scope_type)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_assessments_tenant_updated
        ON ecovadis_assessments (tenant_id, updated_at DESC)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ecovadis_questions_unique_code
        ON ecovadis_questions (tenant_id, assessment_id, code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_questions_assessment_sort
        ON ecovadis_questions (tenant_id, assessment_id, sort_order)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_options_question_sort
        ON ecovadis_options (tenant_id, question_id, sort_order)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ecovadis_answers_option_unique
        ON ecovadis_answers (tenant_id, option_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_answers_tenant_updated
        ON ecovadis_answers (tenant_id, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_ecovadis_answer_evidence_lookup
        ON ecovadis_answer_evidence (tenant_id, answer_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_evidence_issue_date
        ON evidence (tenant_id, issue_date DESC)
      `;

      globalThis[ECOVADIS_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[ECOVADIS_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[ECOVADIS_SCHEMA_PROMISE_KEY];
};

export const ensureMaterialitySchema = async () => {
  if (globalThis[MATERIALITY_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[MATERIALITY_SCHEMA_PROMISE_KEY]) {
    globalThis[MATERIALITY_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureEnterpriseSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_topics (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_stakeholders (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          weight NUMERIC NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_scores (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          reporting_year INTEGER NOT NULL,
          topic_id UUID NOT NULL REFERENCES materiality_topics(id) ON DELETE CASCADE,
          impact_severity INTEGER NOT NULL,
          impact_scope INTEGER NOT NULL,
          impact_irremediability INTEGER NOT NULL,
          impact_likelihood INTEGER NOT NULL,
          financial_magnitude INTEGER NOT NULL,
          financial_likelihood INTEGER NOT NULL,
          notes TEXT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, company_id, reporting_year, topic_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS materiality_thresholds (
          tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          impact_threshold NUMERIC NOT NULL DEFAULT 9.0,
          financial_threshold NUMERIC NOT NULL DEFAULT 9.0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_stakeholders_weight_check'
          ) THEN
            ALTER TABLE materiality_stakeholders
            ADD CONSTRAINT materiality_stakeholders_weight_check
            CHECK (weight > 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_severity_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_severity_check
            CHECK (impact_severity BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_scope_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_scope_check
            CHECK (impact_scope BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_irremediability_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_irremediability_check
            CHECK (impact_irremediability BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_impact_likelihood_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_impact_likelihood_check
            CHECK (impact_likelihood BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_financial_magnitude_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_financial_magnitude_check
            CHECK (financial_magnitude BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_scores_financial_likelihood_check'
          ) THEN
            ALTER TABLE materiality_scores
            ADD CONSTRAINT materiality_scores_financial_likelihood_check
            CHECK (financial_likelihood BETWEEN 1 AND 5);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_thresholds_impact_threshold_check'
          ) THEN
            ALTER TABLE materiality_thresholds
            ADD CONSTRAINT materiality_thresholds_impact_threshold_check
            CHECK (impact_threshold > 0);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'materiality_thresholds_financial_threshold_check'
          ) THEN
            ALTER TABLE materiality_thresholds
            ADD CONSTRAINT materiality_thresholds_financial_threshold_check
            CHECK (financial_threshold > 0);
          END IF;
        END $$;
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_materiality_topics_code_unique
        ON materiality_topics (tenant_id, code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_topics_lookup
        ON materiality_topics (tenant_id, category, code)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_scores_company_year
        ON materiality_scores (tenant_id, company_id, reporting_year)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_materiality_scores_topic
        ON materiality_scores (tenant_id, topic_id, updated_at DESC)
      `;

      globalThis[MATERIALITY_SCHEMA_READY_KEY] = true;
    })().finally(() => {
      globalThis[MATERIALITY_SCHEMA_PROMISE_KEY] = null;
    });
  }

  await globalThis[MATERIALITY_SCHEMA_PROMISE_KEY];
};
