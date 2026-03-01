#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="${PROD_ALIAS:-https://esg-rdt-master-kimikimichineses-projects.vercel.app}"
readonly TICKET4_TAG="${TICKET4_TAG:-v1.0.4}"
readonly WORKFLOW_NAME="${TICKET4_WORKFLOW:-production-readiness}"
readonly OUTFILE="${TICKET4_OUTFILE:-/tmp/release-ticket-4-signature.md}"

fail() {
  echo "[FAIL] $1"
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 is required"
  fi
}

require_cmd gh
require_cmd curl
require_cmd git
require_cmd jq

if [[ ! "$TICKET4_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "TICKET4_TAG must look like vX.Y.Z"
fi

if ! git rev-parse "${TICKET4_TAG}"^{commit} >/dev/null 2>&1; then
  fail "Tag ${TICKET4_TAG} does not exist locally"
fi

SHORT_TAG_COMMIT="$(git rev-parse --short=8 "${TICKET4_TAG}")"
LAST_RUN="$(gh run list --workflow "$WORKFLOW_NAME" --branch master --limit 1 --json databaseId -q '.[0].databaseId')"

if [[ -z "$LAST_RUN" || "$LAST_RUN" == "null" ]]; then
  fail "No workflow run found for ${WORKFLOW_NAME} on master"
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
  fail "/api/ready unexpected payload"
fi
if [[ "$HEALTH_STATUS" != "ok" || "$HEALTH_DB" != "ok" ]]; then
  fail "/api/health unexpected payload"
fi
if [[ -n "$HEALTH_VERSION" && "$HEALTH_VERSION" != "$SHORT_TAG_COMMIT" ]]; then
  echo "[WARN] health version ${HEALTH_VERSION} does not match ${SHORT_TAG_COMMIT}" >&2
fi

{
  echo "# Release evidence (Ticket #4)"
  echo ""
  echo "- Release tag: ${TICKET4_TAG}"
  echo "- Release commit: ${SHORT_TAG_COMMIT}"
  echo "- Workflow: ${WORKFLOW_NAME}"
  echo "- Workflow run: ${LAST_RUN}"
  echo "- Workflow URL: https://github.com/kimikimichinese-bot/ESG_RDT_Master/actions/runs/${LAST_RUN}"
  echo ""
  echo "## workflow metadata"
  echo "\`\`\`json"
  echo "${RUN_JSON}"
  echo "\`\`\`"
  echo ""
  echo "## git evidence"
  echo "\`\`\`"
  git show --stat --oneline --decorate --no-patch "${TICKET4_TAG}"
  echo "\`\`\`"
  echo ""
  echo "## ready"
  echo "\`\`\`json"
  echo "${READY}"
  echo "\`\`\`"
  echo ""
  echo "## health"
  echo "\`\`\`json"
  echo "${HEALTH}"
  echo "\`\`\`"
} >"${OUTFILE}"

cat "${OUTFILE}"
echo ""
echo "Written to ${OUTFILE}"
