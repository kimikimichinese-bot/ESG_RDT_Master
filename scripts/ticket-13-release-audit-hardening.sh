#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-pi.vercel.app}"
readonly WORKFLOW_READINESS="${TICKET13_WORKFLOW_READINESS:-production-readiness}"
readonly WORKFLOW_LINT="${TICKET13_WORKFLOW_LINT:-ci}"
readonly WORKFLOW_LINT_FALLBACK="${TICKET13_WORKFLOW_LINT_FALLBACK:-lint-build-test}"
readonly EXPECTED_COMMIT_INPUT="${TICKET13_EXPECTED_COMMIT:-v1.0.6^{}}"
readonly RELEASE_TAG_INPUT="${TICKET13_RELEASE_TAG:-v1.0.6}"
readonly DOCS_FILE="${TICKET13_DOCS_FILE:-docs/tickets/TICKET-13.md}"
readonly README_FILE="${TICKET13_README_FILE:-README.md}"
readonly OUTFILE="${TICKET13_OUTFILE:-/tmp/ticket-13-release-audit-hardening.md}"

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

require_gh_api() {
  if ! gh api user --jq .login >/tmp/ticket-13-gh-user.json 2>&1; then
    fail "GitHub API unavailable or authentication issue. Re-run when online and authenticated (gh auth status)."
  fi
}

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
  run_id="$(gh run list --workflow "$workflow_name" --branch master --limit 1 --json databaseId -q '.[0].databaseId' 2>&1 || true)"
  if [[ -z "$run_id" || "$run_id" == "null" ]]; then
    return 1
  fi
  if [[ "$run_id" == *"error connecting to api.github.com"* || "$run_id" == *"error"* ]]; then
    fail "$run_id"
  fi
  gh run view "$run_id" --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt
}

resolve_workflow() {
  local requested="$1"
  local found
  found="$(gh workflow list --json name | jq -r --arg n "$requested" '.[] | select(.name == $n) | .name' | head -n 1)"
  if [[ -n "$found" ]]; then
    printf '%s' "$found"
    return 0
  fi
  return 1
}

verify_ticket_refs() {
  if [[ ! -f "$DOCS_FILE" ]]; then
    fail "Missing Ticket #13 docs file: ${DOCS_FILE}"
  fi

  if ! grep -qi "release audit hardening" "$DOCS_FILE"; then
    fail "Ticket #13 docs do not describe release audit hardening scope"
  fi

  if [[ ! -f "$README_FILE" ]]; then
    fail "Missing README file: ${README_FILE}"
  fi

  if ! grep -q "### Ticket #13 production release audit hardening" "$README_FILE"; then
    fail "README missing Ticket #13 section heading"
  fi

  if ! grep -q "ticket-13-release-audit-hardening.sh" "$README_FILE"; then
    fail "README missing Ticket #13 script invocation"
  fi
}

require_gh_api
readonly EXPECTED_COMMIT="$(resolve_expected "$EXPECTED_COMMIT_INPUT")"
readonly RELEASE_TAG="${RELEASE_TAG_INPUT}"
readonly RELEASE_TAG_SHA="$(resolve_expected "$RELEASE_TAG_INPUT")"

readonly READINESS_JSON="$(get_run_state "$WORKFLOW_READINESS")" || fail "No workflow run found for ${WORKFLOW_READINESS} on master"

LINT_WORKFLOW_RESOLVED="${WORKFLOW_LINT}"
if ! get_run_state "$LINT_WORKFLOW_RESOLVED" >/dev/null; then
  FALLBACK_WORKFLOW="$(resolve_workflow "$WORKFLOW_LINT_FALLBACK" || true)"
  if [[ -n "${FALLBACK_WORKFLOW}" ]]; then
    LINT_WORKFLOW_RESOLVED="$FALLBACK_WORKFLOW"
  else
    fail "No workflow run found for ${WORKFLOW_LINT} on master (and no fallback workflow matched)."
  fi
fi

readonly LINT_JSON="$(get_run_state "$LINT_WORKFLOW_RESOLVED")" || fail "No workflow run found for ${LINT_WORKFLOW_RESOLVED} on master"

READINESS_STATUS="$(jq -r '.status // empty' <<<"$READINESS_JSON")"
READINESS_CONCLUSION="$(jq -r '.conclusion // empty' <<<"$READINESS_JSON")"
if [[ "$READINESS_STATUS" != "completed" || "$READINESS_CONCLUSION" != "success" ]]; then
  fail "workflow ${WORKFLOW_READINESS} not successful: status=${READINESS_STATUS}, conclusion=${READINESS_CONCLUSION}"
fi
pass "workflow ${WORKFLOW_READINESS} success"

LINT_STATUS="$(jq -r '.status // empty' <<<"$LINT_JSON")"
LINT_CONCLUSION="$(jq -r '.conclusion // empty' <<<"$LINT_JSON")"
if [[ "$LINT_STATUS" != "completed" || "$LINT_CONCLUSION" != "success" ]]; then
  fail "workflow ${LINT_WORKFLOW_RESOLVED} not successful: status=${LINT_STATUS}, conclusion=${LINT_CONCLUSION}"
fi
pass "workflow ${LINT_WORKFLOW_RESOLVED} success"

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

verify_ticket_refs
pass "Ticket #13 docs/README references validated"

TRACKING="$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)"
LOCAL_HEAD="$(git rev-parse --short=8 HEAD)"
ORIGIN_MASTER="$(git rev-parse --short=8 origin/master)"
WIP="$(git status --short 2>/dev/null | awk 'END{print NR}')"

{
  echo "# Ticket #13 production release audit hardening"
  echo ""
  echo "- readiness workflow: ${WORKFLOW_READINESS}"
  echo "- lint workflow: ${LINT_WORKFLOW_RESOLVED}"
  echo "- expected commit: ${EXPECTED_COMMIT}"
  echo "- release tag: ${RELEASE_TAG}"
  echo "- release tag commit: ${RELEASE_TAG_SHA}"
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
  echo "## lint workflow"
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
  echo ""
  echo "## Ticket #13 references"
  echo "docs file: ${DOCS_FILE}"
  echo "readme file: ${README_FILE}"
} >"${OUTFILE}"

cat "${OUTFILE}"
echo ""
echo "Written to ${OUTFILE}"
