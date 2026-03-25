#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const useLarge = String(process.env.READINESS_USE_LARGE || "").trim() === "1";
const outputDir = join(process.cwd(), "apps/web/public");
const summaryJsonPath = join(outputDir, "pilot-readiness-summary.json");
const summaryMdPath = join(outputDir, "pilot-readiness-summary.md");

const run = (label, command, args, extraEnv = {}) => {
  const env = {
    ...process.env,
    ...extraEnv,
  };
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "pipe",
    encoding: "utf-8",
  });
  return {
    label,
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
};

const main = async () => {
  const steps = [];
  if (useLarge) {
    steps.push(
      run("seed-demo-large", "bun", ["scripts/dev/seed-demo-large.mjs"], {
        APP_ENV: "local",
        CONFIRM_DEMO_SEED_LARGE: "YES",
        DEMO_SEED_LARGE_SKIP_ENSURE: process.env.DEMO_SEED_LARGE_SKIP_ENSURE || "1",
      }),
    );
  } else {
    steps.push(
      run("seed-demo-data", "bun", ["scripts/dev/seed-demo-data.mjs"], {
        APP_ENV: "local",
        CONFIRM_DEMO_SEED: "YES",
      }),
    );
  }

  steps.push(
    run("smoke-prod-like", "bun", ["scripts/dev/smoke-prod-like.mjs"], {
      APP_ENV: "local",
      CONFIRM_AUDIT_EXPORT: "YES",
    }),
  );
  steps.push(
    run("benchmark-core", "bun", ["scripts/dev/benchmark-core.mjs"], {
      APP_ENV: "local",
      BENCHMARK_DATASET: useLarge ? "large" : "small",
    }),
  );
  steps.push(
    run("export-audit-pack", "bun", ["scripts/dev/export-audit-pack.mjs"], {
      APP_ENV: "local",
      CONFIRM_AUDIT_EXPORT: "YES",
      AUDIT_EXPORT_SKIP_ENSURE: "1",
    }),
  );

  const overallStatus = steps.every((step) => step.ok) ? "PASS" : steps.some((step) => step.ok) ? "WARN" : "FAIL";
  const payload = {
    generatedAt: new Date().toISOString(),
    dataset: useLarge ? "large" : "small",
    overallStatus,
    steps,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(summaryJsonPath, JSON.stringify(payload, null, 2), "utf-8");
  await writeFile(
    summaryMdPath,
    [
      "# Pilot Readiness Summary",
      "",
      `Generated at: ${payload.generatedAt}`,
      `Dataset: ${payload.dataset}`,
      `Overall status: ${payload.overallStatus}`,
      "",
      ...steps.flatMap((step) => [
        `## ${step.label}`,
        `- Status: ${step.ok ? "PASS" : "FAIL"}`,
        `- Exit code: ${step.status}`,
        step.stderr ? `- stderr: ${step.stderr}` : null,
        step.stdout ? "```text\n" + step.stdout + "\n```" : null,
        "",
      ]).filter(Boolean),
    ].join("\n"),
    "utf-8",
  );

  console.log(`[run-pilot-readiness] ${payload.overallStatus} -> ${summaryJsonPath}`);
  process.exit(overallStatus === "FAIL" ? 1 : 0);
};

main().catch((error) => {
  console.error("[run-pilot-readiness] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
