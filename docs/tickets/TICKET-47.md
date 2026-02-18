### Ticket #47 production readiness log-depth continuity hardening check

## Goal
Add one-command readiness continuity check focused on log-depth continuity between Ticket #46 and Ticket #47.

## Scope
- Add `./scripts/ticket-47-production-readiness-log-depth-continuity-check.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #46 to Ticket #47.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET47_RELEASE_TAG="v1.0.6" \
TICKET47_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET47_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-47-production-readiness-log-depth-continuity-check.sh
```
