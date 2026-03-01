#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-kimikimichineses-projects.vercel.app}"
readonly PROD_WORKFLOW="${PROD_WORKFLOW:-production-readiness}"
readonly TICKET5_TAG="${TICKET5_TAG:-v1.0.4}"
readonly TICKET5_REF="${TICKET5_REF:-}"
readonly OUTFILE="${TICKET5_OUTFILE:-/tmp/ticket-5-audit-bundle.md}"

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
require_cmd git
require_cmd curl
require_cmd jq

if [[ -z "$TICKET5_TAG" ]]; then
  fail "TICKET5_TAG is required"
fi

if ! git rev-parse "${TICKET5_TAG}"^{commit} >/dev/null 2>&1; then
  fail "Tag ${TICKET5_TAG} does not exist"
fi

if ! [[ "$TICKET5_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "TICKET5_TAG must be semver-like, e.g., v1.0.4"
fi

LAST_RUN="$(gh run list --workflow "$PROD_WORKFLOW" --branch master --limit 1 --json databaseId -q '.[0].databaseId')"
if [[ -z "$LAST_RUN" || "$LAST_RUN" == "null" ]]; then
  fail "No production-readiness run found on master"
fi

RUN_JSON="$(gh run view "$LAST_RUN" --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt)"

READY="$(curl -sfS "${PROD_ALIAS}/api/ready")"
HEALTH="$(curl -sfS "${PROD_ALIAS}/api/health")"

READY_STATUS="$(jq -r '.status' <<<"$READY")"
READY_WEB="$(jq -r '.checks.web // empty' <<<"$READY")"
HEALTH_STATUS="$(jq -r '.status // empty' <<<"$HEALTH")"
HEALTH_DB="$(jq -r '.db // empty' <<<"$HEALTH")"
HEALTH_VERSION="$(jq -r '.version // empty' <<<"$HEALTH")"

if [[ "$READY_STATUS" != "ready" || "$READY_WEB" != "ok" ]]; then
  fail "/api/ready contract failed"
fi
pass "/api/ready contract validated"

if [[ "$HEALTH_STATUS" != "ok" || "$HEALTH_DB" != "ok" ]]; then
  fail "/api/health contract failed"
fi
pass "/api/health contract validated"

TAG_COMMIT="$(git rev-parse --short=8 "${TICKET5_TAG}")"
CHECK_REF="${TICKET5_REF:-$TAG_COMMIT}"

{
  echo "# Audit bundle (Ticket #5)"
  echo ""
  echo "- Tag: ${TICKET5_TAG}"
  echo "- Tag commit: ${TAG_COMMIT}"
  echo "- Check ref: ${CHECK_REF}"
  echo "- Workflow run: ${LAST_RUN}"
  echo "- Workflow URL: https://github.com/kimikimichinese-bot/ESG_RDT_Master/actions/runs/${LAST_RUN}"
  echo ""
  echo "## workflow metadata"
  echo '```json'
  echo "${RUN_JSON}"
  echo '```'
  echo ""
  echo "## git evidence"
  echo '```'
  git show --stat --oneline --decorate --no-patch "${TICKET5_TAG}"
  echo '```'
  echo ""
  echo "## endpoint outputs"
  echo "### /api/ready"
  echo '```json'
  echo "${READY}"
  echo '```'
  echo ""
  echo "### /api/health"
  echo '```json'
  echo "${HEALTH}"
  echo '```'
  echo ""
  echo "## version check"
  if [[ -n "$HEALTH_VERSION" ]]; then
    echo "Observed version: ${HEALTH_VERSION}"
  else
    echo "Observed version: <missing>"
  fi
  echo ""
  echo "## branch snapshot"
  echo '```'
  git log --oneline --decorate -n 5
  echo '```'
} >"${OUTFILE}"

cat "${OUTFILE}"
echo ""
echo "Written to ${OUTFILE}"
