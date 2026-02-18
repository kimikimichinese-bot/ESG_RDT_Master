### Ticket #32 production readiness evidence lockdown hardening

## Goal
Add a deterministic one-command evidence lockdown check for production-readiness operations and continuity after Ticket #31.

## Scope
- Add `./scripts/ticket-32-production-readiness-evidence-lockdown.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #31 to Ticket #32.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` checks fail.
- Script exits non-zero if Ticket docs/README continuity is inconsistent.
- On success prints PASS lines and writes evidence file.

## Execution
```bash
TICKET32_RELEASE_TAG="v1.0.6" \
TICKET32_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET32_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-32-production-readiness-evidence-lockdown.sh
```
