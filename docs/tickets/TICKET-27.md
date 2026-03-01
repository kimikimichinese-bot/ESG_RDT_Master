### Ticket #27 production readiness docs hardening

## Goal
Add a deterministic one-command pre-merge check for docs continuity and operational proof after Ticket #26 is merged.

## Scope
- Add `./scripts/ticket-27-production-readiness-docs-hardening.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts with expected commit.
- Validate README continuity from Ticket #26 to Ticket #27.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Command exits non-zero if workflow depth checks fail.
- Command exits non-zero if `/api/ready` or `/api/health` validations fail.
- Command exits non-zero if Ticket #27 docs/README continuity checks fail.
- On success, command prints PASS lines and writes an evidence file.

## Execution
```bash
TICKET27_RELEASE_TAG="v1.0.6" \
TICKET27_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET27_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-27-production-readiness-docs-hardening.sh
```
