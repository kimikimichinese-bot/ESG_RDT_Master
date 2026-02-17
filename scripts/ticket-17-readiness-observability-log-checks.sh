#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-pi.vercel.app}"
readonly WORKFLOW_READINESS="${TICKET17_WORKFLOW_READINESS:-production-readiness}"
readonly WORKFLOW_LINT="${TICKET17_WORKFLOW_LINT:-ci}"
readonly WORKFLOW_LINT_FALLBACK="${TICKET17_WORKFLOW_LINT_FALLBACK:-lint-build-test}"
readonly RELEASE_TAG_INPUT="${TICKET17_RELEASE_TAG:-v1.0.6}"
readonly EXPECTED_COMMIT_INPUT="${TICKET17_EXPECTED_COMMIT:-${RELEASE_TAG_INPUT}^{}}"
readonly DOCS_FILE="${TICKET17_DOCS_FILE:-docs/tickets/TICKET-17.md}"
readonly README_FILE="${TICKET17_README_FILE:-README.md}"
readonly OUTFILE="${TICKET17_OUTFILE:-/tmp/ticket-17-readiness-observability.md}"

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }
require_cmd gh
require_cmd curl
require_cmd git
require_cmd jq

require_gh_api() {
  if ! gh api user --jq .login >/tmp/ticket-17-gh-user.json 2>&1; then
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
  [[ "$tag" == v* ]] || fail "TICKET17_RELEASE_TAG must be a git tag like v1.0.6"
  if ! git rev-parse "${tag}^{commit}" >/dev/null 2>&1; then
    fail "Release tag does not exist or is not a commit: ${tag}"
  fi
}

get_run_json() {
  local workflow="$1"
  local run_id
  run_id="$(gh run list --workflow "$workflow" --branch master --limit 1 --json databaseId -q '.[0].databaseId' 2>&1 || true)"
  if [[ -z "$run_id" || "$run_id" == "null" ]]; then
    return 1
  fi
  if [[ "$run_id" == *"error connecting to api.github.com"* || "$run_id" == *"error" ]]; then
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
  [[ -f "$DOCS_FILE" ]] || fail "Missing Ticket #17 docs file: ${DOCS_FILE}"
  grep -qi "observability log checks" "$DOCS_FILE" || fail "Ticket #17 docs do not describe observability checks scope"
  [[ -f "$README_FILE" ]] || fail "Missing README file: ${README_FILE}"
  grep -q "### Ticket #17 production readiness observability log checks" "$README_FILE" || fail "README missing Ticket #17 section heading"
  grep -q "ticket-17-readiness-observability-log-checks.sh" "$README_FILE" || fail "README missing Ticket #17 script invocation"
  grep -q "### Production freeze policy (strict PR-only)" "$README_FILE" || fail "README missing production freeze policy section"
  grep -q "### One-command full production check (copy-paste)" "$README_FILE" || fail "README missing one-command full production check"
}

require_gh_api
verify_release_tag "$RELEASE_TAG_INPUT"

readonly RELEASE_TAG="${RELEASE_TAG_INPUT}"
readonly EXPECTED_COMMIT="$(resolve_expected "$EXPECTED_COMMIT_INPUT")"
readonly RELEASE_TAG_COMMIT="$(resolve_expected "${RELEASE_TAG}^{}")"

readonly READINESS_JSON="$(get_run_json "$WORKFLOW_READINESS")" || fail "No workflow run found for ${WORKFLOW_READINESS} on master"

LINT_WORKFLOW_RESOLVED="$WORKFLOW_LINT"
if ! LINT_JSON="$(get_run_json "$LINT_WORKFLOW_RESOLVED" 2>/dev/null)"; then
  fallback="$(resolve_workflow "$WORKFLOW_LINT_FALLBACK" || true)"
  if [[ -n "$fallback" ]]; then
    LINT_WORKFLOW_RESOLVED="$fallback"
  else
    fail "No workflow run found for ${WORKFLOW_LINT} on master (and no fallback workflow matched)."
  fi
fi
readonly LINT_JSON="${LINT_JSON:-$(get_run_json "$LINT_WORKFLOW_RESOLVED")}"

readiness_status="$(jq -r '.status // empty' <<<"$READINESS_JSON")"
readiness_conclusion="$(jq -r '.conclusion // empty' <<<"$READINESS_JSON")"
if [[ "$readiness_status" != "completed" || "$readiness_conclusion" != "success" ]]; then
  fail "workflow ${WORKFLOW_READINESS} not successful: status=${readiness_status}, conclusion=${readiness_conclusion}"
fi
pass "workflow ${WORKFLOW_READINESS} success"

lint_status="$(jq -r '.status // empty' <<<"$LINT_JSON")"
lint_conclusion="$(jq -r '.conclusion // empty' <<<"$LINT_JSON")"
if [[ "$lint_status" != "completed" || "$lint_conclusion" != "success" ]]; then
  fail "workflow ${LINT_WORKFLOW_RESOLVED} not successful: status=${lint_status}, conclusion=${lint_conclusion}"
fi
pass "workflow ${LINT_WORKFLOW_RESOLVED} success"

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

service_name="$(jq -r '.service // empty' <<<"$health_response")"
if [[ -z "$service_name" ]]; then
  fail "/api/health missing service field"
fi
pass "/api/health includes service identity"

verify_ticket_refs
pass "Ticket #17 docs/README references validated"

tracking="$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)"
local_head="$(git rev-parse --short=8 HEAD)"
origin_master="$(git rev-parse --short=8 origin/master)"
ready_branch="$(jq -r '.headBranch // empty' <<<"$READINESS_JSON")"
lint_branch="$(jq -r '.headBranch // empty' <<<"$LINT_JSON")"
run_ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

{
  echo "# Ticket #17 production readiness observability log checks"
  echo ""
  echo "- release tag: ${RELEASE_TAG}"
  echo "- release tag commit: ${RELEASE_TAG_COMMIT}"
  echo "- expected commit: ${EXPECTED_COMMIT}"
  echo "- service: ${service_name}"
  echo "- observed health version: ${health_version}"
  echo "- observed evidence line: ${RELEASE_TAG}@${health_version}"
  echo "- generated at: ${run_ts}"
  echo "- readiness workflow: ${WORKFLOW_READINESS} (${ready_branch:-master})"
  echo "- lint workflow: ${LINT_WORKFLOW_RESOLVED} (${lint_branch:-master})"
  echo "- origin/master: ${origin_master}"
  echo "- local HEAD: ${local_head}"
  echo "- upstream: ${tracking:-not-set}"
  echo ""
  echo "## observability fingerprint"
  echo '```json'
  echo "{"
  echo "  \"service\": \"${service_name}\","
  echo "  \"release_tag\": \"${RELEASE_TAG}\","
  echo "  \"release_commit\": \"${RELEASE_TAG_COMMIT}\","
  echo "  \"checked_commit\": \"${EXPECTED_COMMIT}\","
  echo "  \"health_version\": \"${health_version}\","
  echo "  \"readiness\": \"${readiness_status}/${readiness_conclusion}\","
  echo "  \"lint\": \"${lint_status}/${lint_conclusion}\","
  echo "  \"generated_at\": \"${run_ts}\""
  echo "}"
  echo '```'
  echo ""
  echo "## workflows"
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
