### Ticket #53 production readiness evidence wrap check

## Goal
Add one-command evidence wrap check focused on finalizing production readiness evidence continuity from Ticket #52 to Ticket #53.

## Scope
- Add `./scripts/ticket-53-production-readiness-evidence-wrap-check.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #52 to Ticket #53.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET53_RELEASE_TAG="v1.0.6" \
TICKET53_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET53_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-53-production-readiness-evidence-wrap-check.sh
```
