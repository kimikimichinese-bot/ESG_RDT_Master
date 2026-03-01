### Ticket #36 production readiness evidence traceability hardening

## Goal
Add a deterministic one-command evidence traceability check that validates production-readiness continuity from Ticket #35 to Ticket #36.

## Scope
- Add `./scripts/ticket-36-production-readiness-evidence-trace-check.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #35 to Ticket #36.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET36_RELEASE_TAG="v1.0.6" \
TICKET36_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET36_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-36-production-readiness-evidence-trace-check.sh
```
