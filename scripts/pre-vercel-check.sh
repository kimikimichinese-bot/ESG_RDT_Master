#!/usr/bin/env bash

set -euo pipefail

PASS_COUNT=0
FAIL_COUNT=0

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/tmp/ms-playwright}"
ENV_FILES=()
OFFLINE_MODE="${FULL_FUNCTIONAL_OFFLINE:-0}"
SKIP_BASE_URL_CHECK="${FULL_FUNCTIONAL_SKIP_BASE_URL_CHECK:-0}"
SKIP_ENDPOINT_CHECKS="${FULL_FUNCTIONAL_SKIP_ENDPOINT_CHECKS:-0}"
BASE_URL="${FULL_VERCEL_TEST_URL:-${FULL_FUNCTIONAL_BASE_URL:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-env)
      if [[ $# -lt 2 ]]; then
        echo "Usage: $0 [--with-env <file>] [--offline] [--skip-base-check] [--skip-endpoint-checks]"
        exit 1
      fi
      ENV_FILES+=("$2")
      shift
      ;;
    --offline)
      OFFLINE_MODE=1
      SKIP_BASE_URL_CHECK=1
      ;;
    --skip-base-check)
      SKIP_BASE_URL_CHECK=1
      ;;
    --skip-endpoint-checks)
      SKIP_ENDPOINT_CHECKS=1
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--with-env <file>] [--offline] [--skip-base-check] [--skip-endpoint-checks]"
      exit 1
      ;;
  esac
  shift
done

if [[ ${#ENV_FILES[@]} -eq 0 ]]; then
  ENV_FILES=(.env.vercel.local .env.local)
fi

for env_file in "${ENV_FILES[@]}"; do
  if [ -f "$env_file" ]; then
    echo "[ENV] Loaded ${env_file}"
    set -a
    # shellcheck disable=SC1091
    . "$env_file"
    set +a
  fi
done

BASE_URL="${BASE_URL:-${FULL_VERCEL_TEST_URL:-${FULL_FUNCTIONAL_BASE_URL:-http://127.0.0.1:3000}}}"

if [ -n "${BASE_URL}" ]; then
  echo "[INPUT] Functional check target: ${BASE_URL}"
fi

pass() {
  echo "[PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "[FAIL] $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

run_gate() {
  local label="$1"
  shift

  echo
  echo "[${label}] RUN: $*"
  local out_file
  out_file="$(mktemp)"

  local rc=0
  set +e
  "$@" >"${out_file}" 2>&1
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    pass "$label"
  else
    fail "$label (exit $rc)"
  fi

  cat "${out_file}"
  rm -f "${out_file}"
}

run_gate "bun_install" bun install
run_gate "prod_env_check" ./scripts/prod-env-check.sh
run_gate "workspace_lint" bun run workspace:lint
run_gate "workspace_build" bun run workspace:build
run_gate "db_generate" bun run db:generate
run_gate "db_check" bun run db:check
run_gate "db_status" bun run db:status
RUN_FULL_FUNCTIONAL=( "env" 
  "FULL_FUNCTIONAL_BASE_URL=${BASE_URL}"
  "FULL_FUNCTIONAL_OFFLINE=${OFFLINE_MODE}"
  "FULL_FUNCTIONAL_SKIP_BASE_URL_CHECK=${SKIP_BASE_URL_CHECK}"
  "FULL_FUNCTIONAL_SKIP_ENDPOINT_CHECKS=${SKIP_ENDPOINT_CHECKS}"
  bash ./scripts/full-functional-check.sh
)

if [[ "${OFFLINE_MODE}" == "1" ]]; then
  RUN_FULL_FUNCTIONAL+=( --offline )
fi

run_gate "full_functional" "${RUN_FULL_FUNCTIONAL[@]}"

echo
echo "--- PRE-VERCEL MATRIX ---"
echo "PASS ${PASS_COUNT} | FAIL ${FAIL_COUNT}"
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "[RESULT] FAILED"
  exit 1
fi

echo "[RESULT] PASSED"
