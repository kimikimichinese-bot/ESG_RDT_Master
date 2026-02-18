#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1"
}

vercel_git_disconnect() {
  if ! command -v vercel >/dev/null 2>&1; then
    log "WARN: vercel CLI not available; skipping git disconnect."
    return
  fi

  log "Disconnecting Vercel Git integration (auto-confirm)."
  # Vercel confirm prompt is text-based and can block unattended batches.
  printf 'y\n' | vercel git disconnect || log "WARN: vercel git disconnect failed (continuing)."
}

vercel_git_connect() {
  local repo="$1"

  if ! command -v vercel >/dev/null 2>&1; then
    log "WARN: vercel CLI not available; skipping git reconnect."
    return
  fi

  if [[ -z "$repo" ]]; then
    log "WARN: no repo provided for reconnect; skipping vercel git connect."
    return
  fi

  log "Reconnecting Vercel Git integration to ${repo}."
  vercel git connect "$repo" || log "WARN: vercel git connect failed. Re-run manually with vercel git connect ${repo}."
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
}

get_pr_state() {
  local pr="$1"
  local state
  state="$(gh pr list --state all --json number,state --jq ".[] | select(.number == $pr) | .state" | head -n 1 || true)"
  if [[ -z "$state" || "$state" == "null" ]]; then
    return 1
  fi
  printf '%s\n' "$state"
}

run_check_script() {
  local script="$1"
  local deploy_flag="$2"

  if [[ ! -f "$script" ]]; then
    fail "Missing check script: $script"
  fi

  log "Running check script: $script (RUN_PROD_DEPLOY=${deploy_flag})"
  (
    cd "$ROOT_DIR"
    export RUN_PROD_DEPLOY="$deploy_flag"
    if [[ -x "$script" ]]; then
      "$script"
    else
      bash "$script"
    fi
  )
}

cmd_start() {
  local disconnect_preview=true

  while (($#)); do
    case "$1" in
      --disconnect-preview)
        disconnect_preview="${2:-}"
        shift 2
        ;;
      --keep-preview)
        disconnect_preview="false"
        shift
        ;;
      --help|-h)
        usage_start
        exit 0
        ;;
      *)
        fail "Unknown option for start: $1"
        ;;
    esac
  done

  log "Starting quota-safe batch mode"
  require_cmd git
  require_cmd gh

  cd "$ROOT_DIR"
  git fetch --all --prune

  if [[ "$disconnect_preview" == "true" ]]; then
    log "Disconnecting Vercel Git integration to avoid preview deploys."
    vercel_git_disconnect
  fi

  if git rev-parse --verify dev >/dev/null 2>&1; then
    git checkout dev
  else
    fail "No local dev branch found. Create it manually and retry."
  fi
  git pull --ff-only origin master
  pass "Batch start complete on dev and synced with master"
}

cmd_process() {
  local pr=""
  local check_script=""
  local deploy="false"

  while (($#)); do
    case "$1" in
      --pr)
        pr="${2:-}"
        shift 2
        ;;
      --check-script)
        check_script="${2:-}"
        shift 2
        ;;
      --deploy)
        deploy="${2:-}"
        shift 2
        ;;
      --help|-h)
        usage_process
        exit 0
        ;;
      *)
        fail "Unknown option for process: $1"
        ;;
    esac
  done

  [[ -n "$pr" ]] || fail "--pr is required for process"
  [[ -n "$check_script" ]] || fail "--check-script is required for process"
  [[ "$deploy" == "true" || "$deploy" == "false" ]] || fail "--deploy must be true|false"

  require_cmd gh
  require_cmd git

  cd "$ROOT_DIR"

  log "Processing PR #${pr}"
  if state="$(get_pr_state "$pr")"; then
    if [[ "$state" == "OPEN" ]]; then
      log "Merging PR #${pr}"
      gh pr merge "$pr" --merge --delete-branch
      pass "PR #${pr} merged"
    else
      log "PR #${pr} is ${state}, skipping merge step"
    fi
  else
    fail "PR #${pr} not found"
  fi

  git checkout master
  git pull --ff-only origin master
  run_check_script "$check_script" "$deploy"
  pass "Ticket flow complete for PR #${pr}"
}

cmd_run_queue() {
  local queue_file=""
  local default_deploy="false"

  while (($#)); do
    case "$1" in
      --file)
        queue_file="${2:-}"
        shift 2
        ;;
      --deploy)
        default_deploy="${2:-}"
        shift 2
        ;;
      --help|-h)
        usage_run_queue
        exit 0
        ;;
      *)
        fail "Unknown option for run-queue: $1"
        ;;
    esac
  done

  [[ -n "$queue_file" ]] || fail "--file is required for run-queue"
  [[ -f "$queue_file" ]] || fail "Queue file not found: $queue_file"
  [[ "$default_deploy" == "true" || "$default_deploy" == "false" ]] || fail "--deploy must be true|false"

  cd "$ROOT_DIR"
  log "Running queue file: $queue_file"
  local line pr script deploy
  local n=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim spaces
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    [[ "${line:0:1}" == "#" ]] && continue

    read -r pr script deploy <<<"$line"
    n=$((n + 1))
    [[ -z "$pr" || -z "$script" ]] && fail "Invalid queue row ${n}: '$line'"
    deploy="${deploy:-$default_deploy}"
    [[ "$deploy" == "true" || "$deploy" == "false" ]] || fail "Invalid deploy flag '${deploy}' at row ${n}"
    log "Queue #${n}: PR #${pr}, script=${script}, deploy=${deploy}"
    cmd_process --pr "$pr" --check-script "$script" --deploy "$deploy"
  done < "$queue_file"
  pass "Completed queue processing for ${n} items"
}

cmd_finish() {
  local deploy="false"
  local connect_repo=""
  local skip_connect="false"

  while (($#)); do
    case "$1" in
      --deploy)
        deploy="${2:-}"
        shift 2
        ;;
      --connect-repo)
        connect_repo="${2:-}"
        shift 2
        ;;
      --no-connect)
        skip_connect="true"
        shift
        ;;
      --help|-h)
        usage_finish
        exit 0
        ;;
      *)
        fail "Unknown option for finish: $1"
        ;;
    esac
  done

  [[ "$deploy" == "true" || "$deploy" == "false" ]] || fail "--deploy must be true|false"

  if [[ "$skip_connect" != "true" && -n "$connect_repo" ]]; then
    vercel_git_connect "$connect_repo"
  elif [[ "$skip_connect" != "true" ]]; then
    log "No --connect-repo provided; skipping reconnection (manual reconnection needed)."
  fi

  if [[ "$deploy" == "true" ]]; then
    require_cmd vercel
    cd "$ROOT_DIR"
    log "Running final production deploy"
    vercel --prod --yes
    pass "Final production deploy completed"
  else
    log "Final production deploy skipped (RUN_PROD_DEPLOY=false)"
  fi
}

usage_start() {
  cat <<'EOF'
Usage: run-batch-ticket.sh start [--disconnect-preview true|false] [--keep-preview]

Options:
  --disconnect-preview true|false   Enable/disable vercel git disconnect (default: true)
  --keep-preview                   Shortcut to keep preview deploys enabled
EOF
}

usage_process() {
  cat <<'EOF'
Usage: run-batch-ticket.sh process --pr <number> --check-script <path> --deploy true|false

Options:
  --pr <number>            Pull request number to merge and verify
  --check-script <path>    Script to run after merge
  --deploy true|false      Pass RUN_PROD_DEPLOY into script (default: false)
EOF
}

usage_run_queue() {
  cat <<'EOF'
Usage: run-batch-ticket.sh run-queue --file <path> [--deploy true|false]

Queue format (one per line):
  <pr-number> <check-script-path> [deploy-flag]
  # comment
EOF
}

usage_finish() {
  cat <<'EOF'
Usage: run-batch-ticket.sh finish [--deploy true|false] [--connect-repo <owner/repo>]

Options:
  --deploy true|false   Run final vercel --prod (default: false)
  --connect-repo        Reconnect Vercel with Git repo owner/name
  --no-connect          Skip Vercel Git reconnect step
EOF
}

usage() {
  cat <<'EOF'
run-batch-ticket.sh: automate quota-safe ticket merge/check/deploy flow

Commands:
  start                   Prepare batch mode (disconnect preview deploys + sync dev)
  process                 Merge one PR and run one check script
  run-queue               Run multiple process entries from a queue file
  finish                  Reconnect/optional final deploy

Use "${SCRIPT_NAME} <command> --help" for command details.
EOF
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    start)
      cmd_start "$@"
      ;;
    process)
      cmd_process "$@"
      ;;
    run-queue)
      cmd_run_queue "$@"
      ;;
    finish)
      cmd_finish "$@"
      ;;
    --help|-h|"")
      usage
      ;;
    *)
      fail "Unknown command: ${cmd}"
      ;;
  esac
}

main "$@"
