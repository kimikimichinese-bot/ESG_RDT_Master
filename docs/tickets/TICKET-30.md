### Ticket #30 production readiness continuity hardening

## Goal
Add a deterministic one-command pre-merge production-readiness continuity check for Ticket #30 state and documentation chain.

## Scope
- Add `./scripts/ticket-30-production-readiness-continuity-check.sh`.
- Validate required workflow checks on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #29 to Ticket #30.
- Produce deterministic evidence in `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` checks fail.
- Script exits non-zero if Ticket docs/README continuity is inconsistent.
- On success writes evidence file and prints PASS lines.

## Execution
```bash
TICKET30_RELEASE_TAG="v1.0.6" \
TICKET30_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET30_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-30-production-readiness-continuity-check.sh
```
