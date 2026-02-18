### Ticket #183 production readiness evidence continuity wrapup

## Goal
Add one-command evidence wrap-up check focused on deterministic continuity validation from Ticket #182 to Ticket #183.

## Scope
- Add `./scripts/ticket-183-production-readiness-evidence-continuity-wrapup.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #182 to Ticket #183.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET183_RELEASE_TAG="v1.0.6" \
TICKET183_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET183_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-183-production-readiness-evidence-continuity-wrapup.sh
```
