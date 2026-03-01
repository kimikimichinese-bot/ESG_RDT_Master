### Ticket #50 production readiness continuity finalization

## Goal
Add one-command readiness continuity finalization check focused on final sequencing and documentation continuity between Ticket #49 and Ticket #50.

## Scope
- Add `./scripts/ticket-50-production-readiness-continuity-finalization.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #49 to Ticket #50.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET50_RELEASE_TAG="v1.0.6" \
TICKET50_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET50_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-50-production-readiness-continuity-finalization.sh
```
