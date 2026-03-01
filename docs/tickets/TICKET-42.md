### Ticket #42 production readiness README lineage validation

## Goal
Add a deterministic one-command lineage validation to ensure production-readiness evidence continuity from Ticket #41 to Ticket #42 remains correctly documented in README.

## Scope
- Add `./scripts/ticket-42-production-readiness-readme-lineage.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #41 to Ticket #42.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET42_RELEASE_TAG="v1.0.6" \
TICKET42_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET42_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-42-production-readiness-readme-lineage.sh
```
