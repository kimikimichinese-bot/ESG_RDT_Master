#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${1:-https://esg-rdt-master-pi.vercel.app}"
TEST_URL="${2:-https://example.com}"

get_json_field() {
  local json_payload="$1"
  local jq_path="$2"
  printf '%s' "$json_payload" | jq -r "$jq_path"
}

extract_job_id() {
  local json_payload="$1"
  printf '%s\n' "$json_payload" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

fetch_job_detail() {
  local job_id="$1"
  curl -sS "${BASE_URL}/api/v1/jobs/${job_id}"
}

wait_job_terminal() {
  local job_id="$1"
  local max_seconds="$2"
  local elapsed=0

  while (( elapsed < max_seconds )); do
    local payload
    payload="$(fetch_job_detail "$job_id")"
    local status
    status="$(get_json_field "$payload" '.jobs[0].status // empty')"
    if [[ "$status" == "succeeded" || "$status" == "failed" ]]; then
      echo "$payload"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

echo "== Base: ${BASE_URL}"
echo "== URL under test: ${TEST_URL}"
echo

echo "== Health/status/jobs =="
curl -sS -o /dev/null -w "/api/v1/health -> %{http_code}\n" "${BASE_URL}/api/v1/health"
curl -sS -o /dev/null -w "/api/v1/status -> %{http_code}\n" "${BASE_URL}/api/v1/status"
curl -sS -o /dev/null -w "/api/v1/jobs   -> %{http_code}\n" "${BASE_URL}/api/v1/jobs"
echo

echo "== Trigger with JSON body =="
JOB_WITH_BODY="$(curl -sS -X POST "${BASE_URL}/api/v1/jobs/trigger" \
  -H 'content-type: application/json' \
  -d "{\"jobType\":\"analyze_url\",\"payload\":{\"url\":\"${TEST_URL}\"}}")"
echo "${JOB_WITH_BODY}"
JOB_WITH_BODY_ID="$(extract_job_id "${JOB_WITH_BODY}")"
if [[ -z "${JOB_WITH_BODY_ID:-}" ]]; then
  echo "FAIL: missing job id in analyze_url trigger response"
  exit 1
fi

TRIGGER_STATUS="$(get_json_field "$JOB_WITH_BODY" '.status // empty')"
if [[ "$TRIGGER_STATUS" == "succeeded" || "$TRIGGER_STATUS" == "failed" ]]; then
  echo "analyze_url trigger completed inline with status=${TRIGGER_STATUS}"
else
  echo "analyze_url trigger returned ${TRIGGER_STATUS:-unknown}, polling..."
  if JOB_FINAL="$(wait_job_terminal "$JOB_WITH_BODY_ID" 20)"; then
    echo "$JOB_FINAL"
  else
    echo "still queued/running after 20s"
    if [[ -n "${CRON_SECRET:-}" ]]; then
      echo "invoking cron tick fallback..."
      curl -sS "${BASE_URL}/api/v1/cron/jobs" -H "Authorization: Bearer ${CRON_SECRET}"
      echo
    else
      echo "WARN: CRON_SECRET not set locally; skipping cron fallback"
    fi
    if JOB_FINAL="$(wait_job_terminal "$JOB_WITH_BODY_ID" 10)"; then
      echo "$JOB_FINAL"
    else
      echo "FAIL: analyze_url job did not reach terminal state within 30s"
      exit 1
    fi
  fi
fi

echo "/api/v1/jobs/${JOB_WITH_BODY_ID} -> $(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/jobs/${JOB_WITH_BODY_ID}")"
echo

echo "== Trigger without body (must be 201 path) =="
JOB_NO_BODY="$(curl -sS -X POST "${BASE_URL}/api/v1/jobs/trigger")"
echo "${JOB_NO_BODY}"
JOB_NO_BODY_ID="$(extract_job_id "${JOB_NO_BODY}")"
if [[ -z "${JOB_NO_BODY_ID:-}" ]]; then
  echo "FAIL: missing job id in empty-body trigger response"
  exit 1
fi
echo "/api/v1/jobs/${JOB_NO_BODY_ID} -> $(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/jobs/${JOB_NO_BODY_ID}")"
echo

if [[ -n "${CRON_SECRET:-}" ]]; then
  echo "== Manual cron tick =="
  curl -sS "${BASE_URL}/api/v1/cron/jobs" \
    -H "Authorization: Bearer ${CRON_SECRET}"
  echo
else
  echo "CRON_SECRET not set locally: skipping manual /api/v1/cron/jobs invocation"
fi
