#!/usr/bin/env node

import process from "node:process";
import { runGoogleDriveLocalAuth } from "./_lib/google-drive-auth.mjs";

try {
  await runGoogleDriveLocalAuth();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const code = typeof error?.code === "string" ? error.code : "gdrive_oauth_failed";
  process.stderr.write(`Failed [${code}]: ${message}\n`);
  process.exit(1);
}
