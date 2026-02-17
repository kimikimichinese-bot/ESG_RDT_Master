#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-pi.vercel.app}"
readonly WORKFLOW_READINESS="${TICKET21_WORKFLOW_READINESS:-production-readiness}"
readonly WORKFLOW_LINT="${TICKET21_WORKFLOW_LINT:-ci}"
readonly WORKFLOW_LINT_FALLBACK="${TICKET21_WORKFLOW_LINT_FALLBACK:-lint-build-test}"
readonly RELEASE_TAG_INPUT="${TICKET21_RELEASE_TAG:-v1.0.6}"
readonly EXPECTED_COMMIT_INPUT="${TICKET21_EXPECTED_COMMIT:-${RELEASE_TAG_INPUT}^{}}"
readonly LOG_DEPTH="${TICKET21_LOG_DEPTH:-3}"
readonly DOCS_FILE="${TICKET21_DOCS_FILE:-docs/tickets/TICKET-21.md}"
readonly README_FILE="${TICKET21_README_FILE:-README.md}"
readonly OUTFILE="${TICKET21_OUTFILE:-/tmp/ticket-21-readiness-hardening.md}"

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_cmd gh
require_cmd curl
require_cmd git
require_cmd jq

require_gh_api() {
  if ! gh api user --jq .login >/tmp/ticket-21-gh-user.json 2>&1; then
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

verify_release_tag() {
  local tag="$1"
  [[ "$tag" == v* ]] || fail "TICKET21_RELEASE_TAG must be a git tag like v1.0.6"
  if ! git rev-parse "${tag}^{commit}" >/dev/null 2>&1; then
    fail "Release tag does not exist or is not a commit: ${tag}"
  fi
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

get_runs_json() {
  local workflow="$1"
  local depth="$2"
  local json
  json="$(gh run list --workflow "$workflow" --branch master --limit "$depth" --json databaseId,status,conclusion,headSha,headBranch,name,startedAt,updatedAt,url 2>&1 || true)"
  if [[ -z "$json" || "$json" == "null" || "$json" == "[]" ]]; then
    return 1
  fi
  if ! jq -e 'type == "array"' <<<"$json" >/dev/null 2>&1; then
    fail "Could not parse workflow runs as JSON for ${workflow}: ${json}"
  fi
  if jq -e 'length == 0' <<<"$json" >/dev/null 2>&1; then
    return 1
  fi
  if [[ "$json" == *"error connecting to api.github.com"* || "$json" == *"Could not resolve host"* ]]; then
    fail "$json"
  fi
  printf '%s\n' "$json"
}

get_latest_run_json() {
  local workflow="$1"
  local run_id
  run_id="$(gh run list --workflow "$workflow" --branch master --limit 1 --json databaseId -q '.[0].databaseId' 2>&1 || true)"
  if [[ -z "$run_id" || "$run_id" == "null" ]]; then
    return 1
  fi
  if [[ "$run_id" == *"error connecting to api.github.com"* || "$run_id" == *"Could not resolve host"* ]]; then
    fail "$run_id"
  fi
  gh run view "$run_id" --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt
}

verify_workflow_depth() {
  local workflow_json="$1"
  local kind="$2"
  local bad=0
  local missing=0
  local i=0

  while read -r status conclusion; do
    ((i+=1))
    if [[ "$status" == "null" || "$conclusion" == "null" ]]; then
      missing=1
    elif [[ "$status" != "completed" || "$conclusion" != "success" ]]; then
      bad=1
    fi
  done < <(echo "$workflow_json" | jq -r '.[] | "\(.status) \(.conclusion)"')

  if (( i < LOG_DEPTH )); then
    fail "${kind} run depth too low for requested LOG_DEPTH=${LOG_DEPTH}, found=${i}"
  fi
  if (( bad == 1 )); then
    fail "At least one ${kind} workflow run in last ${LOG_DEPTH} is not successful"
  fi
  if (( missing == 1 )); then
    fail "At least one ${kind} workflow run has missing status/conclusion in depth ${LOG_DEPTH}"
  fi
}

verify_ticket_refs() {
  [[ -f "$DOCS_FILE" ]] || fail "Missing Ticket #21 docs file: ${DOCS_FILE}"
  grep -qi "Production readiness hardening" "$DOCS_FILE" || fail "Ticket #21 docs missing hardening scope"
  [[ -f "$README_FILE" ]] || fail "Missing README file: ${README_FILE}"
  grep -q "### Ticket #21 production readiness hardening and command continuity" "$README_FILE" || fail "README missing Ticket #21 section heading"
  grep -q "ticket-21-readiness-hardening.sh" "$README_FILE" || fail "README missing Ticket #21 script invocation"
  grep -q "### Ticket #20 production readiness log depth and continuity evidence" "$README_FILE" || fail "README missing Ticket #20 section needed for continuity"
}

verify_readme_continuity() {
  local line_20 line_21 max_ticket
  line_20="$(grep -n '^### Ticket #20 ' "$README_FILE" | head -n 1 | cut -d: -f1 || true)"
  line_21="$(grep -n '^### Ticket #21 ' "$README_FILE" | head -n 1 | cut -d: -f1 || true)"
  [[ -n "$line_20" ]] || fail "README missing Ticket #20 anchor for continuity"
  [[ -n "$line_21" ]] || fail "README missing Ticket #21 anchor"
  if (( line_21 <= line_20 )); then
    fail "README continuity order invalid: Ticket #21 must come after Ticket #20"
  fi

  max_ticket="$(awk '/^### Ticket #{1,}[0-9]+/{gsub(/^### Ticket #| .*/,"",$0); print $0}' "$README_FILE" | sort -n | tail -n 1)"
  if [[ -z "$max_ticket" ]]; then
    fail "Unable to parse ticket numbering from README"
  fi
  if (( max_ticket < 21 )); then
    fail "README continuity gap: highest ticket number is ${max_ticket}, expected >= 21"
  fi
}

require_gh_api
verify_release_tag "$RELEASE_TAG_INPUT"

readonly RELEASE_TAG="${RELEASE_TAG_INPUT}"
readonly EXPECTED_COMMIT="$(resolve_expected "$EXPECTED_COMMIT_INPUT")"
readonly RELEASE_TAG_COMMIT="$(resolve_expected "${RELEASE_TAG}^{}")"

readonly READINESS_RUNS="$(get_runs_json "$WORKFLOW_READINESS" "$LOG_DEPTH")" || fail "No workflow run history found for ${WORKFLOW_READINESS} on master"
readonly READINESS_JSON="$(get_latest_run_json "$WORKFLOW_READINESS")" || fail "No workflow run found for ${WORKFLOW_READINESS} on master"

LINT_WORKFLOW_RESOLVED="$WORKFLOW_LINT"
LINT_RUNS="$(get_runs_json "$LINT_WORKFLOW_RESOLVED" "$LOG_DEPTH" 2>/dev/null || true)"
if [[ -z "$LINT_RUNS" ]]; then
  fallback="$(resolve_workflow "$WORKFLOW_LINT_FALLBACK" || true)"
  if [[ -n "$fallback" ]]; then
    LINT_WORKFLOW_RESOLVED="$fallback"
    LINT_RUNS="$(get_runs_json "$LINT_WORKFLOW_RESOLVED" "$LOG_DEPTH")"
  else
    fail "No workflow run history found for ${WORKFLOW_LINT} on master (and no fallback workflow matched)."
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
if [[ "$ready_status" != "ready" || "$ready_web" != "ok" ]]; then
  fail "/api/ready unexpected payload"
fi
pass "/api/ready contract validated"

health_response="$(curl -sfS "${PROD_ALIAS}/api/health")"
health_status="$(jq -r '.status // empty' <<<"$health_response")"
health_db="$(jq -r '.db // empty' <<<"$health_response")"
health_version="$(jq -r '.version // empty' <<<"$health_response")"
if [[ "$health_status" != "ok" || "$health_db" != "ok" ]]; then
  fail "/api/health unexpected payload"
fi
if [[ -n "$health_version" && "$health_version" != "$EXPECTED_COMMIT" ]]; then
  fail "health version mismatch: expected ${EXPECTED_COMMIT}, got ${health_version}"
fi
pass "/api/health contract and version validated"

verify_ticket_refs
verify_readme_continuity
pass "Ticket #21 docs/README continuity validated"

tracking="$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)"
local_head="$(git rev-parse --short=8 HEAD)"
origin_master="$(git rev-parse --short=8 origin/master)"
readiness_branch="$(jq -r '.headBranch // empty' <<<"$READINESS_JSON")"
lint_branch="$(jq -r '.headBranch // empty' <<<"$LINT_JSON")"
run_ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
ticket_count="$(grep '^### Ticket #' "$README_FILE" | wc -l | tr -d ' ')"

{
  echo "# Ticket #21 production readiness hardening"
  echo ""
  echo "- release tag: ${RELEASE_TAG}"
  echo "- release tag commit: ${RELEASE_TAG_COMMIT}"
  echo "- expected commit: ${EXPECTED_COMMIT}"
  echo "- observed health version: ${health_version}"
  echo "- observed evidence line: ${RELEASE_TAG}@${health_version}"
  echo "- run depth: ${LOG_DEPTH}"
  echo "- generated at: ${run_ts}"
  echo "- readiness workflow: ${WORKFLOW_READINESS} (${readiness_branch:-master})"
  echo "- lint workflow: ${LINT_WORKFLOW_RESOLVED} (${lint_branch:-master})"
  echo "- origin/master: ${origin_master}"
  echo "- local HEAD: ${local_head}"
  echo "- upstream: ${tracking:-not-set}"
  echo "- README ticket sections: ${ticket_count}"
  echo ""
  echo "## hardening fingerprint"
  echo '```json'
  echo "{"
  echo "  \"release_tag\": \"${RELEASE_TAG}\","
  echo "  \"release_commit\": \"${RELEASE_TAG_COMMIT}\","
  echo "  \"checked_commit\": \"${EXPECTED_COMMIT}\","
  echo "  \"health_version\": \"${health_version}\","
  echo "  \"log_depth\": ${LOG_DEPTH},"
  echo "  \"readiness\": \"completed/success\","
  echo "  \"lint\": \"completed/success\","
  echo "  \"ticket_sections\": ${ticket_count},"
  echo "  \"generated_at\": \"${run_ts}\""
  echo "}"
  echo '```'
  echo ""
  echo "## workflow runs (last ${LOG_DEPTH})"
  echo '```json'
  echo "{\"readiness_runs\": ${READINESS_RUNS}, \"lint_runs\": ${LINT_RUNS}}"
  echo '```'
  echo ""
  echo "## workflows latest"
  echo '```json'
  echo "{\"readiness\": ${READINESS_JSON}, \"lint\": ${LINT_JSON}}"
  echo '```'
  echo ""
  echo "## /api/ready"
  echo '```json'
  echo "${ready_response}"
  echo '```'
  echo "## /api/health"
  echo '```json'
  echo "${health_response}"
  echo '```'
  echo ""
  echo "## ticket artifacts"
  echo "docs file: ${DOCS_FILE}"
  echo "readme file: ${README_FILE}"
} >"${OUTFILE}"

cat "${OUTFILE}"
echo ""
echo "Written to ${OUTFILE}"
