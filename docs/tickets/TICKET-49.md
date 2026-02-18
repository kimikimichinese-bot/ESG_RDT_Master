### Ticket #49 production readiness log-depth continuity hardening check

## Goal
Add one-command readiness continuity check focused on log-depth continuity between Ticket #48 and Ticket #49.

## Scope
- Add `./scripts/ticket-49-production-readiness-log-depth-continuity-check.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #48 to Ticket #49.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET49_RELEASE_TAG="v1.0.6" \
TICKET49_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET49_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-49-production-readiness-log-depth-continuity-check.sh
```
