#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 0 ]; then
  PORTS=("$@")
else
  PORTS=("3000" "3001")
fi

for PORT in "${PORTS[@]}"; do
  PORT="${PORT#"${PORT%%[![:space:]]*}"}"
  PORT="${PORT%"${PORT##*[![:space:]]}"}"
  if [ -z "$PORT" ]; then
    continue
  fi

  for PID in $(lsof -iTCP:"$PORT" -sTCP:LISTEN -t -P -n || true); do
    kill "$PID" >/dev/null 2>&1 || true
  done
done
