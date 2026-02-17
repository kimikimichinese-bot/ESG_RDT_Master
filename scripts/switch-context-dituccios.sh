#!/usr/bin/env bash

set -euo pipefail

echo "Switching execution context for dituccios-scoped project"
echo

echo "1) GitHub"
gh auth logout -h github.com
gh auth login -h github.com --git-protocol https

echo
echo "2) Vercel"
vercel logout
vercel login --github --oob

echo
echo "3) Verifying isolated context"
./scripts/context-check-dituccios.sh

echo
echo "Done. Context is now locked for this project."
