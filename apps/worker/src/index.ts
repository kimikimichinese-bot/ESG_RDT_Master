const schedule = process.env.WORKER_SCHEDULE_CRON ?? "*/5 * * * *";

console.log(`Worker scaffold ready. Schedule=${schedule}`);
