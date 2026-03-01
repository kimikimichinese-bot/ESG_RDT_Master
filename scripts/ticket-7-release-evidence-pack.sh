#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-kimikimichineses-projects.vercel.app}"
readonly WORKFLOW_NAME="${TICKET7_WORKFLOW:-production-readiness}"
readonly EXPECTED_COMMIT_INPUT="${TICKET7_EXPECTED_COMMIT:-$(git rev-parse --short=8 origin/master)}"
readonly OUTFILE="${TICKET7_OUTFILE:-/tmp/ticket-7-release-bundle.md}"

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_cmd gh
require_cmd curl
require_cmd git
require_cmd jq

resolve_expected() {
  local value="$1"
  if [[ "$value" == v* ]]; then
    git rev-parse --short=8 "${value}^{}" 2>/dev/null || git rev-parse --short=8 "$value"
  else
    printf '%s\n' "$value"
  fi
}

readonly EXPECTED_COMMIT="$(resolve_expected "$EXPECTED_COMMIT_INPUT")"

LAST_RUN="$(gh run list --workflow "$WORKFLOW_NAME" --branch master --limit 1 --json databaseId -q '.[0].databaseId')"
if [[ -z "$LAST_RUN" || "$LAST_RUN" == "null" ]]; then
  fail "No workflow run found for ${WORKFLOW_NAME} on master"
fi

RUN_JSON="$(gh run view "$LAST_RUN" --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt)"
RUN_STATUS="$(jq -r '.status // empty' <<<"$RUN_JSON")"
RUN_CONCLUSION="$(jq -r '.conclusion // empty' <<<"$RUN_JSON")"

if [[ "$RUN_STATUS" != "completed" || "$RUN_CONCLUSION" != "success" ]]; then
  fail "Readiness workflow not successful: status=${RUN_STATUS}, conclusion=${RUN_CONCLUSION}"
fi
pass "Production readiness workflow success (${LAST_RUN})"

READY_RESPONSE="$(curl -sfS "${PROD_ALIAS}/api/ready")"
READY_STATUS="$(jq -r '.status // empty' <<<"$READY_RESPONSE")"
READY_WEB="$(jq -r '.checks.web // empty' <<<"$READY_RESPONSE")"
if [[ "$READY_STATUS" != "ready" || "$READY_WEB" != "ok" ]]; then
  fail "/api/ready contract invalid"
fi
pass "/api/ready contract valid"

HEALTH_RESPONSE="$(curl -sfS "${PROD_ALIAS}/api/health")"
HEALTH_STATUS="$(jq -r '.status // empty' <<<"$HEALTH_RESPONSE")"
HEALTH_DB="$(jq -r '.db // empty' <<<"$HEALTH_RESPONSE")"
HEALTH_VERSION="$(jq -r '.version // empty' <<<"$HEALTH_RESPONSE")"
if [[ "$HEALTH_STATUS" != "ok" || "$HEALTH_DB" != "ok" ]]; then
  fail "/api/health contract invalid"
fi
if [[ -n "$HEALTH_VERSION" && "$HEALTH_VERSION" != "$EXPECTED_COMMIT" ]]; then
  fail "health version mismatch: expected ${EXPECTED_COMMIT}, got ${HEALTH_VERSION}"
fi
pass "/api/health contract and version validated"

ORIGIN_MASTER="$(git rev-parse --short=8 origin/master)"
LOCAL_HEAD="$(git rev-parse --short=8 HEAD)"
CLEAN_STATE="$(git status --short 2>/dev/null | wc -l)"

{
  echo "# Ticket #7 release evidence bundle"
  echo ""
  echo "- workflow: ${WORKFLOW_NAME}/${LAST_RUN}"
  echo "- expected commit: ${EXPECTED_COMMIT}"
  echo "- observed health version: ${HEALTH_VERSION}"
  echo "- origin/master: ${ORIGIN_MASTER}"
  echo "- local HEAD: ${LOCAL_HEAD}"
  echo "- working tree dirty files: ${CLEAN_STATE}"
  echo ""
  echo "## workflow"
  echo '```json'
  echo "${RUN_JSON}"
  echo '```'
  echo ""
  echo "## /api/ready"
  echo '```json'
  echo "${READY_RESPONSE}"
  echo '```'
  echo ""
  echo "## /api/health"
  echo '```json'
  echo "${HEALTH_RESPONSE}"
  echo '```'
} >"${OUTFILE}"

cat "${OUTFILE}"
echo ""
echo "Written to ${OUTFILE}"
