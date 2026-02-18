#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly HELPER="${ROOT_DIR}/scripts/run-batch-ticket.sh"
readonly SCRIPT_DIR="${ROOT_DIR}/scripts"

usage() {
  cat <<'EOF_USAGE'
Usage: run-ticket-wave.sh --from <n> --to <m> [options]

Run a contiguous ticket wave in quota-safe mode.

Required:
  --from N                     Start ticket number
  --to N                       End ticket number (inclusive)

Options:
  --check-script-template TPL  printf-style template for script path.
                               Relative to scripts/ or absolute.
                               Default: ticket-%d-production-readiness-evidence-continuity-wrapup.sh
  --repo OWNER/REPO            Vercel git reconnect target (default: kimikimichinese-bot/ESG_RDT_Master)
  --deploy-final true|false     Run vercel --prod at wave end (default: false)
  --create-missing-prs true|false Auto-open PR if branch exists and no PR is found (default: false)
  --disconnect-preview true|false Disconnect Vercel git integration before start (default: true)
  --skip-start                 Skip start phase (assumes caller already ran `run-batch-ticket.sh start`)
  --skip-finish                Skip finish phase (no reconnect/deploy)
  --default-deploy-flag true|false
                               Value passed to RUN_PROD_DEPLOY for each check (default: false)
  --help,-h

Behavior:
  - Resolves each ticket check script from --check-script-template.
  - Resolves PR by ticket number (title "Ticket #N" or branch "feature/ticket-N-").
  - If no PR and --create-missing-prs=true, creates PR from the first matching branch.
  - Merges PR and runs the mapped check script.
EOF_USAGE
}

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1"
}

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
}

normalise_bool() {
  local value="$1"
  case "$value" in
    true|false) printf '%s\n' "$value" ;;
    *) fail "Expected true|false, got: ${value}" ;;
  esac
}

normalise_ticket() {
  local value="$1"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    fail "Ticket must be numeric: ${value}"
  fi
  printf '%s\n' "$value"
}

resolve_script() {
  local ticket="$1"
  local template="$2"
  local path=""

  if [[ "$template" == *"%d"* ]]; then
    path="${template//%d/$ticket}"
  else
    path="${template}"
  fi

  if [[ "$path" == /* ]]; then
    if [[ -f "$path" ]]; then
      printf '%s\n' "$path"
      return
    fi
  else
    if [[ -f "${SCRIPT_DIR}/${path}" ]]; then
      printf '%s\n' "${SCRIPT_DIR}/${path}"
      return
    fi
    if [[ -f "${ROOT_DIR}/${path}" ]]; then
      printf '%s\n' "${ROOT_DIR}/${path}"
      return
    fi
  fi

  fail "Script not found for ticket ${ticket} using template '${template}'"
}

resolve_pr() {
  local ticket="$1"
  local json
  local ticket_pattern="Ticket #${ticket}"
  local branch_prefix="feature/ticket-${ticket}-"

  json="$(gh pr list --state all --json number,title,headRefName,state --limit 300)"
  local by_title pr

  by_title="$(jq -r --arg t "$ticket_pattern" '.[] | select(.title | contains($t)) | .number' <<<"$json" | head -n 1 || true)"
  if [[ -n "$by_title" && "$by_title" != "null" ]]; then
    printf '%s\n' "$by_title"
    return
  fi

  pr="$(jq -r --arg p "$branch_prefix" '.[] | select(.headRefName | startswith($p)) | .number' <<<"$json" | head -n 1 || true)"
  if [[ -n "$pr" && "$pr" != "null" ]]; then
    printf '%s\n' "$pr"
    return
  fi

  printf ''
}

resolve_branch() {
  local ticket="$1"
  local branch_prefix="feature/ticket-${ticket}-"

  git ls-remote --heads origin "${branch_prefix}*" \
    | awk '{print $2}' \
    | sed 's#refs/heads/##g' \
    | sort \
    | head -n 1 \
    | sed -e 's/[[:space:]]*$//'
}

pr_title_from_script() {
  local ticket="$1"
  local script="$2"
  local base
  base="${script##*/}"
  base="${base%.sh}"
  local slug
  slug="${base#ticket-${ticket}-}"
  slug="${slug//_/ }"
  slug="${slug//-/ }"
  printf 'chore: add Ticket #%s %s' "$ticket" "$slug"
}

create_pr_for_ticket() {
  local ticket="$1"
  local branch="$2"
  local script="$3"
  local title body

  title="$(pr_title_from_script "$ticket" "$script")"
  body="Auto-generated PR for Ticket #${ticket} by run-ticket-wave.sh."
  log "Creating PR for ${branch}"
  gh pr create --base master --head "$branch" --title "$title" --body "$body"
}

run_ticket() {
  local ticket="$1"
  local template="$2"
  local deploy_flag="$3"
  local create_missing_prs="$4"

  local script pr branch

  script="$(resolve_script "$ticket" "$template")"
  log "Ticket #${ticket}: script $(basename "$script")"

  pr="$(resolve_pr "$ticket")"

  if [[ -z "$pr" ]]; then
    if [[ "$create_missing_prs" == "true" ]]; then
      branch="$(resolve_branch "$ticket")"
      if [[ -z "$branch" ]]; then
        fail "No PR and no branch found for ticket ${ticket}"
      fi
      create_pr_for_ticket "$ticket" "$branch" "$script"
      pr="$(gh pr list --head "$branch" --state open --json number -q '.[0].number' || true)"
      if [[ -z "$pr" || "$pr" == "null" ]]; then
        fail "Could not resolve PR after auto-create for ticket ${ticket}"
      fi
      log "Created PR #${pr} for ticket ${ticket}"
    else
      fail "No PR found for ticket ${ticket}"
    fi
  fi

  log "Running merge + check for PR #${pr}"
  "$HELPER" process --pr "$pr" --check-script "$script" --deploy "$deploy_flag"
  pass "Ticket #${ticket} completed"
}

main() {
  local from=""
  local to=""
  local check_script_template="ticket-%d-production-readiness-evidence-continuity-wrapup.sh"
  local repo="kimikimichinese-bot/ESG_RDT_Master"
  local deploy_final="false"
  local default_deploy="false"
  local create_missing_prs="false"
  local disconnect_preview="true"
  local skip_start="false"
  local skip_finish="false"

  while (($#)); do
    case "$1" in
      --from)
        from="$(normalise_ticket "${2:-}")"
        shift 2
        ;;
      --to)
        to="$(normalise_ticket "${2:-}")"
        shift 2
        ;;
      --check-script-template)
        check_script_template="${2:-}"
        shift 2
        ;;
      --repo)
        repo="${2:-}"
        shift 2
        ;;
      --deploy-final)
        deploy_final="$(normalise_bool "${2:-}")"
        shift 2
        ;;
      --default-deploy-flag)
        default_deploy="$(normalise_bool "${2:-}")"
        shift 2
        ;;
      --create-missing-prs)
        create_missing_prs="$(normalise_bool "${2:-}")"
        shift 2
        ;;
      --disconnect-preview)
        disconnect_preview="$(normalise_bool "${2:-}")"
        shift 2
        ;;
      --skip-start)
        skip_start="true"
        shift
        ;;
      --skip-finish)
        skip_finish="true"
        shift
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

  [[ -n "$from" ]] || fail "--from is required"
  [[ -n "$to" ]] || fail "--to is required"
  [[ "$from" -le "$to" ]] || fail "--from must be <= --to"

  require_cmd gh
  require_cmd git
  require_cmd jq

  if [[ "$skip_start" == "false" ]]; then
    "$HELPER" start --disconnect-preview "$disconnect_preview"
  fi

  local n
  for ((n=from; n<=to; n++)); do
    run_ticket "$n" "$check_script_template" "$default_deploy" "$create_missing_prs"
  done

  if [[ "$skip_finish" == "false" ]]; then
    "$HELPER" finish --deploy "$deploy_final" --connect-repo "$repo"
  fi

  pass "Wave from #${from} to #${to} finished"
}

main "$@"

