### Ticket #37 production readiness evidence chain handoff

## Goal
Add a deterministic one-command evidence chain handoff check to validate production-readiness continuity from Ticket #36 to Ticket #37.

## Scope
- Add `./scripts/ticket-37-production-readiness-evidence-chain-handoff.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback).
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity from Ticket #36 to Ticket #37.
- Emit deterministic evidence under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if workflow depth checks fail.
- Script exits non-zero if `/api/ready` or `/api/health` validations fail.
- Script exits non-zero if health version does not match expected commit.
- Script exits non-zero if Ticket docs continuity is inconsistent.

## Execution
```bash
TICKET37_RELEASE_TAG="v1.0.6" \
TICKET37_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET37_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-37-production-readiness-evidence-chain-handoff.sh
```
