#!/usr/bin/env node

import process from "node:process";
import { runOneDriveLocalAuth } from "./_lib/onedrive-auth.mjs";

try {
  await runOneDriveLocalAuth();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const code = typeof error?.code === "string" ? error.code : "onedrive_oauth_failed";
  process.stderr.write(`Failed [${code}]: ${message}\n`);
  process.exit(1);
}
