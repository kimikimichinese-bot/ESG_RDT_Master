### Ticket #528 production readiness evidence continuity wrapup

## Goal
Add one-command evidence wrap-up check focused on deterministic continuity validation from Ticket #199 to Ticket #528.

## Scope
- Add `./scripts/ticket-528-production-readiness-evidence-continuity-wrapup.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #199 to Ticket #528.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET528_RELEASE_TAG="v1.0.6" \
TICKET528_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET528_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-528-production-readiness-evidence-continuity-wrapup.sh
```
