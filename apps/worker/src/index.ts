type WorkerResult = {
  name: string;
  status: "ok" | "warn";
  detail: string;
};

type WorkerState = {
  startedAt: string;
  lastRunAt: string | null;
  runs: number;
  failures: number;
  skippedCycles: number;
};

const DEFAULT_SCHEDULE = "*/5 * * * *";
const VERSION = process.env.WORKER_VERSION ?? "0.1.0";

const parseCronIntervalMinutes = (expression: string): number | null => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minuteToken = parts[0];
  if (minuteToken === "*") return 1;
  const everyMatch = /^\*\/(\d+)$/.exec(minuteToken);
  if (!everyMatch) return null;
  const every = Number(everyMatch[1]);
  return Number.isFinite(every) && every > 0 ? every : null;
};

const resolveIntervalMs = (): number => {
  const override = process.env.WORKER_INTERVAL_MS;
  if (override) {
    const numeric = Number(override);
    if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  }

  const cron = process.env.WORKER_SCHEDULE_CRON ?? DEFAULT_SCHEDULE;
  const minutes = parseCronIntervalMinutes(cron);
  if (!minutes) return 5 * 60 * 1000;
  return minutes * 60 * 1000;
};

const safeNow = () => new Date().toISOString();

const state: WorkerState = {
  startedAt: safeNow(),
  lastRunAt: null,
  runs: 0,
  failures: 0,
  skippedCycles: 0,
};

const checkEventStore = async (): Promise<WorkerResult> => {
  await Promise.resolve();
  return {
    name: "event-store",
    status: "warn",
    detail: "Not wired to persistence yet; this is a no-op readiness path.",
  };
};

const checkCalculationEngine = async (): Promise<WorkerResult> => {
  await Promise.resolve();
  return {
    name: "calculation-engine",
    status: "warn",
    detail: "Calculation jobs are defined but not yet implemented.",
  };
};

const runWorkerCycle = async () => {
  const cycleStart = safeNow();
  const runId = Math.random().toString(16).slice(2);
  state.runs += 1;
  state.lastRunAt = cycleStart;

  try {
    const checks = await Promise.all([checkEventStore(), checkCalculationEngine()]);
    const failed = checks.filter((result) => result.status !== "ok");
    const status = failed.length === 0 ? "ok" : "warn";

    console.log(
      JSON.stringify({
        service: "esg-rdt-master-worker",
        event: "cycle_complete",
        version: VERSION,
        status,
        runId,
        run: state.runs,
        startedAt: state.startedAt,
        cycleStart,
        checks,
      }),
    );
  } catch (error) {
    state.failures += 1;
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(
      JSON.stringify({
        service: "esg-rdt-master-worker",
        event: "cycle_failed",
        version: VERSION,
        status: "fail",
        runId,
        run: state.runs,
        startedAt: state.startedAt,
        cycleStart,
        message,
      }),
    );
  }
};

const intervalMs = resolveIntervalMs();
const schedule = process.env.WORKER_SCHEDULE_CRON ?? DEFAULT_SCHEDULE;
let running = true;
let cycleInFlight = false;

console.log(
  JSON.stringify({
    event: "worker_boot",
    service: "esg-rdt-master-worker",
    version: VERSION,
    schedule,
    intervalMs,
  }),
);

const loop = async () => {
  if (!running) return;
  if (cycleInFlight) {
    state.skippedCycles += 1;
    console.warn(
      JSON.stringify({
        event: "cycle_skipped",
        service: "esg-rdt-master-worker",
        version: VERSION,
        schedule,
        intervalMs,
        reason: "previous_cycle_inflight",
      }),
    );
    return;
  }

  cycleInFlight = true;
  try {
    await runWorkerCycle();
  } finally {
    cycleInFlight = false;
  }
};

loop();
const timer = setInterval(loop, intervalMs);

const shutdown = () => {
  running = false;
  clearInterval(timer);
  console.log(JSON.stringify({
    event: "worker_shutdown",
    service: "esg-rdt-master-worker",
    version: VERSION,
    state,
  }));
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
