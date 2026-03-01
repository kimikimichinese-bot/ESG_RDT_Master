### Ticket #25 — Production readiness evidence continuity hardening

## Goal
Strengthen continuity checks across Ticket #24 and add an evidence hardening wrapper for deterministic readiness proof.

## Scope
- Add `./scripts/ticket-25-production-readiness-evidence-continuity.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` with expected commit from release tag.
- Validate README continuity after Ticket #24 and script presence.
- Write deterministic evidence output in `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth or any contract check fails.
- Script exits non-zero if continuity anchors in README are inconsistent.
- On pass, script writes an evidence file and logs PASS lines.

## Execution
```bash
TICKET25_RELEASE_TAG="v1.0.6" \
TICKET25_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET25_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-25-production-readiness-evidence-continuity.sh
```
