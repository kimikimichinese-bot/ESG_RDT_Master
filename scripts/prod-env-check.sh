#!/usr/bin/env bash

set -euo pipefail

is_empty_value() {
  [[ -z "$1" ]] || [[ "$1" == "__REQUIRED__" ]] || [[ "$1" == "__REQUIRED_IF_BLOB_USED__" ]]
}

required_vars=(
  DATABASE_URL
  DATABASE_URL_UNPOOLED
  AUTH_SECRET
  NEXT_PUBLIC_WEB_URL
  NEXT_PUBLIC_API_URL
)

missing=0
for var_name in "${required_vars[@]}"; do
  var_value="${!var_name:-}"
  if is_empty_value "${var_value}"; then
    echo "[FAIL] Missing: ${var_name}"
    missing=1
  else
    echo "[PASS] ${var_name} is set"
  fi
done

if [[ "${DATABASE_URL:-}" == *"__REQUIRED__"* ]]; then
  echo "[FAIL] DATABASE_URL contains placeholder"
  missing=1
fi

if [[ "${DATABASE_URL_UNPOOLED:-}" == *"__REQUIRED__"* ]]; then
  echo "[FAIL] DATABASE_URL_UNPOOLED contains placeholder"
  missing=1
fi

if [[ "${DATABASE_URL:-}" == postgresql://* ]] || [[ "${DATABASE_URL:-}" == postgres://* ]]; then
  echo "[PASS] DATABASE_URL protocol valid"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[FAIL] DATABASE_URL must start with postgresql:// or postgres://"
  missing=1
fi

if [[ "${DATABASE_URL_UNPOOLED:-}" == postgresql://* ]] || [[ "${DATABASE_URL_UNPOOLED:-}" == postgres://* ]]; then
  echo "[PASS] DATABASE_URL_UNPOOLED protocol valid"
elif [[ -n "${DATABASE_URL_UNPOOLED:-}" ]]; then
  echo "[FAIL] DATABASE_URL_UNPOOLED must start with postgresql:// or postgres://"
  missing=1
fi

if (( missing != 0 )); then
  echo "\nCreate .env.local (or production environment vars) with all required values."
  exit 1
fi

echo "\n[PASS] Production environment appears configured."
