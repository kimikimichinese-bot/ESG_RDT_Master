#!/usr/bin/env bash

set -euo pipefail

required_vars=(
  DATABASE_URL
  DATABASE_URL_UNPOOLED
  AUTH_SECRET
  NEXT_PUBLIC_WEB_URL
  NEXT_PUBLIC_API_URL
)

missing=0
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "[FAIL] Missing: ${var_name}"
    missing=1
  else
    echo "[PASS] ${var_name} is set"
  fi
done

if (( missing != 0 )); then
  echo "\nCreate .env.local (or production environment vars) with all required values."
  exit 1
fi

echo "\n[PASS] Production environment appears configured."
