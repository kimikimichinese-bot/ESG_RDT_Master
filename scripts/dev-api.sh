#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-${PORT:-3001}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../apps/api" && pwd)"

cd "$PROJECT_DIR"

"$SCRIPT_DIR/kill-dev-ports.sh" "$API_PORT"

if lsof -iTCP:"$API_PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "Port $API_PORT is already in use."
  echo "Set API_PORT to an open port and retry, or stop the process using that port."
  exit 1
fi

PORT="$API_PORT" bun src/index.ts
