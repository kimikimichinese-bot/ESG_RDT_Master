import { neon } from "@neondatabase/serverless";

const SCHEMA_READY_KEY = "__esg_rdt_jobs_schema_ready__";
const SCHEMA_PROMISE_KEY = "__esg_rdt_jobs_schema_promise__";

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
