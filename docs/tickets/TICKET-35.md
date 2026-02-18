### Ticket #35 production readiness docs traceability hardening

## Goal
Add a deterministic one-command readiness traceability check that validates post-merge artifacts and continuity for Ticket #34 -> Ticket #35.

## Scope
- Add `./scripts/ticket-35-production-readiness-docs-traceability.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #34 to Ticket #35.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET35_RELEASE_TAG="v1.0.6" \
TICKET35_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET35_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-35-production-readiness-docs-traceability.sh
```
