### Ticket #33 production readiness evidence lifecycle hardening

## Goal
Add a deterministic one-command evidence lifecycle check to validate production-readiness continuity and hardening posture.

## Scope
- Add `./scripts/ticket-33-production-readiness-evidence-lifecycle.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #32 to Ticket #33.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if Ticket docs/README continuity is inconsistent.
- On success prints PASS lines and writes evidence file.

## Execution
```bash
TICKET33_RELEASE_TAG="v1.0.6" \
TICKET33_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET33_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-33-production-readiness-evidence-lifecycle.sh
```
