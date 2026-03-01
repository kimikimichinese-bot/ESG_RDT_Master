#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-kimikimichineses-projects.vercel.app}"
readonly PROD_WORKFLOW="${PROD_WORKFLOW:-production-readiness}"
readonly COMMIT_LEN="${COMMIT_LEN:-8}"

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

if ! command -v jq >/dev/null 2>&1; then
  fail "jq is required. Install with: brew install jq"
fi

if ! command -v gh >/dev/null 2>&1; then
  fail "gh CLI is required"
fi

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required"
fi

if ! command -v git >/dev/null 2>&1; then
  fail "git is required"
fi

EXPECTED_COMMIT="${TICKET3_EXPECTED_COMMIT:-$(git rev-parse --short=${COMMIT_LEN} origin/master)}"
LAST_RUN="$(gh run list --workflow "$PROD_WORKFLOW" --branch master --limit 1 --json databaseId -q '.[0].databaseId')"
if [[ -z "$LAST_RUN" || "$LAST_RUN" == "null" ]]; then
  fail "No workflow run found for $PROD_WORKFLOW on master"
fi

echo "LAST_RUN=${LAST_RUN}"
gh run view "$LAST_RUN" \
  --json status,conclusion,url,name,headSha,headBranch,startedAt,updatedAt \
  --jq '{run:.databaseId,status:.status,conclusion:.conclusion,url:.url,sha:.headSha,branch:.headBranch,startedAt:.startedAt,updatedAt:.updatedAt}'

READY="$(curl -sfS "${PROD_ALIAS}/api/ready")"
HEALTH="$(curl -sfS "${PROD_ALIAS}/api/health")"

echo "$READY"
echo "$HEALTH"

READY_STATUS="$(jq -r '.status' <<<"$READY")"
READY_WEB="$(jq -r '.checks.web' <<<"$READY")"
HEALTH_STATUS="$(jq -r '.status' <<<"$HEALTH")"
HEALTH_DB="$(jq -r '.db // empty' <<<"$HEALTH")"
HEALTH_VERSION="$(jq -r '.version // empty' <<<"$HEALTH")"

if [[ "$READY_STATUS" != "ready" || "$READY_WEB" != "ok" ]]; then
  fail "/api/ready contract failed (status=${READY_STATUS}, web=${READY_WEB})"
fi
pass "/api/ready contract validated"

if [[ "$HEALTH_STATUS" != "ok" || "$HEALTH_DB" != "ok" ]]; then
  fail "/api/health contract failed (status=${HEALTH_STATUS}, db=${HEALTH_DB})"
fi

if [[ "$HEALTH_VERSION" != "$EXPECTED_COMMIT" ]]; then
  fail "Health version mismatch: expected ${EXPECTED_COMMIT}, found ${HEALTH_VERSION}"
fi
pass "/api/health contract and version validated"

echo "closeout: ok"
echo "expected=${EXPECTED_COMMIT}"
echo "health_version=${HEALTH_VERSION}"
