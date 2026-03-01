#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${1:-https://esg-rdt-master-pi.vercel.app}"
COOKIE_JAR="$(mktemp)"
TS="$(date +%s)"

SMOKE_TENANT_NAME="${SMOKE_TENANT_NAME:-Smoke Tenant ${TS}}"
SMOKE_ADMIN_NAME="${SMOKE_ADMIN_NAME:-Smoke Admin}"
SMOKE_ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-smoke+${TS}@example.com}"
SMOKE_ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-SmokePass123!}"

SMOKE_SITE_NAME="${SMOKE_SITE_NAME:-HQ-${TS}}"
SMOKE_PERSON_NAME="${SMOKE_PERSON_NAME:-Operator ${TS}}"
SMOKE_ACTIVITY_TYPE="${SMOKE_ACTIVITY_TYPE:-energy_kwh}"
SMOKE_ACTIVITY_UNIT="${SMOKE_ACTIVITY_UNIT:-kWh}"
SMOKE_EVIDENCE_NAME="${SMOKE_EVIDENCE_NAME:-invoice-${TS}.pdf}"

REQUEST_STATUS=""
REQUEST_PAYLOAD=""

cleanup() {
  rm -f "${COOKIE_JAR}"
}
trap cleanup EXIT

json_field() {
  local payload="$1"
  local query="$2"
  printf '%s' "$payload" | jq -r "$query"
}

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local tmp
  tmp="$(mktemp)"

  if [[ -n "$body" ]]; then
    REQUEST_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${BASE_URL}${path}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'content-type: application/json' -d "$body")"
  else
    REQUEST_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${BASE_URL}${path}" -b "$COOKIE_JAR" -c "$COOKIE_JAR")"
  fi

  REQUEST_PAYLOAD="$(cat "$tmp")"
  rm -f "$tmp"
}

assert_status() {
  local status="$1"
  local expected="$2"
  local label="$3"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: ${label} expected ${expected}, got ${status}"
    exit 1
  fi
  echo "PASS: ${label} -> ${status}"
}

echo "== BASE URL: ${BASE_URL}"

echo

echo "== Public routes must stay available =="
HELP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/help")"
assert_status "$HELP_STATUS" "200" "/help"
TOOL_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/tools/url-analyzer")"
assert_status "$TOOL_STATUS" "200" "/tools/url-analyzer"

echo

echo "== Home unauth redirect check =="
HOME_HEADERS="$(curl -sS -I "${BASE_URL}/")"
HOME_STATUS="$(printf '%s' "$HOME_HEADERS" | awk 'toupper($1) ~ /^HTTP/ {code=$2} END {print code}')"
HOME_LOCATION="$(printf '%s' "$HOME_HEADERS" | awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); print; exit}')"
if [[ "$HOME_STATUS" != "307" && "$HOME_STATUS" != "308" ]]; then
  echo "FAIL: expected redirect status from / when unauthenticated, got ${HOME_STATUS}"
  exit 1
fi
if [[ "$HOME_LOCATION" != *"/login" && "$HOME_LOCATION" != *"/setup" ]]; then
  echo "FAIL: expected / redirect to /login or /setup, got location='${HOME_LOCATION}'"
  exit 1
fi
echo "PASS: / redirects unauth -> ${HOME_LOCATION} (${HOME_STATUS})"

echo

echo "== Auth bootstrap/login with cookie =="
request_json "POST" "/api/v1/auth/login" "{\"email\":\"${SMOKE_ADMIN_EMAIL}\",\"password\":\"${SMOKE_ADMIN_PASSWORD}\"}"
if [[ "$REQUEST_STATUS" == "200" ]]; then
  echo "PASS: login succeeded"
else
  echo "WARN: login failed (${REQUEST_STATUS}), attempting setup"
  request_json "POST" "/api/v1/auth/setup" "{\"tenantName\":\"${SMOKE_TENANT_NAME}\",\"name\":\"${SMOKE_ADMIN_NAME}\",\"email\":\"${SMOKE_ADMIN_EMAIL}\",\"password\":\"${SMOKE_ADMIN_PASSWORD}\"}"
  if [[ "$REQUEST_STATUS" != "201" && "$REQUEST_STATUS" != "200" ]]; then
    echo "FAIL: setup failed (${REQUEST_STATUS})"
    echo "$REQUEST_PAYLOAD"
    exit 1
  fi
  echo "PASS: setup succeeded"
fi

request_json "GET" "/api/v1/auth/me"
assert_status "$REQUEST_STATUS" "200" "/api/v1/auth/me"
TENANT_ID="$(json_field "$REQUEST_PAYLOAD" '.activeTenantId // empty')"
if [[ -z "$TENANT_ID" || "$TENANT_ID" == "null" ]]; then
  echo "FAIL: activeTenantId missing in /api/v1/auth/me"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "Active tenant: ${TENANT_ID}"

echo

echo "== CRUD smoke (site/person/activity/evidence metadata) =="
request_json "POST" "/api/v1/tenants/${TENANT_ID}/sites" "{\"name\":\"${SMOKE_SITE_NAME}\",\"country\":\"IT\",\"address\":\"Via Smoke 1\"}"
assert_status "$REQUEST_STATUS" "201" "create site"
SITE_ID="$(json_field "$REQUEST_PAYLOAD" '.site.id // empty')"
if [[ -z "$SITE_ID" || "$SITE_ID" == "null" ]]; then
  echo "FAIL: create site missing id"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "Site id: ${SITE_ID}"

request_json "POST" "/api/v1/tenants/${TENANT_ID}/people" "{\"fullName\":\"${SMOKE_PERSON_NAME}\",\"email\":\"operator+${TS}@example.com\",\"title\":\"Analyst\",\"siteId\":\"${SITE_ID}\"}"
assert_status "$REQUEST_STATUS" "201" "create person"
PERSON_ID="$(json_field "$REQUEST_PAYLOAD" '.person.id // empty')"
if [[ -z "$PERSON_ID" || "$PERSON_ID" == "null" ]]; then
  echo "FAIL: create person missing id"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "Person id: ${PERSON_ID}"

request_json "POST" "/api/v1/tenants/${TENANT_ID}/evidence" "{\"filename\":\"${SMOKE_EVIDENCE_NAME}\",\"contentType\":\"application/pdf\",\"sizeBytes\":12345,\"siteId\":\"${SITE_ID}\",\"sha256\":\"smoke-sha\",\"blobUrl\":\"\"}"
assert_status "$REQUEST_STATUS" "201" "create evidence metadata"
EVIDENCE_ID="$(json_field "$REQUEST_PAYLOAD" '.evidence.id // empty')"
if [[ -z "$EVIDENCE_ID" || "$EVIDENCE_ID" == "null" ]]; then
  echo "FAIL: create evidence missing id"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "Evidence id: ${EVIDENCE_ID}"

request_json "POST" "/api/v1/tenants/${TENANT_ID}/activities" "{\"siteId\":\"${SITE_ID}\",\"activityType\":\"${SMOKE_ACTIVITY_TYPE}\",\"periodStart\":\"2026-01-01\",\"periodEnd\":\"2026-01-31\",\"quantity\":42.5,\"unit\":\"${SMOKE_ACTIVITY_UNIT}\",\"notes\":\"smoke\",\"evidenceId\":\"${EVIDENCE_ID}\"}"
assert_status "$REQUEST_STATUS" "201" "create activity"
ACTIVITY_ID="$(json_field "$REQUEST_PAYLOAD" '.activity.id // empty')"
if [[ -z "$ACTIVITY_ID" || "$ACTIVITY_ID" == "null" ]]; then
  echo "FAIL: create activity missing id"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "Activity id: ${ACTIVITY_ID}"


echo

echo "== Dashboard/API verification =="
request_json "GET" "/api/v1/tenants/${TENANT_ID}/sites"
assert_status "$REQUEST_STATUS" "200" "list sites"
request_json "GET" "/api/v1/tenants/${TENANT_ID}/people"
assert_status "$REQUEST_STATUS" "200" "list people"
request_json "GET" "/api/v1/tenants/${TENANT_ID}/activities"
assert_status "$REQUEST_STATUS" "200" "list activities"
request_json "GET" "/api/v1/tenants/${TENANT_ID}/evidence"
assert_status "$REQUEST_STATUS" "200" "list evidence"
request_json "GET" "/api/v1/audit?tenantId=${TENANT_ID}"
assert_status "$REQUEST_STATUS" "200" "tenant audit"

APP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -c "$COOKIE_JAR" "${BASE_URL}/app")"
assert_status "$APP_STATUS" "200" "/app authenticated"

echo

echo "== Existing utility endpoint checks =="
JOBS_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/api/v1/jobs")"
echo "/api/v1/jobs -> ${JOBS_STATUS} (informational; may be 200 or 401 depending JOB_API_TOKEN)"

echo

echo "SMOKE PASS"
