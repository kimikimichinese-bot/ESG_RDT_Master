import { Prisma, PrismaClient } from "@prisma/client";
import { WorkerJobContract } from "@esg-rdt/shared";

const DEFAULT_MAX_JOBS = 250;
const DEFAULT_HEARTBEAT_STALE_MS = 150_000;

export type JobStatus = WorkerJobContract["status"];

export interface WorkerJob extends WorkerJobContract {}

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.floor(value)));

const normalizeDate = (value: Date): string => new Date(value).toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  isObject(value);

const normalizeMetadata = (value: unknown): Record<string, unknown> => {
  if (!isObject(value)) {
    return {};
  }

  return value;
};

const normalizeResult = (value: unknown): Record<string, unknown> | null => {
  if (value === null) {
    return null;
  }

  if (isObject(value)) {
    return value;
  }

  return null;
};

const normalizeAttempts = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
};

const normalizeJob = (job: Prisma.WorkerJobGetPayload<Prisma.WorkerJobDefaultArgs>): WorkerJob => ({
  id: job.id,
  jobType: job.jobType,
  tenantId: job.tenantId,
  status: job.status as JobStatus,
  requestedAt: normalizeDate(job.requestedAt),
  startedAt: job.startedAt ? normalizeDate(job.startedAt) : null,
  finishedAt: job.finishedAt ? normalizeDate(job.finishedAt) : null,
  updatedAt: normalizeDate(job.updatedAt),
  progress: clampProgress(job.progress),
  message: job.message ?? "",
  attempts: normalizeAttempts(job.attempts),
  lastError: typeof job.lastError === "string" ? job.lastError : null,
  result: normalizeResult(job.result),
  metadata: normalizeMetadata(job.metadata),
});

export class WorkerJobStore {
  private readonly prisma: PrismaClient;
  private readonly maxJobs: number;

  constructor(options: WorkerJobStoreOptions = {}) {
    this.prisma = new PrismaClient();
    this.maxJobs = Number.isFinite(Number(options.maxJobs))
      ? Math.max(1, Math.floor(Number(options.maxJobs)))
      : DEFAULT_MAX_JOBS;
  }

  private async enforceMaxJobs(tx: Prisma.TransactionClient): Promise<void> {
    const total = await tx.workerJob.count();
    const overflow = total - this.maxJobs;
    if (overflow <= 0) {
      return;
    }

    const removable = await tx.workerJob.findMany({
      where: {
        OR: [{ status: "succeeded" }, { status: "failed" }],
      },
      orderBy: {
        finishedAt: "asc",
      },
      skip: 0,
      take: overflow,
      select: {
        id: true,
      },
    });

    if (removable.length === 0) {
      return;
    }

    await tx.workerJob.deleteMany({
      where: {
        id: {
          in: removable.map((row) => row.id),
        },
      },
    });
  }

  private async updateWorkerState(
    tx: Prisma.TransactionClient,
    workerId: string,
    updates: {
      status: WorkerRuntimeState["status"];
      activeJobId: string | null;
      lastHeartbeatAt: string;
      processedJobs?: number;
      version?: string;
    },
  ): Promise<void> {
    const now = new Date(updates.lastHeartbeatAt);
    const version = typeof updates.version === "string" && updates.version.trim().length > 0 ? updates.version : "1";

    await tx.workerRuntimeState.upsert({
      where: {
        workerId,
      },
      update: {
        status: updates.status,
        activeJobId: updates.activeJobId,
        lastHeartbeatAt: now,
        processedJobs:
          updates.processedJobs !== undefined
            ? updates.processedJobs
            : undefined,
        version,
      },
      create: {
        workerId,
        status: updates.status,
        activeJobId: updates.activeJobId,
        lastHeartbeatAt: now,
        processedJobs: updates.processedJobs ?? 0,
        version,
      },
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (_error) {
      return false;
    }
  }

  async getWorkerState(): Promise<WorkerRuntimeState | null> {
    const latest = await this.prisma.workerRuntimeState.findFirst({
      orderBy: {
        lastHeartbeatAt: "desc",
      },
    });

    if (!latest) {
      return null;
    }

    return {
      workerId: latest.workerId,
      status: latest.status,
      lastHeartbeatAt: normalizeDate(latest.lastHeartbeatAt),
      processedJobs: latest.processedJobs,
      activeJobId: latest.activeJobId ?? null,
      version: latest.version,
    };
  }

  async reportWorkerState(nextState: WorkerRuntimeState): Promise<void> {
    await this.prisma.workerRuntimeState.upsert({
      where: {
        workerId: nextState.workerId,
      },
      update: {
        status: nextState.status,
        lastHeartbeatAt: new Date(nextState.lastHeartbeatAt),
        processedJobs: nextState.processedJobs,
        activeJobId: nextState.activeJobId,
        version: nextState.version,
      },
      create: {
        workerId: nextState.workerId,
        status: nextState.status,
        lastHeartbeatAt: new Date(nextState.lastHeartbeatAt),
        processedJobs: nextState.processedJobs,
        activeJobId: nextState.activeJobId,
        version: nextState.version,
      },
    });
  }

  async listJobs(options: ListJobsOptions = {}): Promise<WorkerJob[]> {
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : 50;
    const includeCompleted = options.includeCompleted !== false;
    const statusFilter = options.status
      ? Array.isArray(options.status)
        ? options.status
        : [options.status]
      : undefined;

    const whereClause: Prisma.WorkerJobWhereInput = {};
    if (statusFilter) {
      whereClause.status = {
        in: statusFilter,
      };
    } else if (!includeCompleted) {
      whereClause.status = {
        notIn: ["succeeded", "failed"],
      };
    }

    const rows = await this.prisma.workerJob.findMany({
      where: whereClause,
      orderBy: {
        updatedAt: "desc",
      },
      take: limit,
    });

    return rows.map((row) => normalizeJob(row));
  }

  async getJob(jobId: string): Promise<WorkerJob | null> {
    const row = await this.prisma.workerJob.findUnique({
      where: {
        id: jobId,
      },
    });

    return row ? normalizeJob(row) : null;
  }

  async createJob(input: {
    jobType: string;
    tenantId: string | null;
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<WorkerJob> {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.workerJob.create({
        data: {
          jobType: input.jobType,
          tenantId: input.tenantId,
          status: "queued",
          message: input.message?.trim() || "Queued",
          progress: 0,
          attempts: 0,
          lastError: null,
          result: Prisma.JsonNull,
          metadata: input.metadata ?? {},
        },
      });

      await this.enforceMaxJobs(tx);
      return row;
    }, {
      timeout: 8_000,
    });

    return normalizeJob(created);
  }

  async claimNextQueuedJob(workerId: string): Promise<WorkerJob | null> {
    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.workerJob.findFirst({
        where: {
          status: "queued",
        },
        orderBy: {
          requestedAt: "asc",
        },
      });

      if (!candidate) {
        return null;
      }

      const claimedCount = await tx.workerJob.updateMany({
        where: {
          id: candidate.id,
          status: "queued",
        },
        data: {
          status: "running",
          startedAt: now,
          updatedAt: now,
          progress: 5,
          message: `Claimed by ${workerId}`,
          attempts: {
            increment: 1,
          },
        },
      });

      if (claimedCount.count !== 1) {
        return null;
      }

      await this.updateWorkerState(tx, workerId, {
        status: "busy",
        activeJobId: candidate.id,
        lastHeartbeatAt: now.toISOString(),
        version: "1",
      });

      const claimedJob = await tx.workerJob.findUnique({
        where: {
          id: candidate.id,
        },
      });

      return claimedJob;
    }, {
      timeout: 8_000,
    });

    if (!claimed) {
      return null;
    }

    return normalizeJob(claimed);
  }

  async updateJobProgress(jobId: string, progress: number, message?: string): Promise<WorkerJob | null> {
    const safeProgress = clampProgress(progress);
    const updated = await this.prisma.workerJob.updateMany({
      where: {
        id: jobId,
        status: "running",
      },
      data: {
        progress: safeProgress,
        message: message ?? undefined,
        updatedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      return null;
    }

    const row = await this.prisma.workerJob.findUnique({
      where: {
        id: jobId,
      },
    });

    return row ? normalizeJob(row) : null;
  }

  async completeJob(jobId: string, result: Record<string, unknown> | null): Promise<WorkerJob | null> {
    const now = new Date();
    const updated = await this.prisma.workerJob.updateMany({
      where: {
        id: jobId,
      },
      data: {
        status: "succeeded",
        finishedAt: now,
        updatedAt: now,
        progress: 100,
        message: "Completed",
        result: result ?? Prisma.JsonNull,
        lastError: null,
      },
    });

    if (updated.count !== 1) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workerRuntimeState.updateMany({
        where: {
          activeJobId: jobId,
        },
        data: {
          processedJobs: {
            increment: 1,
          },
          activeJobId: null,
          status: "idle",
          lastHeartbeatAt: now,
        },
      });
    });

    const row = await this.prisma.workerJob.findUnique({
      where: {
        id: jobId,
      },
    });

    return row ? normalizeJob(row) : null;
  }

  async failJob(jobId: string, errorMessage: string): Promise<WorkerJob | null> {
    const now = new Date();
    const updated = await this.prisma.workerJob.updateMany({
      where: {
        id: jobId,
      },
      data: {
        status: "failed",
        finishedAt: now,
        updatedAt: now,
        message: "Failed",
        lastError: errorMessage,
      },
    });

    if (updated.count !== 1) {
      return null;
    }

    await this.prisma.workerRuntimeState.updateMany({
      where: {
        activeJobId: jobId,
      },
      data: {
        activeJobId: null,
        status: "idle",
        lastHeartbeatAt: now,
      },
    });

    const row = await this.prisma.workerJob.findUnique({
      where: {
        id: jobId,
      },
    });

    return row ? normalizeJob(row) : null;
  }

  async cleanupCompletedJobs(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await this.prisma.workerJob.deleteMany({
      where: {
        OR: [
          {
            status: "succeeded",
            finishedAt: {
              lt: cutoff,
            },
          },
          {
            status: "failed",
            finishedAt: {
              lt: cutoff,
            },
          },
        ],
      },
    });

    return result.count;
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
