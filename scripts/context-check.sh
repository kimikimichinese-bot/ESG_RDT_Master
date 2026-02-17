#!/usr/bin/env bash

set -euo pipefail

readonly EXPECTED_GITHUB_ACCOUNT="kimikimichinese-bot"
readonly EXPECTED_GITHUB_REMOTE="https://github.com/${EXPECTED_GITHUB_ACCOUNT}/ESG_RDT_Master.git"
readonly EXPECTED_GITHUB_BRANCH="master"
readonly EXPECTED_VERCEL_ACCOUNT="kimikimichinese-bot"

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

if [[ $(git remote get-url origin) != "$EXPECTED_GITHUB_REMOTE" ]]; then
  fail "GitHub remote mismatch
Expected: $EXPECTED_GITHUB_REMOTE
Found:    $(git remote get-url origin)"
fi

current_branch="$(git symbolic-ref --short HEAD)"
if [[ "$current_branch" != "$EXPECTED_GITHUB_BRANCH" ]]; then
  fail "Branch mismatch
Expected: $EXPECTED_GITHUB_BRANCH
Found:    $current_branch"
fi

gh_account=$(gh api user --hostname github.com -q .login 2>/dev/null || true)
if [[ -z "$gh_account" ]]; then
  gh_account=$(gh auth status --hostname github.com --show-token=false 2>&1 | awk '/account/{for (i=1; i<=NF; i++) if ($i=="account") {print $(i+1); exit}}' | tr -d '\r' | head -n 1)
fi
if [[ "$gh_account" != "$EXPECTED_GITHUB_ACCOUNT" ]]; then
  fail "GitHub account mismatch
Expected: $EXPECTED_GITHUB_ACCOUNT
Found:    ${gh_account:-<not logged in>}
Fix: gh auth logout -h github.com && gh auth login -h github.com"
fi

vercel_whoami="$(vercel whoami 2>/dev/null || true)"
if [[ -z "$vercel_whoami" ]]; then
  fail "Vercel auth required
Fix: vercel login --github --oob"
fi

vercel_account="$(printf '%s\n' "$vercel_whoami" | awk '/^[A-Za-z0-9-]+$/ {acct=$0} END{print acct}')"
if [[ "$vercel_account" != "$EXPECTED_VERCEL_ACCOUNT" ]]; then
  fail "Vercel account mismatch
Expected: $EXPECTED_VERCEL_ACCOUNT
Found:    ${vercel_account:-<not logged in>}
Fix: vercel logout; vercel login --github --oob"
fi

pass "Context is isolated to $EXPECTED_GITHUB_ACCOUNT for GitHub and Vercel."
