import { randomUUID } from "node:crypto";
import { WorkerJobStore } from "@esg-rdt/db";

type WorkerLogEvent = {
  service: "esg-rdt-master-worker";
  event: string;
  version: string;
  status: "ok" | "warn" | "fail" | "info";
  message?: string;
  eventRunId?: string;
  run?: number;
  runId?: string;
  startedAt?: string;
  cycleStart?: string;
  finishedAt?: string;
  workerId: string;
  durationMs?: number;
};

type JobContext = {
  eventRunId: string;
  jobType: string;
  startedAt: string;
};

const VERSION = process.env.WORKER_VERSION ?? "0.1.0";
const WORKER_ID = process.env.WORKER_ID ?? `worker-${randomUUID().slice(0, 8)}`;
const DEFAULT_SCHEDULE = "*/5 * * * *";

const schedule = process.env.WORKER_SCHEDULE_CRON ?? DEFAULT_SCHEDULE;
const envIntervalMs = process.env.WORKER_INTERVAL_MS;
const envMaxParallel = process.env.WORKER_MAX_PARALLEL;
const envStepDelay = process.env.WORKER_STEP_DELAY_MS;
const envProgressSteps = process.env.WORKER_PROGRESS_STEPS;
const maxParallel = Number.parseInt(envMaxParallel ?? "1", 10);
const progressStepDelayMs = Number.parseInt(envStepDelay ?? "650", 10);
const progressSteps = Number.parseInt(envProgressSteps ?? "8", 10);

const parseCronIntervalMinutes = (expression: string): number | null => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const minuteToken = parts[0];
  if (minuteToken === "*") {
    return 1;
  }

  const everyMatch = /^\*\/(\d+)$/.exec(minuteToken);
  if (!everyMatch) {
    return null;
  }

  const every = Number(everyMatch[1]);
  return Number.isFinite(every) && every > 0 ? every : null;
};

const resolveIntervalMs = (): number => {
  if (envIntervalMs) {
    const numeric = Number(envIntervalMs);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }
  }

  const minutes = parseCronIntervalMinutes(schedule);
  if (!minutes) {
    return 5 * 60 * 1000;
  }

  return Math.max(1, Math.floor(minutes)) * 60 * 1000;
};

const now = () => new Date().toISOString();
const delayMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeSteps = Number.isFinite(progressSteps) ? Math.min(20, Math.max(2, Math.floor(progressSteps))) : 8;
const safeStepDelay = Number.isFinite(progressStepDelayMs) ? Math.max(150, Math.floor(progressStepDelayMs)) : 650;
const workerStateStore = new WorkerJobStore();

const buildLog = (payload: WorkerLogEvent) => JSON.stringify(payload);

const log = (payload: WorkerLogEvent) => {
  console.log(buildLog(payload));
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.floor(value)));

const computeSimulatedMessage = (jobType: string, step: number, total: number) => {
  if (jobType === "health") {
    return `Collected health signal ${step} of ${total}`;
  }

  if (jobType === "status") {
    return `Rebuilt status snapshot ${step} of ${total}`;
  }

  if (jobType === "tenant-sync") {
    return `Synced tenant partition ${step} of ${total}`;
  }

  return `Running ${jobType} (${step}/${total})`;
};

const reportWorkerState = async (status: "idle" | "busy", activeJobId: string | null = null) => {
  const nowTick = now();
  const current = await workerStateStore.getWorkerState();
  await workerStateStore.reportWorkerState({
    workerId: WORKER_ID,
    status,
    processedJobs: current?.processedJobs ?? 0,
    activeJobId,
    lastHeartbeatAt: nowTick,
    version: VERSION,
  });
};

const buildJobResultPayload = (jobType: string, steps: number, context: JobContext) => ({
  workerId: WORKER_ID,
  steps,
  startedAt: context.startedAt,
  elapsedMs: Date.now() - Date.parse(context.startedAt),
  runId: context.eventRunId,
  jobType,
});

const runSimulatedJob = async (job: import("@esg-rdt/db").WorkerJob) => {
  const context: JobContext = {
    eventRunId: randomUUID(),
    jobType: job.jobType,
    startedAt: now(),
  };

  for (let step = 1; step <= safeSteps; step += 1) {
    const targetProgress = clamp((step / safeSteps) * 100);
    await delayMs(safeStepDelay);

    await workerStateStore.updateJobProgress(
      job.id,
      targetProgress,
      computeSimulatedMessage(job.jobType, step, safeSteps),
    );

    await reportWorkerState("busy", job.id);
    log({
      service: "esg-rdt-master-worker",
      event: "job_progress",
      version: VERSION,
      status: "info",
      eventRunId: context.eventRunId,
      runId: job.id,
      workerId: WORKER_ID,
      cycleStart: context.startedAt,
      message: `job ${job.jobType} progress ${targetProgress}%`,
    });
  }

  await workerStateStore.completeJob(job.id, buildJobResultPayload(job.jobType, safeSteps, context));
};

const runJob = async (job: import("@esg-rdt/db").WorkerJob, runId: string) => {
  const startedAt = now();

  try {
    log({
      service: "esg-rdt-master-worker",
      event: "job_start",
      version: VERSION,
      status: "info",
      eventRunId: runId,
      runId: job.id,
      workerId: WORKER_ID,
      startedAt,
      message: `starting job ${job.jobType}`,
    });

    await runSimulatedJob(job);

    await reportWorkerState("idle", null);
    log({
      service: "esg-rdt-master-worker",
      event: "job_complete",
      version: VERSION,
      status: "ok",
      eventRunId: runId,
      runId: job.id,
      workerId: WORKER_ID,
      finishedAt: now(),
      message: `completed job ${job.id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown worker error";
    await workerStateStore.failJob(job.id, message);
    await reportWorkerState("idle", null);
    log({
      service: "esg-rdt-master-worker",
      event: "job_fail",
      version: VERSION,
      status: "fail",
      eventRunId: runId,
      runId: job.id,
      workerId: WORKER_ID,
      message,
    });
    throw error;
  }
};

const runWorkerCycle = async () => {
  const cycleStart = now();
  const cycleId = randomUUID();

  if (maxParallel <= 0) {
    log({
      service: "esg-rdt-master-worker",
      event: "cycle_skipped",
      version: VERSION,
      status: "warn",
      runId: cycleId,
      workerId: WORKER_ID,
      message: "maxParallel is set to 0",
    });
    return;
  }

  await reportWorkerState("idle", null);

  const claimedJobs: Array<import("@esg-rdt/db").WorkerJob> = [];
  for (let slot = 0; slot < maxParallel; slot += 1) {
    const job = await workerStateStore.claimNextQueuedJob(WORKER_ID);
    if (!job) {
      break;
    }
    claimedJobs.push(job);
  }

  if (claimedJobs.length === 0) {
    log({
      service: "esg-rdt-master-worker",
      event: "cycle_idle",
      version: VERSION,
      status: "info",
      runId: cycleId,
      workerId: WORKER_ID,
      message: "no queued jobs",
      cycleStart,
    });
    return;
  }

  for (const job of claimedJobs) {
    await runJob(job, cycleId);
  }
};

const intervalMs = resolveIntervalMs();
let running = true;
let cycleInFlight = false;
let cycles = 0;

console.log(
  JSON.stringify({
    event: "worker_boot",
    service: "esg-rdt-master-worker",
    version: VERSION,
    schedule,
    intervalMs,
    workerId: WORKER_ID,
    steps: safeSteps,
    stepDelayMs: safeStepDelay,
    maxParallel,
  }),
);

const loop = async () => {
  if (!running) {
    return;
  }

  if (cycleInFlight) {
    log({
      service: "esg-rdt-master-worker",
      event: "cycle_skipped",
      version: VERSION,
      status: "warn",
      runId: randomUUID(),
      workerId: WORKER_ID,
      message: "previous cycle is still in flight",
    });
    return;
  }

  cycleInFlight = true;
  cycles += 1;
  const cycleStart = now();

  try {
    await runWorkerCycle();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    log({
      service: "esg-rdt-master-worker",
      event: "cycle_failed",
      version: VERSION,
      status: "fail",
      runId: randomUUID(),
      workerId: WORKER_ID,
      message,
    });
  } finally {
    cycleInFlight = false;
    await reportWorkerState("idle", null);
    await workerStateStore.cleanupCompletedJobs();

    log({
      service: "esg-rdt-master-worker",
      event: "cycle_complete",
      version: VERSION,
      status: "ok",
      runId: randomUUID(),
      workerId: WORKER_ID,
      message: `cycle complete (#${cycles})`,
      cycleStart,
    });
  }
};

void reportWorkerState("idle", null);
loop();
const timer = setInterval(loop, intervalMs);

const shutdown = () => {
  running = false;
  clearInterval(timer);
  void reportWorkerState("idle", null);
  log({
    service: "esg-rdt-master-worker",
    event: "worker_shutdown",
    version: VERSION,
    status: "info",
    runId: randomUUID(),
    workerId: WORKER_ID,
    message: `shutdown after ${cycles} cycles`,
  });
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
