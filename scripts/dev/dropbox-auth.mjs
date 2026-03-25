#!/usr/bin/env node

import process from "node:process";
import { runDropboxLocalAuth } from "./_lib/dropbox-auth.mjs";

try {
  await runDropboxLocalAuth();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const code = typeof error?.code === "string" ? error.code : "dropbox_oauth_failed";
  process.stderr.write(`Failed [${code}]: ${message}\n`);
  process.exit(1);
}
