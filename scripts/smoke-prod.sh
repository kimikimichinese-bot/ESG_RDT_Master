#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${1:-https://esg-rdt-master-pi.vercel.app}"
TEST_URL="${2:-https://example.com}"

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
JOB_WITH_BODY_ID="$(echo "${JOB_WITH_BODY}" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [[ -n "${JOB_WITH_BODY_ID:-}" ]]; then
  echo "/api/v1/jobs/${JOB_WITH_BODY_ID} -> $(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/jobs/${JOB_WITH_BODY_ID}")"
fi
echo

echo "== Trigger without body (must be 201 path) =="
JOB_NO_BODY="$(curl -sS -X POST "${BASE_URL}/api/v1/jobs/trigger")"
echo "${JOB_NO_BODY}"
JOB_NO_BODY_ID="$(echo "${JOB_NO_BODY}" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [[ -n "${JOB_NO_BODY_ID:-}" ]]; then
  echo "/api/v1/jobs/${JOB_NO_BODY_ID} -> $(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/jobs/${JOB_NO_BODY_ID}")"
fi
echo

if [[ -n "${CRON_SECRET:-}" ]]; then
  echo "== Manual cron tick =="
  curl -sS "${BASE_URL}/api/v1/cron/jobs" \
    -H "Authorization: Bearer ${CRON_SECRET}"
  echo
else
  echo "CRON_SECRET not set locally: skipping manual /api/v1/cron/jobs invocation"
fi
