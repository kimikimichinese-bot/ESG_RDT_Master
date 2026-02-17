#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-pi.vercel.app}"
readonly EXPECTED_COMMIT_INPUT="${TICKET9_EXPECTED_COMMIT:-$(git rev-parse --short=8 origin/master)}"
readonly OUTFILE="${TICKET9_OUTFILE:-/tmp/ticket-9-readiness-automation.md}"
readonly WORKFLOW_READINESS="${TICKET9_WORKFLOW_READINESS:-production-readiness}"
readonly WORKFLOW_LINT="${TICKET9_WORKFLOW_LINT:-lint-build-test}"

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

get_run_state() {
  local workflow_name="$1"
  local run_id
  run_id="$(gh run list --workflow "$workflow_name" --branch master --limit 1 --json databaseId -q '.[0].databaseId')"
  if [[ -z "$run_id" || "$run_id" == "null" ]]; then
    echo "missing:${workflow_name}" && return 1
  fi
  gh run view "$run_id" --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt
}

readonly EXPECTED_COMMIT="$(resolve_expected "$EXPECTED_COMMIT_INPUT")"

readonly READINESS_JSON="$(get_run_state "$WORKFLOW_READINESS")" || fail "No workflow run found for ${WORKFLOW_READINESS} on master"
readonly LINT_JSON="$(get_run_state "$WORKFLOW_LINT")" || fail "No workflow run found for ${WORKFLOW_LINT} on master"

READINESS_STATUS="$(jq -r '.status // empty' <<<"$READINESS_JSON")"
READINESS_CONCLUSION="$(jq -r '.conclusion // empty' <<<"$READINESS_JSON")"
if [[ "$READINESS_STATUS" != "completed" || "$READINESS_CONCLUSION" != "success" ]]; then
  fail "workflow ${WORKFLOW_READINESS} not successful: status=${READINESS_STATUS}, conclusion=${READINESS_CONCLUSION}"
fi
pass "workflow ${WORKFLOW_READINESS} success"

LINT_STATUS="$(jq -r '.status // empty' <<<"$LINT_JSON")"
LINT_CONCLUSION="$(jq -r '.conclusion // empty' <<<"$LINT_JSON")"
if [[ "$LINT_STATUS" != "completed" || "$LINT_CONCLUSION" != "success" ]]; then
  fail "workflow ${WORKFLOW_LINT} not successful: status=${LINT_STATUS}, conclusion=${LINT_CONCLUSION}"
fi
pass "workflow ${WORKFLOW_LINT} success"

READY_RESPONSE="$(curl -sfS "${PROD_ALIAS}/api/ready")"
READY_STATUS="$(jq -r '.status // empty' <<<"$READY_RESPONSE")"
READY_WEB="$(jq -r '.checks.web // empty' <<<"$READY_RESPONSE")"
if [[ "$READY_STATUS" != "ready" || "$READY_WEB" != "ok" ]]; then
  fail "/api/ready unexpected payload"
fi
pass "/api/ready contract valid"

HEALTH_RESPONSE="$(curl -sfS "${PROD_ALIAS}/api/health")"
HEALTH_STATUS="$(jq -r '.status // empty' <<<"$HEALTH_RESPONSE")"
HEALTH_DB="$(jq -r '.db // empty' <<<"$HEALTH_RESPONSE")"
HEALTH_VERSION="$(jq -r '.version // empty' <<<"$HEALTH_RESPONSE")"
if [[ "$HEALTH_STATUS" != "ok" || "$HEALTH_DB" != "ok" ]]; then
  fail "/api/health unexpected payload"
fi
if [[ -n "$HEALTH_VERSION" && "$HEALTH_VERSION" != "$EXPECTED_COMMIT" ]]; then
  fail "health version mismatch: expected ${EXPECTED_COMMIT}, got ${HEALTH_VERSION}"
fi
pass "/api/health contract and version validated"

TRACKING="$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)"
LOCAL_HEAD="$(git rev-parse --short=8 HEAD)"
ORIGIN_MASTER="$(git rev-parse --short=8 origin/master)"
WIP="$(git status --short 2>/dev/null | awk 'END{print NR}')"

{
  echo "# Ticket #9 production readiness automation"
  echo ""
  echo "- readiness workflow: ${WORKFLOW_READINESS}"
  echo "- lint workflow: ${WORKFLOW_LINT}"
  echo "- expected commit: ${EXPECTED_COMMIT}"
  echo "- observed health version: ${HEALTH_VERSION}"
  echo "- origin/master: ${ORIGIN_MASTER}"
  echo "- local HEAD: ${LOCAL_HEAD}"
  echo "- upstream: ${TRACKING:-not-set}"
  echo "- working tree dirty lines: ${WIP}"
  echo ""
  echo "## readiness workflow"
  echo '```json'
  echo "${READINESS_JSON}"
  echo '```'
  echo ""
  echo "## lint-build-test workflow"
  echo '```json'
  echo "${LINT_JSON}"
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
