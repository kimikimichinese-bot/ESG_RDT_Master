### Ticket #28 production readiness SOP check hardening

## Goal
Add a deterministic one-command check for production readiness documentation and SOP continuity after Ticket #27.

## Scope
- Add `./scripts/ticket-28-production-readiness-sop-check.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts with expected commit.
- Validate README continuity from Ticket #27 to Ticket #28.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if required workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if Ticket #28 docs/README continuity checks fail.
- On success, command prints PASS lines and writes an evidence file.

## Execution
```bash
TICKET28_RELEASE_TAG="v1.0.6" \
TICKET28_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET28_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-28-production-readiness-sop-check.sh
```
