### Ticket #31 production readiness rollover hardening

## Goal
Add a deterministic one-command continuity check focused on production readiness rollover evidence.

## Scope
- Add `./scripts/ticket-31-production-readiness-rollover-check.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #30 to Ticket #31.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if Ticket docs/README continuity is inconsistent.
- On success prints PASS lines and writes evidence file.

## Execution
```bash
TICKET31_RELEASE_TAG="v1.0.6" \
TICKET31_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET31_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-31-production-readiness-rollover-check.sh
```
