#!/usr/bin/env bash
set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-kimikimichineses-projects.vercel.app}"
readonly WORKFLOW_READINESS="${TICKET408_WORKFLOW_READINESS:-production-readiness}"
readonly WORKFLOW_LINT="${TICKET408_WORKFLOW_LINT:-ci}"
readonly WORKFLOW_LINT_FALLBACK="${TICKET408_WORKFLOW_LINT_FALLBACK:-lint-build-test}"
readonly RELEASE_TAG_INPUT="${TICKET408_RELEASE_TAG:-v1.0.6}"
readonly EXPECTED_COMMIT_INPUT="${TICKET408_EXPECTED_COMMIT:-${RELEASE_TAG_INPUT}}"
readonly LOG_DEPTH="${TICKET408_LOG_DEPTH:-4}"
readonly DOCS_FILE="${TICKET408_DOCS_FILE:-docs/tickets/TICKET-408.md}"
readonly README_FILE="${TICKET408_README_FILE:-README.md}"
readonly OUTFILE="${TICKET408_OUTFILE:-/tmp/ticket-408-production-readiness-evidence-continuity-wrapup.md}"

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

resolve_expected() {
  local value="$1"
  value="${value%\^\{\}}"
  if [[ "$value" == v* ]]; then
    git rev-parse --short=8 "${value}^{commit}" 2>/dev/null || git rev-parse --short=8 "$value"
  else
    printf '%s\n' "$value"
  fi
}

verify_release_tag() {
  local tag="$1"
  [[ "$tag" == v* ]] || fail "TICKET408_RELEASE_TAG must be a tag like v1.0.6"
  git rev-parse "${tag}^{commit}" >/dev/null 2>&1 || fail "Release tag not found: ${tag}"
}

require_gh_api() {
  gh api user --jq .login >/dev/null || fail "GitHub API unavailable or authentication issue."
}

get_runs_json() {
  local workflow="$1" depth="$2"
  local fetch_depth=$((depth + 3))
  local json
  json="$(gh run list --workflow "$workflow" --branch master --limit "$fetch_depth" --json databaseId,status,conclusion,headSha,headBranch,name,startedAt,updatedAt,url 2>&1 || true)"
  [[ -n "$json" ]] || return 1
  [[ "$json" == "null" || "$json" == "[]" ]] && return 1
  if ! jq -e 'type == "array"' <<<"$json" >/dev/null 2>&1; then
    fail "Could not parse workflow runs for ${workflow}"
  fi
  printf '%s\n' "$json"
}

get_latest_run_json() {
  local workflow="$1"
  local run_id
  run_id="$(gh run list --workflow "$workflow" --branch master --limit 1 --json databaseId -q '.[0].databaseId' || true)"
  [[ -n "$run_id" ]] || return 1
  [[ "$run_id" == "null" ]] && return 1
  gh run view "$run_id" --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt
}

verify_workflow_depth() {
  local runs_json="$1" kind="$2"
  local i=0 bad=0 missing=0
  while read -r status conclusion; do
    ((i+=1))
    if [[ "$status" == "null" || "$conclusion" == "null" ]]; then
      missing=1
    elif [[ "$conclusion" != "success" ]]; then
      bad=1
    fi
  done < <(echo "$runs_json" | jq -r '.[] | select(.status=="completed") | "\(.status) \(.conclusion)"')

  if (( i < LOG_DEPTH )); then
    fail "${kind} run depth too low for requested LOG_DEPTH=${LOG_DEPTH}, found=${i}"
  fi
  if (( bad == 1 )); then
    fail "At least one ${kind} workflow run in last ${LOG_DEPTH} is not successful"
  fi
  if (( missing == 1 )); then
    fail "At least one ${kind} workflow run has missing status/conclusion"
  fi
}

verify_readme_and_docs() {
  [[ -f "$DOCS_FILE" ]] || fail "Missing Ticket #408 docs file: ${DOCS_FILE}"
  grep -q "### Ticket #408" "$DOCS_FILE" || fail "Ticket #408 docs heading missing"

  [[ -f "$README_FILE" ]] || fail "Missing README file: ${README_FILE}"
  grep -q "### Ticket #408" "$README_FILE" || fail "README missing Ticket #408 heading"
  grep -q "ticket-408-production-readiness-evidence-continuity-wrapup.sh" "$README_FILE" || fail "README missing Ticket #408 script command"
  grep -q "### Ticket #408" "$README_FILE" || fail "README continuity missing Ticket #408"

  local line_prev line_current
  line_prev="$(grep -n '^### Ticket #407 ' "$README_FILE" | head -n 1 | cut -d: -f1 || true)"
  line_current="$(grep -n '^### Ticket #408 ' "$README_FILE" | head -n 1 | cut -d: -f1 || true)"
  [[ -n "$line_prev" ]] || fail "README missing Ticket #199 anchor"
  [[ -n "$line_current" ]] || fail "README missing Ticket #408 anchor"
  (( line_current > line_prev )) || fail "README continuity order invalid: Ticket #408 must follow Ticket #199"
}

require_gh_api
verify_release_tag "$RELEASE_TAG_INPUT"

readonly RELEASE_TAG="$RELEASE_TAG_INPUT"
readonly EXPECTED_COMMIT="$(resolve_expected "$EXPECTED_COMMIT_INPUT")"
readonly RELEASE_TAG_COMMIT="$(resolve_expected "${RELEASE_TAG}^{commit}")"

readonly READINESS_RUNS="$(get_runs_json "$WORKFLOW_READINESS" "$LOG_DEPTH")" || fail "No workflow run history found for ${WORKFLOW_READINESS} on master"
readonly READINESS_JSON="$(get_latest_run_json "$WORKFLOW_READINESS")" || fail "No workflow run found for ${WORKFLOW_READINESS} on master"

LINT_WORKFLOW_RESOLVED="$WORKFLOW_LINT"
if ! LINT_RUNS="$(get_runs_json "$LINT_WORKFLOW_RESOLVED" "$LOG_DEPTH")"; then
  fallback="$(gh workflow list --json name | jq -r --arg n "$WORKFLOW_LINT_FALLBACK" '.[] | select(.name == $n) | .name' | head -n 1 || true)"
  if [[ -n "$fallback" ]]; then
    LINT_WORKFLOW_RESOLVED="$fallback"
    LINT_RUNS="$(get_runs_json "$LINT_WORKFLOW_RESOLVED" "$LOG_DEPTH")"
  else
    fail "No workflow run history found for ${WORKFLOW_LINT} on master (and no fallback matched)"
  fi
fi
readonly LINT_RUNS
readonly LINT_JSON="$(get_latest_run_json "$LINT_WORKFLOW_RESOLVED")"

verify_workflow_depth "$READINESS_RUNS" "production-readiness"
pass "production-readiness last ${LOG_DEPTH} runs successful"
verify_workflow_depth "$LINT_RUNS" "$LINT_WORKFLOW_RESOLVED"
pass "${LINT_WORKFLOW_RESOLVED} last ${LOG_DEPTH} runs successful"

ready_response="$(curl -sfS "${PROD_ALIAS}/api/ready")"
ready_status="$(jq -r '.status // empty' <<<"$ready_response")"
ready_web="$(jq -r '.checks.web // empty' <<<"$ready_response")"
[[ "$ready_status" == "ready" && "$ready_web" == "ok" ]] || fail "/api/ready unexpected payload"
pass "/api/ready contract validated"

health_response="$(curl -sfS "${PROD_ALIAS}/api/health")"
health_status="$(jq -r '.status // empty' <<<"$health_response")"
health_db="$(jq -r '.db // empty' <<<"$health_response")"
health_version="$(jq -r '.version // empty' <<<"$health_response")"
[[ "$health_status" == "ok" && "$health_db" == "ok" ]] || fail "/api/health unexpected payload"
[[ -n "$health_version" ]] || fail "/api/health missing version"
[[ "$health_version" == "$EXPECTED_COMMIT" ]] || fail "health version mismatch: expected ${EXPECTED_COMMIT}, got ${health_version}"
pass "/api/health contract and version validated"

verify_readme_and_docs
pass "Ticket #408 docs/README continuity validated"

origin_master="$(git rev-parse --short=8 origin/master)"
local_head="$(git rev-parse --short=8 HEAD)"
tracking="$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)"

{
  echo "# Ticket #408 production readiness evidence continuity wrapup"
  echo ""
  echo "- release tag: ${RELEASE_TAG}"
  echo "- release tag commit: ${RELEASE_TAG_COMMIT}"
  echo "- expected commit: ${EXPECTED_COMMIT}"
  echo "- observed health version: ${health_version}"
  echo "- run depth: ${LOG_DEPTH}"
  echo "- generated at: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "- readiness workflow: ${WORKFLOW_READINESS} (${origin_master})"
  echo "- lint workflow: ${LINT_WORKFLOW_RESOLVED}"
  echo "- origin/master: ${origin_master}"
  echo "- local HEAD: ${local_head}"
  echo "- upstream: ${tracking:-not-set}"
  echo ""
  echo "## workflow runs (last ${LOG_DEPTH})"
  echo '```json'
  echo "{\"readiness_runs\": ${READINESS_RUNS}, \"lint_runs\": ${LINT_RUNS}}"
  echo '```'
  echo "## /api/ready"
  echo '```json'
  echo "${ready_response}"
  echo '```'
  echo "## /api/health"
  echo '```json'
  echo "${health_response}"
  echo '```'
  echo ""
} >"${OUTFILE}"

echo "Written to ${OUTFILE}"
