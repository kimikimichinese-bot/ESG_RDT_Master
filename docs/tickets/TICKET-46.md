### Ticket #46 production readiness README lineage hardening check v2

## Goal
Add one more deterministic one-command readiness continuity check focused on README lineage hygiene between Ticket #45 and Ticket #46.

## Scope
- Add `./scripts/ticket-46-production-readiness-readme-lineage-check-v2.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Verify `/api/ready` and `/api/health` contracts.
- Verify README continuity from Ticket #45 to Ticket #46.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script fails if workflow depth checks are below expected window or include non-success states.
- Script fails if `/api/ready` or `/api/health` checks fail.
- Script fails if `/api/health` `version` does not match the expected commit.
- Script fails if Ticket docs continuity in `README.md` is inconsistent.

## Execution
```bash
TICKET46_RELEASE_TAG="v1.0.6" \
TICKET46_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET46_LOG_DEPTH=4 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-46-production-readiness-readme-lineage-check-v2.sh
```
