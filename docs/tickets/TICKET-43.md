### Ticket #43 production readiness README lineage hardening check

## Goal
Add a deterministic one-command lineage hardening check to validate production-readiness evidence continuity from Ticket #42 to Ticket #43.

## Scope
- Add `./scripts/ticket-43-production-readiness-readme-lineage-check.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #42 to Ticket #43.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET43_RELEASE_TAG="v1.0.6" \
TICKET43_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET43_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-43-production-readiness-readme-lineage-check.sh
```
