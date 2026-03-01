#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${1:-https://esg-rdt-master-pi.vercel.app}"
TEST_URL="${2:-${SMOKE_URL:-https://www.wikipedia.org}}"

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

assert_analyze_success() {
  local payload="$1"
  local status
  status="$(get_json_field "$payload" '.status // .jobs[0].status // empty')"
  local http_status
  http_status="$(get_json_field "$payload" '.result.httpStatus // .jobs[0].result.httpStatus // empty')"
  local final_url
  final_url="$(get_json_field "$payload" '.result.finalUrl // .jobs[0].result.finalUrl // empty')"
  local error_kind
  error_kind="$(get_json_field "$payload" '.result.errorKind // .jobs[0].result.errorKind // empty')"

  if [[ "$status" != "succeeded" ]]; then
    echo "FAIL: analyze_url did not succeed (status=${status:-unknown})"
    return 1
  fi

  if [[ -z "$http_status" || "$http_status" == "null" ]]; then
    echo "FAIL: analyze_url succeeded but output.httpStatus is missing"
    return 1
  fi

  if [[ -z "$final_url" || "$final_url" == "null" ]]; then
    echo "FAIL: analyze_url succeeded but output.finalUrl is missing"
    return 1
  fi

  if [[ -n "$error_kind" && "$error_kind" != "null" ]]; then
    echo "FAIL: analyze_url returned structured errorKind=${error_kind}"
    return 1
  fi

  echo "analyze_url smoke success (httpStatus=${http_status}, finalUrl=${final_url})"
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
ANALYZE_FINAL_PAYLOAD="$JOB_WITH_BODY"
if [[ "$TRIGGER_STATUS" == "succeeded" || "$TRIGGER_STATUS" == "failed" ]]; then
  echo "analyze_url trigger completed inline with status=${TRIGGER_STATUS}"
else
  echo "analyze_url trigger returned ${TRIGGER_STATUS:-unknown}, polling..."
  if JOB_FINAL="$(wait_job_terminal "$JOB_WITH_BODY_ID" 20)"; then
    echo "$JOB_FINAL"
    ANALYZE_FINAL_PAYLOAD="$JOB_FINAL"
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
      ANALYZE_FINAL_PAYLOAD="$JOB_FINAL"
    else
      echo "FAIL: analyze_url job did not reach terminal state within 30s"
      exit 1
    fi
  fi
fi

assert_analyze_success "$ANALYZE_FINAL_PAYLOAD"

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

echo
echo "== Help page =="
HELP_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/help")"
echo "/help -> ${HELP_STATUS}"
if [[ "${HELP_STATUS}" != "200" ]]; then
  echo "FAIL: /help must return 200"
  exit 1
fi

echo
echo "== Home marker =="
HOME_HTML="$(curl -sS "${BASE_URL}/")"
if grep -Eq "ESG Assessment|ESG RDT" <<<"${HOME_HTML}"; then
  echo "home marker check -> PASS"
else
  echo "FAIL: home page missing ESG marker"
  exit 1
fi

echo
echo "== URL analyzer route =="
TOOL_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/tools/url-analyzer")"
echo "/tools/url-analyzer -> ${TOOL_STATUS}"
if [[ "${TOOL_STATUS}" != "200" ]]; then
  echo "FAIL: /tools/url-analyzer must return 200"
  exit 1
fi

echo
echo "== Projects API flow =="
PROJECT_CREATE_PAYLOAD="$(curl -sS -X POST "${BASE_URL}/api/v1/projects" \
  -H 'content-type: application/json' \
  -d '{"name":"Smoke ESG Assessment"}')"
echo "${PROJECT_CREATE_PAYLOAD}"
PROJECT_ID="$(get_json_field "${PROJECT_CREATE_PAYLOAD}" '.project.id // empty')"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "null" ]]; then
  echo "FAIL: project create did not return project.id"
  exit 1
fi
echo "created project id: ${PROJECT_ID}"

ANSWERS_UPSERT_PAYLOAD="$(curl -sS -X PUT "${BASE_URL}/api/v1/projects/${PROJECT_ID}/answers" \
  -H 'content-type: application/json' \
  -d '{"answers":[{"parameterKey":"e.profile.reporting_year","value":"2026"},{"parameterKey":"e.scope1.total_tco2e","value":42.7},{"parameterKey":"g.policies.anti_corruption","value":true}]}')"
echo "${ANSWERS_UPSERT_PAYLOAD}"
UPSERT_TOTAL="$(get_json_field "${ANSWERS_UPSERT_PAYLOAD}" '.totalAnswers // empty')"
if [[ -z "${UPSERT_TOTAL}" || "${UPSERT_TOTAL}" == "null" ]]; then
  echo "FAIL: answers upsert did not return totalAnswers"
  exit 1
fi

REPORT_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/projects/${PROJECT_ID}/report")"
echo "/api/v1/projects/${PROJECT_ID}/report -> ${REPORT_STATUS}"
if [[ "${REPORT_STATUS}" != "200" ]]; then
  echo "FAIL: project report endpoint must return 200"
  exit 1
fi
