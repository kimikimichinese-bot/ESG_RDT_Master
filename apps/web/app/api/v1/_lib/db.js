import { neon } from "@neondatabase/serverless";
import { ESG_PARAMETER_DEFINITIONS } from "./esg-parameters.js";

const SCHEMA_READY_KEY = "__esg_rdt_jobs_schema_ready__";
const SCHEMA_PROMISE_KEY = "__esg_rdt_jobs_schema_promise__";
const ASSESSMENT_SCHEMA_READY_KEY = "__esg_rdt_assessment_schema_ready__";
const ASSESSMENT_SCHEMA_PROMISE_KEY = "__esg_rdt_assessment_schema_promise__";

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

export const ensureAssessmentSchema = async () => {
  if (globalThis[ASSESSMENT_SCHEMA_READY_KEY]) {
    return;
  }

  if (!globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY]) {
    globalThis[ASSESSMENT_SCHEMA_PROMISE_KEY] = (async () => {
      await ensureSchema();
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

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
          parameter_key TEXT NOT NULL REFERENCES parameters(key) ON DELETE CASCADE,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (project_id, parameter_key)
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_parameters_category_sort ON parameters (category, sort_order, key)`;
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
