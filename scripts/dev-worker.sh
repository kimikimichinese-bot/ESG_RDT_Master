#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../apps/worker" && pwd)"
cd "$PROJECT_DIR"

bun run src/index.ts
