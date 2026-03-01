### Ticket #26 — Production readiness ops drift detection hardening

## Goal
Add a deterministic one-command check to detect operational drift between required production-readiness artifacts after each release.

## Scope
- Add `./scripts/ticket-26-production-readiness-ops-drift-check.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts with expected commit.
- Validate README continuity from Ticket #25 and presence of Ticket #26 block.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script exits non-zero if required workflow depth check fails.
- Script exits non-zero if `/api/ready` and `/api/health` validations fail.
- Script exits non-zero if Ticket #26 docs/README continuity checks fail.
- On success script outputs deterministic PASS lines and writes evidence file.

## Execution
```bash
TICKET26_RELEASE_TAG="v1.0.6" \
TICKET26_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET26_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-26-production-readiness-ops-drift-check.sh
```
