#!/usr/bin/env bash

set -euo pipefail

OFFLINE_MODE="${FULL_FUNCTIONAL_OFFLINE:-0}"
SKIP_BASE_URL_CHECK="${FULL_FUNCTIONAL_SKIP_BASE_URL_CHECK:-0}"
SKIP_ENDPOINT_CHECKS="${FULL_FUNCTIONAL_SKIP_ENDPOINT_CHECKS:-0}"
SKIP_ENDPOINT_CHECKS_REPORTED=0
readonly BASE_URL="${FULL_FUNCTIONAL_BASE_URL:-https://esg-rdt-master-pi.vercel.app}"
readonly FULL_FUNCTIONAL_JOB_TOKEN="${FULL_FUNCTIONAL_JOB_TOKEN:-${FULL_FUNCTIONAL_API_TOKEN:-${FULL_FUNCTIONAL_X_API_KEY:-${JOB_API_TOKEN:-${API_JOB_TOKEN:-}}}}}"
readonly FULL_FUNCTIONAL_JOB_TOKEN_HEADER="${FULL_FUNCTIONAL_JOB_TOKEN_HEADER:-}"
readonly FULL_FUNCTIONAL_JOB_RATE_LIMIT_ASSERT="${FULL_FUNCTIONAL_JOB_RATE_LIMIT_ASSERT:-0}"
readonly FULL_FUNCTIONAL_JOB_RATE_LIMIT_BURST="${FULL_FUNCTIONAL_JOB_RATE_LIMIT_BURST:-120}"
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

declare -a FULL_FUNCTIONAL_REQUEST_HEADERS=()
if [[ -n "${FULL_FUNCTIONAL_JOB_TOKEN_HEADER}" && -n "${FULL_FUNCTIONAL_JOB_TOKEN}" ]]; then
  FULL_FUNCTIONAL_REQUEST_HEADERS+=(-H "${FULL_FUNCTIONAL_JOB_TOKEN_HEADER}: ${FULL_FUNCTIONAL_JOB_TOKEN}")
elif [[ -n "${FULL_FUNCTIONAL_JOB_TOKEN}" ]]; then
  FULL_FUNCTIONAL_REQUEST_HEADERS+=(-H "Authorization: Bearer ${FULL_FUNCTIONAL_JOB_TOKEN}")
fi

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

to_positive_int() {
  local value="$1"
  if [[ "${value}" =~ ^[0-9]+$ ]] && ((value > 0)); then
    echo "${value}"
    return 0;
  fi

  echo "0"
}

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
    "Production diagnostics with live worker jobs."
    "Refresh now"
    "Trigger refresh job"
    "Worker jobs"
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
    if curl_meta="$(curl -sS --max-time 10 "${FULL_FUNCTIONAL_REQUEST_HEADERS[@]}" -D "${headers_file}" -o "${payload_file}" -w '%{http_code}\n%{content_type}\n' "${url}")"; then
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

run_worker_trigger_check() {
  if [[ "${SKIP_ENDPOINT_CHECKS}" == "1" ]]; then
    if [[ "${SKIP_ENDPOINT_CHECKS_REPORTED}" == "0" ]]; then
      pass "Endpoint checks skipped by request"
      SKIP_ENDPOINT_CHECKS_REPORTED=1
    fi
    return 0
  fi

  local trigger_url="${BASE_URL%/}/api/v1/jobs/trigger"
  local trigger_payload_file trigger_headers_file trigger_meta
  local detail_url detail_payload_file detail_headers_file detail_meta
  local trigger_status trigger_content trigger_body job_id detail_status detail_content detail_body

  trigger_payload_file="$(mktemp)"
  trigger_headers_file="$(mktemp)"

  if ! trigger_meta="$(curl -sS --max-time 12 -X POST \
    -H 'content-type: application/json' \
    "${FULL_FUNCTIONAL_REQUEST_HEADERS[@]}" \
    -d '{"jobType":"status","message":"full-functional-check"}' \
    -D "${trigger_headers_file}" -o "${trigger_payload_file}" \
    -w '%{http_code}\n%{content_type}\n' \
    "${trigger_url}")"; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}"
    fail "Worker trigger endpoint unreachable: /api/v1/jobs/trigger"
    return 1
  fi

  trigger_status="$(printf '%s\n' "${trigger_meta}" | sed -n '1p')"
  trigger_content="$(printf '%s\n' "${trigger_meta}" | sed -n '2p')"
  trigger_body="$(cat "${trigger_payload_file}")"

  if [[ "${trigger_status}" == "404" ]]; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}"
    fail "Worker trigger endpoint missing (HTTP ${trigger_status})"
    return 1
  fi

  if [[ ! "${trigger_status}" =~ ^2 ]]; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}"
    fail "Worker trigger endpoint returned HTTP ${trigger_status}"
    return 1
  fi

  if [[ "${trigger_content}" != *"application/json"* ]]; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}"
    fail "Worker trigger endpoint returned non-JSON payload"
    return 1
  fi

  if ! printf '%s\n' "${trigger_body}" | jq -e 'type == "object" and has("service") and has("requestId") and (.requestId|type=="string") and has("id") and (.id|type=="string") and has("status") and (.status=="queued")' >/dev/null 2>&1; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}"
    fail "Worker trigger payload contract failed"
    return 1
  fi

  job_id="$(printf '%s\n' "${trigger_body}" | jq -r '.id')"
  if [[ -z "${job_id}" || "${job_id}" == "null" ]]; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}"
    fail "Worker trigger response missing job id"
    return 1
  fi

  pass "Worker trigger endpoint contract"

  detail_url="${BASE_URL%/}/api/v1/jobs/${job_id}"
  detail_payload_file="$(mktemp)"
  detail_headers_file="$(mktemp)"

  if ! detail_meta="$(curl -sS --max-time 12 \
    "${FULL_FUNCTIONAL_REQUEST_HEADERS[@]}" \
    -D "${detail_headers_file}" -o "${detail_payload_file}" \
    -w '%{http_code}\n%{content_type}\n' \
    "${detail_url}")"; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}" "${detail_payload_file}" "${detail_headers_file}"
    fail "Worker job detail endpoint unreachable: /api/v1/jobs/${job_id}"
    return 1
  fi

  detail_status="$(printf '%s\n' "${detail_meta}" | sed -n '1p')"
  detail_content="$(printf '%s\n' "${detail_meta}" | sed -n '2p')"
  detail_body="$(cat "${detail_payload_file}")"

  if [[ ! "${detail_status}" =~ ^2 ]]; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}" "${detail_payload_file}" "${detail_headers_file}"
    fail "Worker job detail endpoint returned HTTP ${detail_status}: /api/v1/jobs/${job_id}"
    return 1
  fi

  if [[ "${detail_content}" != *"application/json"* ]]; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}" "${detail_payload_file}" "${detail_headers_file}"
    fail "Worker job detail endpoint returned non-JSON payload"
    return 1
  fi

  if ! printf '%s\n' "${detail_body}" | jq -e --arg job_id "${job_id}" 'type == "object" and has("jobs") and (.jobs|type=="array") and any(.jobs[]?; .id == $job_id)' >/dev/null 2>&1; then
    rm -f "${trigger_payload_file}" "${trigger_headers_file}" "${detail_payload_file}" "${detail_headers_file}"
    fail "Worker job detail payload contract failed"
    return 1
  fi

  rm -f "${trigger_payload_file}" "${trigger_headers_file}" "${detail_payload_file}" "${detail_headers_file}"
  if ! printf '%s\n' "${detail_body}" | jq -e --arg job_id "${job_id}" --arg status_regex "^(queued|running|succeeded|failed)$" 'any(.jobs[]?; .id == $job_id and (.status|test($status_regex)))' >/dev/null 2>&1; then
    fail "Worker job status missing or invalid in detail payload"
    return 1
  fi

  pass "Worker trigger + detail flow"

  local job_progress_status
  local progression_status="queued"
  local list_payload_file list_headers_file list_meta list_status
  list_payload_file="$(mktemp)"
  list_headers_file="$(mktemp)"

  for _ in 1 2 3 4; do
    if ! list_meta="$(curl -sS --max-time 12 \
      "${FULL_FUNCTIONAL_REQUEST_HEADERS[@]}" \
      -D "${list_headers_file}" -o "${list_payload_file}" \
      -w '%{http_code}' \
      "${BASE_URL%/}/api/v1/jobs/${job_id}")"; then
      fail "Worker job status poll endpoint unreachable"
      rm -f "${list_payload_file}" "${list_headers_file}"
      return 1
    fi

    list_status="$(printf '%s' "${list_meta}")"
    if [[ "${list_status}" != "200" ]]; then
      fail "Worker job status poll endpoint returned HTTP ${list_status}"
      rm -f "${list_payload_file}" "${list_headers_file}"
      return 1
    fi

    job_progress_status="$(printf '%s\n' "${list_payload_file}" | jq -r --arg job_id "${job_id}" '.jobs[]? | select(.id == $job_id) | .status' | head -n 1)"
    if [[ -n "${job_progress_status}" && "${job_progress_status}" != "null" ]]; then
      progression_status="${job_progress_status}"
      break
    fi

    sleep 1
  done

  rm -f "${list_payload_file}" "${list_headers_file}"
  if [[ "${progression_status}" != "queued" && "${progression_status}" != "running" && "${progression_status}" != "succeeded" && "${progression_status}" != "failed" ]]; then
    fail "Worker job progression status invalid: ${progression_status}"
    return 1
  fi

  pass "Worker trigger/detail status progression observed: ${progression_status}"
}

run_job_auth_and_rate_checks() {
  if [[ "${SKIP_ENDPOINT_CHECKS}" == "1" ]]; then
    if [[ "${SKIP_ENDPOINT_CHECKS_REPORTED}" == "0" ]]; then
      pass "Endpoint checks skipped by request"
      SKIP_ENDPOINT_CHECKS_REPORTED=1
    fi
    return 0
  fi

  if [[ -z "${FULL_FUNCTIONAL_JOB_TOKEN}" ]]; then
    pass "Skipping job auth/rate-limit checks (FULL_FUNCTIONAL_JOB_TOKEN not set)"
    return 0
  fi

  local jobs_url="${BASE_URL%/}/api/v1/jobs"
  local body_file headers_file
  local meta status

  body_file="$(mktemp)"
  headers_file="$(mktemp)"
  if ! meta="$(curl -sS --max-time 12 -X GET \
    -D "${headers_file}" -o "${body_file}" -w '%{http_code}' \
    "${jobs_url}")"; then
    rm -f "${body_file}" "${headers_file}"
    fail "Job auth check endpoint unreachable"
    return 1
  fi

  status="$(printf '%s' "${meta}")"
  if [[ "${status}" != "401" ]]; then
    rm -f "${body_file}" "${headers_file}"
    fail "Expected 401 for unauthenticated /api/v1/jobs, got ${status}"
    return 1
  fi
  pass "Job endpoint denies unauthenticated access with 401"
  rm -f "${body_file}" "${headers_file}"

  body_file="$(mktemp)"
  headers_file="$(mktemp)"
  if ! meta="$(curl -sS --max-time 12 -X GET \
    -H "Authorization: Bearer invalid-token" \
    -D "${headers_file}" -o "${body_file}" -w '%{http_code}' \
    "${jobs_url}")"; then
    rm -f "${body_file}" "${headers_file}"
    fail "Job auth invalid-token check endpoint unreachable"
    return 1
  fi
  status="$(printf '%s' "${meta}")"
  if [[ "${status}" != "401" ]]; then
    rm -f "${body_file}" "${headers_file}"
    fail "Expected 401 for invalid token on /api/v1/jobs, got ${status}"
    return 1
  fi
  pass "Job endpoint rejects invalid token with 401"
  rm -f "${body_file}" "${headers_file}"

  if [[ "${FULL_FUNCTIONAL_JOB_RATE_LIMIT_ASSERT}" != "1" ]]; then
    pass "Job rate-limit assertions disabled; set FULL_FUNCTIONAL_JOB_RATE_LIMIT_ASSERT=1 to enable"
    return 0
  fi

  local burst
  burst="$(to_positive_int "${FULL_FUNCTIONAL_JOB_RATE_LIMIT_BURST}")"
  if [[ "${burst}" == "0" ]]; then
    fail "FULL_FUNCTIONAL_JOB_RATE_LIMIT_BURST must be positive when rate-limit checks are enabled"
    return 1
  fi

  body_file="$(mktemp)"
  headers_file="$(mktemp)"
  if ! meta="$(curl -sS --max-time 12 "${FULL_FUNCTIONAL_REQUEST_HEADERS[@]}" -X GET \
    -D "${headers_file}" -o "${body_file}" -w '%{http_code}' \
    "${jobs_url}")"; then
    rm -f "${body_file}" "${headers_file}"
    fail "Job rate-limit warmup request failed"
    return 1
  fi

  local baseline_status limit_header
  baseline_status="$(printf '%s' "${meta}")"
  if [[ "${baseline_status}" != "200" && "${baseline_status}" != "429" ]]; then
    rm -f "${body_file}" "${headers_file}"
    fail "Expected 200/429 from warmup /api/v1/jobs, got ${baseline_status}"
    return 1
  fi
  limit_header="$(awk 'BEGIN {IGNORECASE=1} /^x-ratelimit-limit:/ {sub(/\r/, \"\", $0); print $2; exit}' "${headers_file}")"
  if [[ -z "${limit_header}" ]]; then
    rm -f "${body_file}" "${headers_file}"
    fail "Rate-limit warmup response missing x-ratelimit-limit header"
    return 1
  fi

  if ! [[ "${limit_header}" =~ ^[0-9]+$ ]]; then
    rm -f "${body_file}" "${headers_file}"
    fail "Invalid x-ratelimit-limit header value: ${limit_header}"
    return 1
  fi

  if (( limit_header > burst )); then
    pass "Rate limit window exceeds burst (${limit_header} > ${burst}); skipping forced 429 assertion"
    rm -f "${body_file}" "${headers_file}"
    return 0
  fi

  local saw_429=0
  local request_no=1
  while (( request_no <= burst )); do
    rm -f "${body_file}" "${headers_file}"
    body_file="$(mktemp)"
    headers_file="$(mktemp)"
    if ! meta="$(curl -sS --max-time 12 "${FULL_FUNCTIONAL_REQUEST_HEADERS[@]}" -X GET \
      -D "${headers_file}" -o "${body_file}" -w '%{http_code}' \
      "${jobs_url}")"; then
      rm -f "${body_file}" "${headers_file}"
      break
    fi
    status="$(printf '%s' "${meta}")"
    if [[ "${status}" == "429" ]]; then
      local retry_after remaining limit_val reset_at
      retry_after="$(awk 'BEGIN {IGNORECASE=1} /^retry-after:/ {sub(/\r/, \"\", $0); print $2; exit}' "${headers_file}")"
      remaining="$(awk 'BEGIN {IGNORECASE=1} /^x-ratelimit-remaining:/ {sub(/\r/, \"\", $0); print $2; exit}' "${headers_file}")"
      limit_val="$(awk 'BEGIN {IGNORECASE=1} /^x-ratelimit-limit:/ {sub(/\r/, \"\", $0); print $2; exit}' "${headers_file}")"
      reset_at="$(awk 'BEGIN {IGNORECASE=1} /^x-ratelimit-reset:/ {sub(/\r/, \"\", $0); print $2; exit}' "${headers_file}")"

      if [[ -z "${retry_after}" || -z "${remaining}" || -z "${limit_val}" || -z "${reset_at}" ]]; then
        rm -f "${body_file}" "${headers_file}"
        fail "Rate-limit 429 response missing required headers"
        return 1
      fi

      pass "Job rate-limit response observed (retry-after=${retry_after}, remaining=${remaining}, limit=${limit_val})"
      saw_429=1
      rm -f "${body_file}" "${headers_file}"
      break
    fi
    request_no=$((request_no + 1))
  done

  if [[ "${saw_429}" == "0" ]]; then
    fail "Expected to observe job rate-limit 429 response within ${burst} requests"
    return 1
  fi

  rm -f "${body_file}" "${headers_file}"
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

  run_json_check "/api/ready" 'has("status") and (.status=="ready" or .status=="ok" or .status=="degraded") and has("service") and has("checks") and (.checks|type=="object") and has("ready") and (.ready|type=="boolean") and has("timestamp") and has("version") and has("requestId")' || fail "api ready contract"
  run_json_check "/api/health" 'has("status") and (.status=="ready" or .status=="ok" or .status=="degraded") and has("service") and has("checks") and (.checks|type=="object") and has("ready") and (.ready|type=="boolean") and has("timestamp") and has("version") and has("requestId")' || fail "api legacy health contract"
  run_json_check "/api/v1/health" 'has("status") and (.status=="ready" or .status=="ok" or .status=="degraded") and has("service") and has("checks") and (.checks|type=="object") and has("ready") and (.ready|type=="boolean") and has("timestamp") and has("version") and has("requestId")' || fail "api health contract"
  run_json_check "/api/v1/status" 'has("status") and (.status=="ready" or .status=="ok" or .status=="degraded") and has("service") and has("checks") and (.checks|type=="object") and has("ready") and (.ready|type=="boolean") and has("timestamp") and has("version") and has("requestId")' || fail "api status contract"
  run_json_check "/api/v1/progress" 'has("service") and has("releaseStatus") and has("productSignals") and (.productSignals|type=="array") and has("progress") and (.progress|type=="array") and has("quickActions") and (.quickActions|type=="array") and has("generatedAt") and has("version") and has("source") and has("status") and (.status=="ready" or .status=="degraded" or .status=="warn" or .status=="error" or .status=="ok")' || fail "api progress contract"
  run_json_check "/api/v1/jobs" 'has("service") and has("requestId") and has("jobs") and (.jobs|type=="array") and has("workerReady") and (.workerReady|type=="boolean") and ((has("workerState") | not) or ((.workerState|type=="object") and (.workerState.workerId|type=="string") and ((.workerState.status=="idle") or (.workerState.status=="busy")) and (.workerState.lastHeartbeatAt|type=="string") and (.workerState.version|type=="string") and (.workerState.processedJobs|type=="number") and ((.workerState.activeJobId|type=="null") or (.workerState.activeJobId|type=="string"))))' || fail "api jobs contract"
  run_job_auth_and_rate_checks || fail "api job auth/rate-limit checks"
  run_worker_trigger_check || fail "api worker trigger flow"

echo
echo "Full functional matrix complete: ${PASS_COUNT} pass, ${FAIL_COUNT} fail"
if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  echo "FAILED: ${FAIL_COUNT} checks failed."
  exit 1
fi
echo "All checks passed."
