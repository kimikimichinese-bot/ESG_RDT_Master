import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const DEFAULT_MAX_JOBS = 250;
const DEFAULT_HEARTBEAT_STALE_MS = 150_000;
const DEFAULT_JOB_MESSAGE: Record<WorkerJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
};

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type WorkerJobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobStatus = WorkerJobStatus;

// Compatibility aliases for legacy Prisma-ish consumers.
export type WorkerJobGetPayload = WorkerJob;
export type WorkerJobDefaultArgs = unknown;
export type JsonNull = null;
export const JsonNull = null;

export interface WorkerJob {
  id: string;
  jobType: string;
  status: WorkerJobStatus;
  input: JsonValue;
  output: JsonValue | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;

  // Legacy fields preserved for existing app contracts.
  tenantId: string | null;
  requestedAt: string;
  progress: number;
  message: string;
  attempts: number;
  lastError: string | null;
  result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface WorkerRuntimeState {
  workerId: string;
  status: "idle" | "busy";
  lastHeartbeatAt: string;
  processedJobs: number;
  activeJobId: string | null;
  version: string;
}

export interface WorkerJobStoreOptions {
  maxJobs?: number;
}

interface ListJobsOptions {
  status?: JobStatus | JobStatus[];
  includeCompleted?: boolean;
  limit?: number;
}

interface CreateJobInput {
  jobType: string;
  tenantId: string | null;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface WorkerRuntimeStateUpdate {
  status: WorkerRuntimeState["status"];
  activeJobId: string | null;
  lastHeartbeatAt: string;
  processedJobs?: number;
  version?: string;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

interface WorkerRuntimeStateRow {
  worker_id: string;
  status: string;
  last_heartbeat_at: Date | string;
  processed_jobs: number;
  active_job_id: string | null;
  version: string;
}

type SqlClient = ReturnType<typeof neon>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.floor(value)));

const normalizeDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
};

const parseNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isRecord(value)) {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = toJsonValue(item);
    }
    return output;
  }

  return null;
};

const parseJsonValue = (value: unknown): JsonValue | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return toJsonValue(JSON.parse(value));
    } catch {
      return value;
    }
  }

  return toJsonValue(value);
};

const asJsonObject = (value: JsonValue | null): JsonObject => {
  if (value && !Array.isArray(value) && typeof value === "object") {
    return value;
  }

  return {};
};

const asWorkerStatus = (value: unknown): WorkerJobStatus => {
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed") {
    return value;
  }

  return "queued";
};

const asWorkerRuntimeStatus = (value: unknown): WorkerRuntimeState["status"] => {
  return value === "busy" ? "busy" : "idle";
};

const defaultJobMessage = (status: WorkerJobStatus, error: string | null): string => {
  if (status === "failed" && error && error.trim().length > 0) {
    return error;
  }

  return DEFAULT_JOB_MESSAGE[status];
};

const statusProgress = (status: WorkerJobStatus): number => {
  if (status === "queued") {
    return 0;
  }

  if (status === "running") {
    return 50;
  }

  return 100;
};

const parseAttempts = (inputObject: JsonObject, status: WorkerJobStatus): number => {
  const attemptValue = parseNumber(inputObject.attempts, status === "queued" ? 0 : 1);
  if (!Number.isFinite(attemptValue) || attemptValue < 0) {
    return status === "queued" ? 0 : 1;
  }

  return Math.floor(attemptValue);
};

const parseProgress = (inputObject: JsonObject, status: WorkerJobStatus): number => {
  const progress = parseNumber(inputObject.progress, statusProgress(status));
  return clampProgress(progress);
};

const buildCreateJobInput = (input: CreateJobInput): JsonObject => {
  const message = typeof input.message === "string" && input.message.trim().length > 0 ? input.message.trim() : "Queued";

  const metadataSource = input.metadata && isRecord(input.metadata) ? input.metadata : {};
  const metadata: JsonObject = {};
  for (const [key, value] of Object.entries(metadataSource)) {
    metadata[key] = toJsonValue(value);
  }

  return {
    tenantId: input.tenantId,
    message,
    metadata,
    attempts: 0,
    progress: 0,
  };
};

const extractTenantId = (input: JsonObject): string | null => {
  const value = input.tenantId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const extractMessage = (input: JsonObject, status: WorkerJobStatus, error: string | null): string => {
  const value = input.message;
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return defaultJobMessage(status, error);
};

const extractMetadata = (input: JsonObject): Record<string, unknown> => {
  const metadata = input.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    return {};
  }

  return metadata as Record<string, unknown>;
};

const extractResult = (output: JsonValue | null): Record<string, unknown> | null => {
  if (!output || Array.isArray(output) || typeof output !== "object") {
    return null;
  }

  return output as Record<string, unknown>;
};

const normalizeJob = (row: JobRow): WorkerJob => {
  const status = asWorkerStatus(row.status);
  const input = parseJsonValue(row.input) ?? {};
  const inputObject = asJsonObject(input);
  const output = parseJsonValue(row.output);
  const error = typeof row.error === "string" ? row.error : null;
  const createdAt = normalizeDate(row.created_at);
  const updatedAt = normalizeDate(row.updated_at);
  const startedAt = row.started_at ? normalizeDate(row.started_at) : null;
  const finishedAt = row.finished_at ? normalizeDate(row.finished_at) : null;

  return {
    id: row.id,
    jobType: row.job_type,
    status,
    input,
    output,
    error,
    createdAt,
    updatedAt,
    startedAt,
    finishedAt,

    tenantId: extractTenantId(inputObject),
    requestedAt: createdAt,
    progress: parseProgress(inputObject, status),
    message: extractMessage(inputObject, status, error),
    attempts: parseAttempts(inputObject, status),
    lastError: error,
    result: extractResult(output),
    metadata: extractMetadata(inputObject),
  };
};

const getDatabaseUrl = (): string => {
  const value = process.env.DATABASE_URL;
  if (!value || !value.trim()) {
    throw new Error("Missing DATABASE_URL");
  }

  return value.trim();
};

const parseCount = (value: unknown): number => {
  const parsed = parseNumber(value, 0);
  return parsed > 0 ? Math.floor(parsed) : 0;
};

export class WorkerJobStore {
  private sqlClient: SqlClient | null = null;
  private readonly maxJobs: number;

  constructor(options: WorkerJobStoreOptions = {}) {
    this.maxJobs = Number.isFinite(Number(options.maxJobs))
      ? Math.max(1, Math.floor(Number(options.maxJobs)))
      : DEFAULT_MAX_JOBS;
  }

  private sql(): SqlClient {
    if (!this.sqlClient) {
      this.sqlClient = neon(getDatabaseUrl());
    }

    return this.sqlClient;
  }

  private async ensureSchema(): Promise<void> {
    if (schemaReady) {
      return;
    }

    if (!schemaPromise) {
      schemaPromise = (async () => {
        const sql = this.sql();
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

        await sql`
          CREATE TABLE IF NOT EXISTS worker_runtime_state (
            worker_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            last_heartbeat_at TIMESTAMPTZ NOT NULL,
            processed_jobs INTEGER NOT NULL DEFAULT 0,
            active_job_id TEXT NULL UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
            version TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;

        await sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs (updated_at DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_worker_runtime_heartbeat ON worker_runtime_state (last_heartbeat_at DESC)`;

        schemaReady = true;
      })().finally(() => {
        schemaPromise = null;
      });
    }

    await schemaPromise;
  }

  private async enforceMaxJobs(): Promise<void> {
    const sql = this.sql();
    const countRows = (await sql`SELECT COUNT(*)::int AS count FROM jobs`) as Array<{ count: number | string }>;
    const total = parseCount(countRows[0]?.count ?? 0);
    const overflow = total - this.maxJobs;

    if (overflow <= 0) {
      return;
    }

    await sql`
      WITH removable AS (
        SELECT id
        FROM jobs
        WHERE status IN ('succeeded', 'failed')
        ORDER BY finished_at ASC NULLS FIRST, updated_at ASC
        LIMIT ${overflow}
      )
      DELETE FROM jobs
      WHERE id IN (SELECT id FROM removable)
    `;
  }

  private async updateWorkerState(workerId: string, updates: WorkerRuntimeStateUpdate): Promise<void> {
    const sql = this.sql();
    const lastHeartbeatAt = new Date(updates.lastHeartbeatAt);
    const heartbeatAt = Number.isNaN(lastHeartbeatAt.getTime()) ? new Date() : lastHeartbeatAt;
    const version = typeof updates.version === "string" && updates.version.trim().length > 0 ? updates.version : "1";
    const shouldReplaceProcessedJobs = updates.processedJobs !== undefined;
    const processedJobsValue = shouldReplaceProcessedJobs
      ? Math.max(0, Math.floor(updates.processedJobs ?? 0))
      : 0;

    await sql`
      INSERT INTO worker_runtime_state (
        worker_id,
        status,
        last_heartbeat_at,
        processed_jobs,
        active_job_id,
        version,
        created_at,
        updated_at
      )
      VALUES (
        ${workerId},
        ${updates.status},
        ${heartbeatAt},
        ${processedJobsValue},
        ${updates.activeJobId},
        ${version},
        NOW(),
        NOW()
      )
      ON CONFLICT (worker_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at,
        processed_jobs = CASE
          WHEN ${shouldReplaceProcessedJobs}
          THEN EXCLUDED.processed_jobs
          ELSE worker_runtime_state.processed_jobs
        END,
        active_job_id = EXCLUDED.active_job_id,
        version = EXCLUDED.version,
        updated_at = NOW()
    `;
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureSchema();
      await this.sql()`SELECT 1`;
      return true;
    } catch (_error) {
      return false;
    }
  }

  async getWorkerState(): Promise<WorkerRuntimeState | null> {
    await this.ensureSchema();
    const sql = this.sql();
    const rows = (await sql`
      SELECT worker_id, status, last_heartbeat_at, processed_jobs, active_job_id, version
      FROM worker_runtime_state
      ORDER BY last_heartbeat_at DESC
      LIMIT 1
    `) as WorkerRuntimeStateRow[];

    const latest = rows[0];
    if (!latest) {
      return null;
    }

    return {
      workerId: latest.worker_id,
      status: asWorkerRuntimeStatus(latest.status),
      lastHeartbeatAt: normalizeDate(latest.last_heartbeat_at),
      processedJobs: Math.max(0, Math.floor(parseNumber(latest.processed_jobs, 0))),
      activeJobId: latest.active_job_id ?? null,
      version: typeof latest.version === "string" && latest.version.trim().length > 0 ? latest.version : "1",
    };
  }

  async reportWorkerState(nextState: WorkerRuntimeState): Promise<void> {
    await this.ensureSchema();
    await this.updateWorkerState(nextState.workerId, {
      status: nextState.status,
      activeJobId: nextState.activeJobId,
      lastHeartbeatAt: nextState.lastHeartbeatAt,
      processedJobs: nextState.processedJobs,
      version: nextState.version,
    });
  }

  async listJobs(options: ListJobsOptions = {}): Promise<WorkerJob[]> {
    await this.ensureSchema();
    const sql = this.sql();
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : 50;
    const includeCompleted = options.includeCompleted !== false;
    const statusFilter = options.status
      ? Array.isArray(options.status)
        ? options.status
        : [options.status]
      : null;

    const fetchLimit = Math.max(limit, this.maxJobs);
    const rows = (await sql`
      SELECT id, job_type, status, input, output, error, created_at, updated_at, started_at, finished_at
      FROM jobs
      ORDER BY updated_at DESC
      LIMIT ${fetchLimit}
    `) as JobRow[];

    const normalized = rows.map((row) => normalizeJob(row));
    const filtered = normalized.filter((job) => {
      if (statusFilter) {
        return statusFilter.includes(job.status);
      }

      if (!includeCompleted) {
        return job.status !== "succeeded" && job.status !== "failed";
      }

      return true;
    });

    return filtered.slice(0, limit);
  }

  async getJob(jobId: string): Promise<WorkerJob | null> {
    await this.ensureSchema();
    const sql = this.sql();
    const rows = (await sql`
      SELECT id, job_type, status, input, output, error, created_at, updated_at, started_at, finished_at
      FROM jobs
      WHERE id = ${jobId}
      LIMIT 1
    `) as JobRow[];

    const row = rows[0];
    return row ? normalizeJob(row) : null;
  }

  async createJob(input: CreateJobInput): Promise<WorkerJob> {
    await this.ensureSchema();
    const sql = this.sql();
    const id = randomUUID();
    const payload = buildCreateJobInput(input);

    const rows = (await sql`
      INSERT INTO jobs (
        id,
        job_type,
        status,
        input,
        output,
        error,
        created_at,
        updated_at,
        started_at,
        finished_at
      )
      VALUES (
        ${id},
        ${input.jobType},
        'queued',
        ${JSON.stringify(payload)}::jsonb,
        ${JsonNull},
        ${null},
        NOW(),
        NOW(),
        ${null},
        ${null}
      )
      RETURNING id, job_type, status, input, output, error, created_at, updated_at, started_at, finished_at
    `) as JobRow[];

    await this.enforceMaxJobs();

    const created = rows[0];
    if (!created) {
      throw new Error("Failed to create job");
    }

    return normalizeJob(created);
  }

  async claimNextQueuedJob(workerId: string): Promise<WorkerJob | null> {
    await this.ensureSchema();
    const sql = this.sql();

    const rows = (await sql`
      WITH candidate AS (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs AS j
      SET
        status = 'running',
        started_at = COALESCE(j.started_at, NOW()),
        updated_at = NOW(),
        input = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(j.input, '{}'::jsonb),
              '{attempts}',
              to_jsonb(COALESCE((j.input->>'attempts')::int, 0) + 1),
              true
            ),
            '{progress}',
            to_jsonb(5),
            true
          ),
          '{message}',
          to_jsonb(${`Claimed by ${workerId}`}::text),
          true
        )
      FROM candidate
      WHERE j.id = candidate.id
      RETURNING j.id, j.job_type, j.status, j.input, j.output, j.error, j.created_at, j.updated_at, j.started_at, j.finished_at
    `) as JobRow[];

    const claimed = rows[0];
    if (!claimed) {
      return null;
    }

    await this.updateWorkerState(workerId, {
      status: "busy",
      activeJobId: claimed.id,
      lastHeartbeatAt: new Date().toISOString(),
      version: "1",
    });

    return normalizeJob(claimed);
  }

  async updateJobProgress(jobId: string, progress: number, message?: string): Promise<WorkerJob | null> {
    await this.ensureSchema();
    const sql = this.sql();
    const safeProgress = clampProgress(progress);

    const rows = (await sql`
      UPDATE jobs
      SET
        status = 'running',
        input = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(input, '{}'::jsonb),
              '{attempts}',
              to_jsonb(COALESCE((input->>'attempts')::int, 1)),
              true
            ),
            '{progress}',
            to_jsonb(${safeProgress}),
            true
          ),
          '{message}',
          to_jsonb(${message ?? `Running (${safeProgress}%)`}::text),
          true
        ),
        updated_at = NOW(),
        started_at = COALESCE(started_at, NOW())
      WHERE id = ${jobId}
        AND status = 'running'
      RETURNING id, job_type, status, input, output, error, created_at, updated_at, started_at, finished_at
    `) as JobRow[];

    const row = rows[0];
    return row ? normalizeJob(row) : null;
  }

  async completeJob(jobId: string, result: Record<string, unknown> | null): Promise<WorkerJob | null> {
    await this.ensureSchema();
    const sql = this.sql();

    const rows = (await sql`
      UPDATE jobs
      SET
        status = 'succeeded',
        output = ${JSON.stringify(result ?? JsonNull)}::jsonb,
        error = NULL,
        finished_at = NOW(),
        updated_at = NOW(),
        input = jsonb_set(
          jsonb_set(
            COALESCE(input, '{}'::jsonb),
            '{message}',
            to_jsonb('Completed'::text),
            true
          ),
          '{progress}',
          to_jsonb(100),
          true
        )
      WHERE id = ${jobId}
      RETURNING id, job_type, status, input, output, error, created_at, updated_at, started_at, finished_at
    `) as JobRow[];

    const updated = rows[0];
    if (!updated) {
      return null;
    }

    await sql`
      UPDATE worker_runtime_state
      SET
        processed_jobs = processed_jobs + 1,
        active_job_id = NULL,
        status = 'idle',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE active_job_id = ${jobId}
    `;

    return normalizeJob(updated);
  }

  async failJob(jobId: string, errorMessage: string): Promise<WorkerJob | null> {
    await this.ensureSchema();
    const sql = this.sql();

    const rows = (await sql`
      UPDATE jobs
      SET
        status = 'failed',
        error = ${String(errorMessage).slice(0, 4000)},
        finished_at = NOW(),
        updated_at = NOW(),
        input = jsonb_set(
          jsonb_set(
            COALESCE(input, '{}'::jsonb),
            '{message}',
            to_jsonb('Failed'::text),
            true
          ),
          '{progress}',
          to_jsonb(100),
          true
        )
      WHERE id = ${jobId}
      RETURNING id, job_type, status, input, output, error, created_at, updated_at, started_at, finished_at
    `) as JobRow[];

    const updated = rows[0];
    if (!updated) {
      return null;
    }

    await sql`
      UPDATE worker_runtime_state
      SET
        active_job_id = NULL,
        status = 'idle',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE active_job_id = ${jobId}
    `;

    return normalizeJob(updated);
  }

  async cleanupCompletedJobs(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    await this.ensureSchema();
    const sql = this.sql();
    const cutoff = new Date(Date.now() - maxAgeMs);

    const rows = (await sql`
      WITH deleted AS (
        DELETE FROM jobs
        WHERE status IN ('succeeded', 'failed')
          AND finished_at < ${cutoff}
        RETURNING id
      )
      SELECT COUNT(*)::int AS count FROM deleted
    `) as Array<{ count: number | string }>;

    return parseCount(rows[0]?.count ?? 0);
  }

  async isWorkerAlive(stalenessMs = DEFAULT_HEARTBEAT_STALE_MS): Promise<boolean> {
    const state = await this.getWorkerState();
    if (!state) {
      return false;
    }

    const lastHeartbeatMs = Date.parse(state.lastHeartbeatAt);
    if (!Number.isFinite(lastHeartbeatMs)) {
      return false;
    }

    return Date.now() - lastHeartbeatMs <= stalenessMs;
  }
}
