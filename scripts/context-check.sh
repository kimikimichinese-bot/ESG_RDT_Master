#!/usr/bin/env bash

set -euo pipefail

readonly EXPECTED_GITHUB_ACCOUNT="kimikimichinese-bot"
readonly EXPECTED_GITHUB_REMOTE="https://github.com/${EXPECTED_GITHUB_ACCOUNT}/ESG_RDT_Master.git"
readonly EXPECTED_GITHUB_BRANCH="master"
readonly EXPECTED_VERCEL_ACCOUNT="kimikimichinese-bot"

if [[ $(git remote get-url origin) != "$EXPECTED_GITHUB_REMOTE" ]]; then
  echo "[FAIL] GitHub remote mismatch"
  echo "Expected: $EXPECTED_GITHUB_REMOTE"
  echo "Found:    $(git remote get-url origin)"
  exit 1
fi

current_branch="$(git symbolic-ref --short HEAD)"
if [[ "$current_branch" != "$EXPECTED_GITHUB_BRANCH" ]]; then
  echo "[FAIL] Branch mismatch"
  echo "Expected: $EXPECTED_GITHUB_BRANCH"
  echo "Found:    $current_branch"
  exit 1
fi

gh_account=$(gh api user --hostname github.com -q .login 2>/dev/null || true)
if [[ -z "$gh_account" ]]; then
  gh_account=$(gh auth status --hostname github.com --show-token=false 2>&1 | awk '/account/{for (i=1; i<=NF; i++) if ($i=="account") {print $(i+1); exit}}' | tr -d '\r' | head -n 1)
fi
if [[ "$gh_account" != "$EXPECTED_GITHUB_ACCOUNT" ]]; then
  echo "[FAIL] GitHub account mismatch"
  echo "Expected: $EXPECTED_GITHUB_ACCOUNT"
  echo "Found:    ${gh_account:-<not logged in>}"
  echo "Fix: gh auth logout -h github.com && gh auth login -h github.com"
  exit 1
fi

vercel_account=$(vercel whoami 2>/dev/null || true)
if [[ "$vercel_account" != "$EXPECTED_VERCEL_ACCOUNT" ]]; then
  echo "[FAIL] Vercel account mismatch"
  echo "Expected: $EXPECTED_VERCEL_ACCOUNT"
  echo "Found:    ${vercel_account:-<not logged in>}"
  echo "Fix: vercel logout; vercel login --github --oob"
  exit 1
fi

echo "[PASS] Context is isolated to $EXPECTED_GITHUB_ACCOUNT for GitHub and Vercel."
