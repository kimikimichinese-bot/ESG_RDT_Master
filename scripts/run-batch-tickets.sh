#!/usr/bin/env bash

set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly HELPER="${ROOT_DIR}/scripts/run-batch-ticket.sh"

usage() {
  cat <<'EOF'
Usage: run-batch-tickets.sh --queue <file> [--repo <owner/repo>] [--deploy-final true|false]

Run the full quota-safe ticket batch:
- disconnect Vercel preview integration
- process PR checks from a queue file (one line each)
- reconnect Vercel and optionally run final production deploy

Queue format (one per line):
  <pr-number> <check-script-path> [deploy-flag]
EOF
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

queue_file=""
repo="kimikimichinese-bot/ESG_RDT_Master"
deploy_final="false"

while (($#)); do
  case "$1" in
    --queue)
      queue_file="${2:-}"
      shift 2
      ;;
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --deploy-final)
      deploy_final="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ -n "$queue_file" ]] || fail "--queue is required."
[[ -f "$queue_file" ]] || fail "Queue file not found: $queue_file"
[[ "$deploy_final" == "true" || "$deploy_final" == "false" ]] || fail "--deploy-final must be true|false"

(
  cd "$ROOT_DIR"
  "$HELPER" start
  "$HELPER" run-queue --file "$queue_file"
  "$HELPER" finish --deploy "$deploy_final" --connect-repo "$repo"
)
