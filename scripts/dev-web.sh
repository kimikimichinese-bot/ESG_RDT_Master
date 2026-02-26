#!/usr/bin/env bash
set -euo pipefail

WEB_PORT="${WEB_PORT:-${PORT:-3000}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../apps/web" && pwd)"

cd "$PROJECT_DIR"

"$SCRIPT_DIR/kill-dev-ports.sh" "$WEB_PORT"

if lsof -iTCP:"$WEB_PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "Port $WEB_PORT is already in use."
  echo "Set WEB_PORT to an open port and retry, or stop the process using that port."
  exit 1
fi

PORT="$WEB_PORT" bun run dev
