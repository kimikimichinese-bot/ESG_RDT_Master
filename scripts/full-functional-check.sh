#!/usr/bin/env bash

set -euo pipefail

OFFLINE_MODE="${FULL_FUNCTIONAL_OFFLINE:-0}"
SKIP_BASE_URL_CHECK="${FULL_FUNCTIONAL_SKIP_BASE_URL_CHECK:-0}"
SKIP_ENDPOINT_CHECKS="${FULL_FUNCTIONAL_SKIP_ENDPOINT_CHECKS:-0}"
SKIP_ENDPOINT_CHECKS_REPORTED=0
readonly BASE_URL="${FULL_FUNCTIONAL_BASE_URL:-https://esg-rdt-master-pi.vercel.app}"
readonly SERVER_LOG="/tmp/.esg-full-functional-server.log"
readonly TEST_TIMEOUT_SECONDS=60
readonly BASE_HOST_PORT="${BASE_URL#*://}"
readonly BASE_HOST="${BASE_HOST_PORT%%/*}"
readonly BASE_HOST_ONLY="${BASE_HOST%%:*}"
BASE_PORT_FROM_URL=3000

if [[ "${BASE_HOST}" == *:* ]]; then
  BASE_PORT_FROM_URL="${BASE_HOST#*:}"
fi
BIND_HOST="${FULL_FUNCTIONAL_BIND_HOST:-${BASE_HOST_ONLY:-127.0.0.1}}"
readonly BIND_PORT="${FULL_FUNCTIONAL_BIND_PORT:-${BASE_PORT_FROM_URL}}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/tmp/ms-playwright}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline)
      OFFLINE_MODE=1
      ;;
    --skip-base-check)
      SKIP_BASE_URL_CHECK=1
      ;;
    --skip-endpoint-checks)
      SKIP_ENDPOINT_CHECKS=1
      ;;
    --help|-h)
      echo "Usage: $0 [--offline] [--skip-base-check] [--skip-endpoint-checks]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--offline]"
      exit 1
      ;;
  esac
  shift
done

SERVER_PID=""
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "[PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "[FAIL] $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

mark_hard_fail() {
  echo "[FAIL] $1"
  exit 1
}

is_port_open() {
  local host="$1"
  local port="$2"

  if [[ -z "${host}" || -z "${port}" ]]; then
    return 1
  fi

  (exec 3<>"/dev/tcp/${host}/${port}") >/dev/null 2>&1
}

probe_base_url() {
  local probe_url="$1"
  local host="$2"
  local port="$3"

  if curl -sS --max-time 2 "${probe_url}" >/dev/null; then
    return 0
  fi

  if is_port_open "${host}" "${port}"; then
    echo "[WARN] Base URL HTTP check failed, but TCP socket is open (${host}:${port})."
    return 0
  fi

  return 1
}

if ! command -v bun >/dev/null 2>&1; then
  mark_hard_fail "bun is required to run full-functional checks"
fi

if ! command -v curl >/dev/null 2>&1; then
  mark_hard_fail "curl is required to run full-functional checks"
fi

if ! command -v jq >/dev/null 2>&1; then
  mark_hard_fail "jq is required to run full-functional checks"
fi

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

should_run_local() {
  if is_offline_mode; then
    return 1
  fi

  case "${BASE_URL}" in
    *127.0.0.1*|*localhost*) return 0 ;;
    *) return 1 ;;
  esac
}

is_offline_mode() {
  case "${OFFLINE_MODE}" in
    1|TRUE|True|true|YES|Yes|yes|ON|On|on) return 0 ;;
    *) return 1 ;;
  esac
}

start_local_app() {
  if ! should_run_local; then
    pass "using remote target URL: ${BASE_URL}"
    return 0
  fi

  local host_candidates=("${BIND_HOST}")
  if [[ -z "${FULL_FUNCTIONAL_BIND_HOST:-}" && "${BIND_HOST}" == "127.0.0.1" ]]; then
    host_candidates=("127.0.0.1" "localhost" "0.0.0.0")
  fi

  local host
  for host in "${host_candidates[@]}"; do
    if [[ "${BIND_HOST}" != "${host}" ]]; then
      echo "[INFO] Trying alternate local bind host: ${host}"
    fi

    echo "Starting local app on ${host}:${BIND_PORT}..."
    bun run --filter @esg-rdt/web dev -- --hostname "${host}" --port "${BIND_PORT}" >"${SERVER_LOG}" 2>&1 &
    SERVER_PID=$!

    local elapsed=0
    while [[ ${elapsed} -lt ${TEST_TIMEOUT_SECONDS} ]]; do
      if curl -sS --max-time 2 "${BASE_URL}" >/dev/null; then
        BIND_HOST="${host}"
        pass "local server readiness"
        return 0
      fi
      elapsed=$((elapsed + 1))
      sleep 1
    done

    if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
      kill "${SERVER_PID}" >/dev/null 2>&1 || true
      wait "${SERVER_PID}" >/dev/null 2>&1 || true
      SERVER_PID=""
    fi
  done

  echo "[FAIL] local app failed to start within ${TEST_TIMEOUT_SECONDS}s"
  echo "--- server log ---"
  tail -n 60 "${SERVER_LOG}" || true
  echo "--- end server log ---"
  echo "Tip: rerun with --offline to skip local app/startup and browser checks in restricted environments."
  return 1
}

run_static_render_check() {
  local html
  if ! html="$(curl -sS --max-time 10 "${BASE_URL}/")"; then
    fail "Homepage did not render"
    return 1
  fi

  local requirements=(
    "ESG RDT Master"
    "Production workspace with diagnostics-first UI."
    "Release readiness"
    "Progress map"
    "Module completion"
    "Next actions"
    "Copy snapshot JSON"
    "Refresh now"
  )

  local requirement
  for requirement in "${requirements[@]}"; do
    if grep -Fq "${requirement}" <<<"${html}"; then
      pass "Static UI contains: ${requirement}"
    else
      fail "Static UI missing required marker: ${requirement}"
    fi
  done
}

run_json_check() {
  if [[ "${SKIP_ENDPOINT_CHECKS}" == "1" ]]; then
    if [[ "${SKIP_ENDPOINT_CHECKS_REPORTED}" == "0" ]]; then
      pass "Endpoint checks skipped by request"
      SKIP_ENDPOINT_CHECKS_REPORTED=1
    fi
    return 0
  fi

  local endpoint="$1"
  local label="$2"
  local url="${BASE_URL%/}${endpoint}"
  local payload_file headers_file curl_meta
  local status_code content_type payload sample
  local attempt=1
  local max_attempts=3
  local attempt_wait_seconds=1

  payload_file="$(mktemp)"
  headers_file="$(mktemp)"

  while true; do
    if curl_meta="$(curl -sS --max-time 10 -D "${headers_file}" -o "${payload_file}" -w '%{http_code}\n%{content_type}\n' "${url}")"; then
      break
    fi

    if (( attempt < max_attempts )); then
      rm -f "${payload_file}" "${headers_file}"
      echo "[WARN] Retrying ${endpoint} (attempt ${attempt}/${max_attempts}) in ${attempt_wait_seconds}s"
      sleep "${attempt_wait_seconds}"
      attempt=$((attempt + 1))
      attempt_wait_seconds=$((attempt_wait_seconds * 2))
      payload_file="$(mktemp)"
      headers_file="$(mktemp)"
      continue
    fi

    rm -f "${payload_file}" "${headers_file}"
    fail "Endpoint unreachable: ${endpoint}"
    return 1
  done

  status_code="$(printf '%s\n' "${curl_meta}" | sed -n '1p')"
  content_type="$(printf '%s\n' "${curl_meta}" | sed -n '2p')"
  status_code="${status_code:-0}"
  content_type="${content_type:-unknown}"
  payload="$(cat "${payload_file}")"

  if [[ "${status_code}" == "404" ]]; then
    rm -f "${payload_file}" "${headers_file}"
    fail "Endpoint missing / legacy route: ${endpoint} (HTTP ${status_code})"
    return 1
  fi

  if [[ ! "${status_code}" =~ ^2 ]]; then
    rm -f "${payload_file}" "${headers_file}"
    fail "Endpoint returned HTTP ${status_code}: ${endpoint}"
    return 1
  fi

  if [[ "${content_type}" != *"application/json"* ]]; then
    sample="$(printf "%s" "${payload}" | tr -d "\n" | sed 's/^[[:space:]]*//')"
    sample="${sample:0:120}"
    rm -f "${payload_file}" "${headers_file}"
    if [[ "${content_type}" == text/html* ]] || [[ "${sample}" == \<* ]]; then
      fail "Endpoint returned HTML for ${endpoint} (expected JSON API). HTTP ${status_code}; likely legacy or missing V1 route."
    else
      fail "Endpoint returned non-JSON payload for ${endpoint} (content-type: ${content_type}). Sample: ${sample}"
    fi
    return 1
  fi

  if ! printf '%s\n' "${payload}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    rm -f "${payload_file}" "${headers_file}"
    fail "Endpoint payload is not a JSON object: ${endpoint}"
    return 1
  fi

  pass "JSON endpoint reachable: ${endpoint}"

  if [[ -n "${label}" ]]; then
    if printf '%s\n' "${payload}" | jq -e "${label}" >/dev/null 2>&1; then
      pass "Payload assertion passed: ${endpoint} -> ${label}"
    else
      fail "Payload assertion failed: ${endpoint} -> ${label}"
    fi
  fi

  rm -f "${payload_file}" "${headers_file}"

  return 0
}

run_playwright_if_present() {
  if [[ -x "apps/web/node_modules/.bin/playwright" ]]; then
    echo "Running Playwright full UX suite..."
    if (cd apps/web && PLAYWRIGHT_BASE_URL="${BASE_URL}" PLAYWRIGHT_BIND_HOST="${BIND_HOST}" PLAYWRIGHT_BIND_PORT="${BIND_PORT}" PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH}" ./node_modules/.bin/playwright test); then
      pass "Playwright functional suite"
    else
      fail "Playwright functional suite"
    fi
    return
  fi

  echo "Skipping Playwright suite (not installed)."
}

wait_for_base_url() {
  if [[ "${SKIP_BASE_URL_CHECK}" == "1" ]]; then
    echo "[INFO] Skipping base URL reachability check by request."
    return 0
  fi

  local base_ready=0
  local base_url_health_checks=12
  local attempt=0
  local wait_seconds=1
  local probe_url="${BASE_URL%/}/"

  while (( attempt < base_url_health_checks )); do
    attempt=$((attempt + 1))
    if probe_base_url "${probe_url}" "${BASE_HOST_ONLY}" "${BASE_PORT_FROM_URL}"; then
      base_ready=1
      break
    fi
    sleep "${wait_seconds}"
    wait_seconds=$((wait_seconds + 1))
  done

  if [[ "${base_ready}" -ne 1 ]]; then
    fail "Base URL not reachable: ${BASE_URL}"
    return 1
  fi

  return 0
}

if is_offline_mode; then
  echo "[INFO] FULL_FUNCTIONAL_OFFLINE enabled; skipping local app startup, static UI checks, and Playwright suite"
else
  start_local_app || fail "local app startup check"
  run_static_render_check || fail "static UI checks"
  run_playwright_if_present
fi

wait_for_base_url

run_json_check "/api/ready" 'has("status")' || fail "api ready contract"
run_json_check "/api/v1/health" 'has("status")' || fail "api health contract"
run_json_check "/api/v1/status" 'has("status")' || fail "api status contract"
run_json_check "/api/v1/progress" 'has("source") and has("productSignals") and has("progress")' || fail "api progress contract"

echo
echo "Full functional matrix complete: ${PASS_COUNT} pass, ${FAIL_COUNT} fail"
if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  echo "FAILED: ${FAIL_COUNT} checks failed."
  exit 1
fi
echo "All checks passed."
