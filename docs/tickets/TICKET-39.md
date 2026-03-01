### Ticket #39 production readiness evidence drift continuity

## Goal
Add a deterministic one-command evidence drift continuity check to validate production-readiness continuity from Ticket #38 to Ticket #39.

## Scope
- Add `./scripts/ticket-39-production-readiness-evidence-drift-continuity.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #38 to Ticket #39.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET39_RELEASE_TAG="v1.0.6" \
TICKET39_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET39_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-39-production-readiness-evidence-drift-continuity.sh
```
