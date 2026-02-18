### Ticket #34 production readiness evidence continuity hardening

## Goal
Add a deterministic one-command readiness evidence check that validates continuity from Ticket #33 to Ticket #34 and enforces post-merge production verification.

## Scope
- Add `./scripts/ticket-34-production-readiness-evidence-continuity.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity for Ticket #33 → Ticket #34.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET34_RELEASE_TAG="v1.0.6" \
TICKET34_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET34_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-34-production-readiness-evidence-continuity.sh
```
