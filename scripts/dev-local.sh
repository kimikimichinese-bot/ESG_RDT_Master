#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
API_HEALTH_PATH="${API_HEALTH_PATH:-/health}"
API_WAIT_SECONDS="${API_WAIT_SECONDS:-8}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT
trap "exit 130" INT TERM
"$SCRIPT_DIR/kill-dev-ports.sh" "$API_PORT" "$WEB_PORT"

bash ./scripts/dev-api.sh &
API_PID=$!

echo "Starting API (PID $API_PID) on port $API_PORT..."
for _ in $(seq 1 "$API_WAIT_SECONDS"); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API failed to stay running. Check API logs in the terminal output."
    exit 1
  fi

  if curl -fsS "http://127.0.0.1:$API_PORT$API_HEALTH_PATH" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! kill -0 "$API_PID" 2>/dev/null; then
  echo "API exited before startup check completed."
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:$API_PORT$API_HEALTH_PATH" >/dev/null 2>&1; then
  echo "API did not become ready on port $API_PORT within timeout."
  exit 1
fi

if ! bun run dev:web; then
  exit_code=$?
  cleanup
  exit "$exit_code"
fi
