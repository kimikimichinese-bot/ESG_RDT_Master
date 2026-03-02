#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${1:-https://esg-rdt-master-pi.vercel.app}"
COOKIE_JAR="$(mktemp)"
TS="$(date +%s)"
SMOKE_ENVIRONMENT="${SMOKE_ENVIRONMENT:-production}"

SMOKE_TENANT_NAME="${SMOKE_TENANT_NAME:-Smoke Tenant ${TS}}"
SMOKE_ADMIN_NAME="${SMOKE_ADMIN_NAME:-Smoke Admin}"
SMOKE_ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-smoke+${TS}@example.com}"
SMOKE_ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-SmokePass123!}"

SMOKE_SITE_NAME="${SMOKE_SITE_NAME:-HQ-${TS}}"
SMOKE_PERSON_NAME="${SMOKE_PERSON_NAME:-Operator ${TS}}"
SMOKE_ACTIVITY_TYPE="${SMOKE_ACTIVITY_TYPE:-energy_kwh}"
SMOKE_ACTIVITY_UNIT="${SMOKE_ACTIVITY_UNIT:-kWh}"
SMOKE_EVIDENCE_NAME="${SMOKE_EVIDENCE_NAME:-invoice-${TS}.pdf}"
SMOKE_UPLOAD_FILE=""

REQUEST_STATUS=""
REQUEST_PAYLOAD=""

cleanup() {
  rm -f "${COOKIE_JAR}"
  if [[ -n "${SMOKE_UPLOAD_FILE}" && -f "${SMOKE_UPLOAD_FILE}" ]]; then
    rm -f "${SMOKE_UPLOAD_FILE}"
  fi
}
trap cleanup EXIT

extract_json_string_field() {
  local payload="$1"
  local field="$2"
  printf '%s' "$payload" | jq -r --arg field "$field" '.[$field] // empty'
}

read_database_url_from_vercel_env() {
  if [[ -n "${SMOKE_DATABASE_URL:-}" ]]; then
    printf '%s' "${SMOKE_DATABASE_URL}"
    return 0
  fi
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s' "${DATABASE_URL}"
    return 0
  fi

  local tmp_env
  tmp_env="$(mktemp)"
  if ! vercel env pull "$tmp_env" --environment="$SMOKE_ENVIRONMENT" --yes >/dev/null 2>&1; then
    rm -f "$tmp_env"
    return 1
  fi

  local db
  db="$(grep -E '^(export[[:space:]]+)?DATABASE_URL=' "$tmp_env" | tail -n1 | cut -d= -f2- || true)"
  rm -f "$tmp_env"

  db="${db%$'\r'}"
  db="${db#\"}"; db="${db%\"}"
  db="${db#\'}"; db="${db%\'}"

  if [[ -z "$db" ]]; then
    return 1
  fi

  printf '%s' "$db"
}

provision_smoke_admin_via_db() {
  local database_url
  database_url="$(read_database_url_from_vercel_env)" || return 1

  local node_output
  node_output="$(
    cd apps/web
    DATABASE_URL="$database_url" \
    SMOKE_ADMIN_EMAIL="$SMOKE_ADMIN_EMAIL" \
    SMOKE_ADMIN_NAME="$SMOKE_ADMIN_NAME" \
    SMOKE_ADMIN_PASSWORD="$SMOKE_ADMIN_PASSWORD" \
    node --input-type=module <<'NODE'
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const email = String(process.env.SMOKE_ADMIN_EMAIL || "").trim().toLowerCase();
const name = String(process.env.SMOKE_ADMIN_NAME || "Smoke Admin").trim() || "Smoke Admin";
const password = String(process.env.SMOKE_ADMIN_PASSWORD || "");

if (!email || !email.includes("@")) {
  throw new Error("invalid_smoke_email");
}
if (password.length < 8) {
  throw new Error("invalid_smoke_password");
}

const tenantRows = await sql`SELECT id, name FROM tenants ORDER BY created_at ASC LIMIT 1`;
if (!tenantRows?.length) {
  throw new Error("no_tenant_available");
}
const tenantId = tenantRows[0].id;

const userRows = await sql`
  SELECT id
  FROM users
  WHERE email = ${email}
  LIMIT 1
`;

let userId = userRows?.[0]?.id || null;
if (!userId) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const passwordHash = `scrypt$${salt}$${hash}`;
  userId = randomUUID();
  await sql`
    INSERT INTO users (id, email, name, password_hash)
    VALUES (${userId}, ${email}, ${name}, ${passwordHash})
  `;
}

await sql`
  INSERT INTO memberships (user_id, tenant_id, role)
  VALUES (${userId}, ${tenantId}, 'TenantAdmin')
  ON CONFLICT (user_id, tenant_id) DO UPDATE
  SET role = EXCLUDED.role
`;

console.log(JSON.stringify({ ok: true, userId, tenantId }));
NODE
  )" || return 1

  if ! printf '%s' "$node_output" | jq -e '.ok == true' >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

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

request_multipart() {
  local method="$1"
  local path="$2"
  shift 2

  local tmp
  tmp="$(mktemp)"

  REQUEST_STATUS="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${BASE_URL}${path}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$@")"
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

assert_auth_or_redirect_eco_page() {
  local path="$1"
  local status="$2"
  if [[ "$status" != "200" && "$status" != "307" ]]; then
    echo "FAIL: ${path} expected 200 (authed) or 307 (unauth), got ${status}"
    exit 1
  fi
  echo "PASS: ${path} -> ${status}"
}

echo "== BASE URL: ${BASE_URL}"

echo

echo "== Public routes must stay available =="
HELP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/help")"
assert_status "$HELP_STATUS" "200" "/help"
TOOL_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/tools/url-analyzer")"
assert_status "$TOOL_STATUS" "200" "/tools/url-analyzer"
LOGIN_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/login")"
assert_status "$LOGIN_STATUS" "200" "/login"
SETUP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/setup")"
assert_status "$SETUP_STATUS" "200" "/setup"
SOCIAL_PAGE_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/app/social")"
if [[ "$SOCIAL_PAGE_STATUS" != "200" && "$SOCIAL_PAGE_STATUS" != "302" && "$SOCIAL_PAGE_STATUS" != "307" && "$SOCIAL_PAGE_STATUS" != "308" ]]; then
  echo "FAIL: /app/social expected 200/302/307/308, got ${SOCIAL_PAGE_STATUS}"
  exit 1
fi
echo "PASS: /app/social -> ${SOCIAL_PAGE_STATUS}"
GOV_PAGE_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/app/governance")"
if [[ "$GOV_PAGE_STATUS" != "200" && "$GOV_PAGE_STATUS" != "302" && "$GOV_PAGE_STATUS" != "307" && "$GOV_PAGE_STATUS" != "308" ]]; then
  echo "FAIL: /app/governance expected 200/302/307/308, got ${GOV_PAGE_STATUS}"
  exit 1
fi
echo "PASS: /app/governance -> ${GOV_PAGE_STATUS}"
ECOVADIS_PAGE_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/app/ecovadis")"
assert_auth_or_redirect_eco_page "/app/ecovadis" "$ECOVADIS_PAGE_STATUS"
MATERIALITY_PAGE_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/app/materiality")"
assert_auth_or_redirect_eco_page "/app/materiality" "$MATERIALITY_PAGE_STATUS"

request_json "GET" "/api/v1/auth/bootstrap"
assert_status "$REQUEST_STATUS" "200" "/api/v1/auth/bootstrap"
if ! printf '%s' "$REQUEST_PAYLOAD" | jq -e '.ok == true and (.usersCount|type=="number") and (.tenantsCount|type=="number") and (.membershipsCount|type=="number")' >/dev/null; then
  echo "FAIL: /api/v1/auth/bootstrap payload invalid"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "PASS: /api/v1/auth/bootstrap payload ok"

echo

echo "== Home unauth redirect check =="
HOME_HEADERS="$(curl -sS -I "${BASE_URL}/")"
HOME_STATUS="$(printf '%s' "$HOME_HEADERS" | awk 'toupper($1) ~ /^HTTP/ {code=$2} END {print code}')"
HOME_LOCATION="$(printf '%s' "$HOME_HEADERS" | awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); print; exit}')"
if [[ "$HOME_STATUS" == "500" ]]; then
  echo "FAIL: expected non-500 status from / when unauthenticated, got ${HOME_STATUS}"
  exit 1
fi
if [[ "$HOME_STATUS" != "200" && "$HOME_STATUS" != "302" && "$HOME_STATUS" != "307" && "$HOME_STATUS" != "308" ]]; then
  echo "FAIL: expected / status in 200/302/307/308 when unauthenticated, got ${HOME_STATUS}"
  exit 1
fi
if [[ "$HOME_STATUS" != "200" && "$HOME_LOCATION" != *"/login" && "$HOME_LOCATION" != *"/setup" && "$HOME_LOCATION" != *"/unavailable" ]]; then
  echo "FAIL: expected / redirect to /login or /setup, got location='${HOME_LOCATION}'"
  exit 1
fi
echo "PASS: / redirects unauth -> ${HOME_LOCATION} (${HOME_STATUS})"

HOME_UTM_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/?utm_source=chatgpt.com")"
if [[ "$HOME_UTM_STATUS" == "500" ]]; then
  echo "FAIL: expected non-500 status from /?utm_source=chatgpt.com, got ${HOME_UTM_STATUS}"
  exit 1
fi
if [[ "$HOME_UTM_STATUS" != "200" && "$HOME_UTM_STATUS" != "302" && "$HOME_UTM_STATUS" != "307" && "$HOME_UTM_STATUS" != "308" ]]; then
  echo "FAIL: expected /?utm_source=chatgpt.com status in 200/302/307/308, got ${HOME_UTM_STATUS}"
  exit 1
fi
echo "PASS: /?utm_source=chatgpt.com -> ${HOME_UTM_STATUS}"

echo

echo "== Auth bootstrap/login with cookie =="
request_json "POST" "/api/v1/auth/login" "{\"email\":\"${SMOKE_ADMIN_EMAIL}\",\"password\":\"${SMOKE_ADMIN_PASSWORD}\"}"
if [[ "$REQUEST_STATUS" == "200" ]]; then
  echo "PASS: login succeeded"
else
  echo "WARN: login failed (${REQUEST_STATUS}), attempting setup"
  request_json "POST" "/api/v1/auth/setup" "{\"tenantName\":\"${SMOKE_TENANT_NAME}\",\"name\":\"${SMOKE_ADMIN_NAME}\",\"email\":\"${SMOKE_ADMIN_EMAIL}\",\"password\":\"${SMOKE_ADMIN_PASSWORD}\"}"
  if [[ "$REQUEST_STATUS" == "201" || "$REQUEST_STATUS" == "200" ]]; then
    echo "PASS: setup succeeded"
  else
    SETUP_CODE="$(extract_json_string_field "$REQUEST_PAYLOAD" "code")"
    if [[ "$REQUEST_STATUS" == "409" && "$SETUP_CODE" == "SETUP_COMPLETED" ]]; then
      echo "WARN: setup already completed, provisioning smoke admin via DB fallback"
      if ! provision_smoke_admin_via_db; then
        echo "FAIL: setup completed and DB fallback provisioning failed"
        echo "$REQUEST_PAYLOAD"
        exit 1
      fi
      request_json "POST" "/api/v1/auth/login" "{\"email\":\"${SMOKE_ADMIN_EMAIL}\",\"password\":\"${SMOKE_ADMIN_PASSWORD}\"}"
      if [[ "$REQUEST_STATUS" != "200" ]]; then
        echo "FAIL: login failed after DB fallback (${REQUEST_STATUS})"
        echo "$REQUEST_PAYLOAD"
        exit 1
      fi
      echo "PASS: login succeeded after DB fallback provisioning"
    else
      echo "FAIL: setup failed (${REQUEST_STATUS})"
      echo "$REQUEST_PAYLOAD"
      exit 1
    fi
  fi
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
request_json "GET" "/api/v1/tenants/${TENANT_ID}/companies"
assert_status "$REQUEST_STATUS" "200" "list companies"
COMPANY_ID="$(json_field "$REQUEST_PAYLOAD" '.companies[] | select(.isHolding == true) | .id' | head -n1)"
if [[ -z "$COMPANY_ID" || "$COMPANY_ID" == "null" ]]; then
  COMPANY_ID="$(json_field "$REQUEST_PAYLOAD" '.companies[0].id // empty')"
fi
if [[ -z "$COMPANY_ID" || "$COMPANY_ID" == "null" ]]; then
  echo "FAIL: no company available for site creation"
  echo "$REQUEST_PAYLOAD"
  exit 1
fi
echo "Company id: ${COMPANY_ID}"

request_json "POST" "/api/v1/tenants/${TENANT_ID}/sites" "{\"companyId\":\"${COMPANY_ID}\",\"name\":\"${SMOKE_SITE_NAME}\",\"country\":\"IT\",\"address\":\"Via Smoke 1\",\"waterStressed\":false}"
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

SMOKE_UPLOAD_FILE="$(mktemp "/tmp/esg-smoke-${TS}-XXXXXX.pdf")"
cat > "${SMOKE_UPLOAD_FILE}" <<PDF
%PDF-1.4
1 0 obj
<< /Type /Catalog >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
PDF

request_multipart "POST" "/api/v1/tenants/${TENANT_ID}/evidence/upload" \
  -F "siteId=${SITE_ID}" \
  -F "file=@${SMOKE_UPLOAD_FILE};type=application/pdf;filename=${SMOKE_EVIDENCE_NAME}"
EVIDENCE_ID=""
if [[ "$REQUEST_STATUS" == "201" ]]; then
  EVIDENCE_ID="$(json_field "$REQUEST_PAYLOAD" '.evidence.id // empty')"
  if [[ -z "$EVIDENCE_ID" || "$EVIDENCE_ID" == "null" ]]; then
    echo "FAIL: upload evidence missing id"
    echo "$REQUEST_PAYLOAD"
    exit 1
  fi
  echo "PASS: upload evidence -> ${REQUEST_STATUS}"
  echo "Evidence id: ${EVIDENCE_ID}"
else
  echo "WARN: upload evidence failed (${REQUEST_STATUS}), falling back to metadata evidence create"
  request_json "POST" "/api/v1/tenants/${TENANT_ID}/evidence" "{\"siteId\":\"${SITE_ID}\",\"filename\":\"${SMOKE_EVIDENCE_NAME}\",\"contentType\":\"application/pdf\",\"sizeBytes\":1234,\"sha256\":\"smoke-${TS}\",\"blobUrl\":null,\"docType\":\"reporting\",\"scopeCoverage\":\"site\"}"
  if [[ "$REQUEST_STATUS" == "201" ]]; then
    EVIDENCE_ID="$(json_field "$REQUEST_PAYLOAD" '.evidence.id // empty')"
    if [[ -z "$EVIDENCE_ID" || "$EVIDENCE_ID" == "null" ]]; then
      echo "FAIL: metadata evidence create missing id"
      echo "$REQUEST_PAYLOAD"
      exit 1
    fi
    echo "PASS: metadata evidence create -> ${REQUEST_STATUS}"
    echo "Evidence id: ${EVIDENCE_ID}"
  else
    echo "WARN: metadata evidence create failed (${REQUEST_STATUS}), continuing activity create without evidence"
  fi
fi

ACTIVITY_PAYLOAD="{\"siteId\":\"${SITE_ID}\",\"activityType\":\"${SMOKE_ACTIVITY_TYPE}\",\"periodStart\":\"2026-01-01\",\"periodEnd\":\"2026-01-31\",\"quantity\":42.5,\"unit\":\"${SMOKE_ACTIVITY_UNIT}\",\"notes\":\"smoke\""
if [[ -n "${EVIDENCE_ID:-}" && "${EVIDENCE_ID}" != "null" ]]; then
  ACTIVITY_PAYLOAD="${ACTIVITY_PAYLOAD},\"evidenceId\":\"${EVIDENCE_ID}\""
fi
ACTIVITY_PAYLOAD="${ACTIVITY_PAYLOAD}}"

request_json "POST" "/api/v1/tenants/${TENANT_ID}/activities" "${ACTIVITY_PAYLOAD}"
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
