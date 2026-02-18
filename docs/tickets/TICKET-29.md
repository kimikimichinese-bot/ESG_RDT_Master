### Ticket #29 production readiness ops sanity hardening

## Goal
Add a deterministic one-command pre-merge check for operational sanity and production-readiness continuity after Ticket #28 is merged.

## Scope
- Add `./scripts/ticket-29-production-readiness-ops-sanity.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts with expected commit.
- Validate README continuity from Ticket #28 to Ticket #29.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if required workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if Ticket #29 docs/README continuity checks fail.
- On success, command prints PASS lines and writes an evidence file.

## Execution
```bash
TICKET29_RELEASE_TAG="v1.0.6" \
TICKET29_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET29_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-29-production-readiness-ops-sanity.sh
```
