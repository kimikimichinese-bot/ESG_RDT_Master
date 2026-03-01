# TICKET #24 — Production readiness ops handoff automation hardening

## Goal
Add a deterministic one-command handoff check that validates production readiness runbooks, workflow health, and endpoint contracts with release-context evidence.

## Scope
- Add `./scripts/ticket-24-production-readiness-ops-handoff.sh`.
- Verify required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback)
- Verify `/api/ready` and `/api/health` contracts and health version.
- Validate README continuity around latest tickets and script visibility.
- Emit deterministic evidence report to `/tmp`.

## Acceptance Criteria
- Script exits non-zero if any required workflow in requested depth fails.
- Script exits non-zero if `/api/ready` returns anything other than `status=ready` and `checks.web=ok`.
- Script exits non-zero if `/api/health` returns anything other than `status=ok` and `db=ok` or version mismatch.
- Script exits non-zero if Ticket #24/README continuity checks fail.
- On success, script writes an evidence report file and logs PASS lines.

## Execution
```bash
TICKET24_RELEASE_TAG="v1.0.6" \
TICKET24_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET24_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-24-production-readiness-ops-handoff.sh
```
