#!/usr/bin/env bash

set -euo pipefail

readonly PROD_ALIAS="https://esg-rdt-master-pi.vercel.app"
readonly WORKFLOW_NAME="production-readiness"
readonly RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
readonly RUN_PROD_DEPLOY="${RUN_PROD_DEPLOY:-false}"
readonly TICKET3_EXPECTED_COMMIT="${TICKET3_EXPECTED_COMMIT:-$(git rev-parse --short=8 HEAD)}"

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

if [[ "$RUN_MIGRATIONS" != "true" && "$RUN_MIGRATIONS" != "false" ]]; then
  fail "RUN_MIGRATIONS must be true|false"
fi
if [[ "$RUN_PROD_DEPLOY" != "true" && "$RUN_PROD_DEPLOY" != "false" ]]; then
  fail "RUN_PROD_DEPLOY must be true|false"
fi

if [[ -z "$TICKET3_EXPECTED_COMMIT" ]]; then
  fail "TICKET3_EXPECTED_COMMIT is empty. Set it to expected short commit/tag form (default 8 chars)."
fi

echo "=== Ticket #3 production readiness check ==="
./scripts/context-check.sh
pass "Context verification completed"

echo "--- Run readiness workflow ---"
gh workflow run "${WORKFLOW_NAME}.yml" -f run_migrations="$RUN_MIGRATIONS" --ref master

echo "Waiting for workflow schedule to update..."
sleep 30

LATEST_RUN="$(gh run list --workflow "$WORKFLOW_NAME" --branch master --limit 1 --json databaseId -q '.[0].databaseId')"
echo "Latest readiness run: $LATEST_RUN"
gh run list --workflow "$WORKFLOW_NAME" --branch master --limit 1
gh run watch "$LATEST_RUN"
gh run view "$LATEST_RUN" --json status,conclusion,url,name --jq '{status:.status,conclusion:.conclusion,url:.url,name:.name}'

echo "--- Deploy and endpoint checks ---"
./scripts/context-check.sh
if [[ "$RUN_PROD_DEPLOY" == "true" ]]; then
  vercel --prod --yes
else
  pass "RUN_PROD_DEPLOY is false, skipping vercel --prod (quota-safe mode)"
fi

READY_RESPONSE="$(curl -sfS "${PROD_ALIAS}/api/ready")"
echo "$READY_RESPONSE"
if [[ "$READY_RESPONSE" != *"\"status\":\"ready\""* ]] || [[ "$READY_RESPONSE" != *"\"web\":\"ok\""* ]]; then
  fail "/api/ready failed readiness contract"
fi
pass "/api/ready contract OK"

HEALTH_RESPONSE="$(curl -sfS "${PROD_ALIAS}/api/health")"
echo "$HEALTH_RESPONSE"
if [[ "$HEALTH_RESPONSE" != *"\"status\":\"ok\""* ]] || [[ "$HEALTH_RESPONSE" != *"\"db\":\"ok\""* ]]; then
  fail "/api/health failed readiness contract"
fi
if [[ "$HEALTH_RESPONSE" != *"\"version\":\"${TICKET3_EXPECTED_COMMIT}\""* ]]; then
  fail "health version mismatch: expected ${TICKET3_EXPECTED_COMMIT}"
fi
pass "/api/health contract and version matched"

echo "Ticket #3 production readiness check completed."
