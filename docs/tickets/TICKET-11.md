# TICKET #11 — Production readiness SOP hardening

## Goal
Add a one-command SOP guard for production readiness checks that also validates the operational
documentation artifacts are present and aligned.

## Scope
- Add `./scripts/ticket-11-production-readiness-sop-hardening.sh`.
- Validate required readyness workflows on `master`:
  - `production-readiness`
  - `ci` (with fallback to `lint-build-test`)
- Validate `/api/ready` and `/api/health` contracts.
- Verify the SOP docs are discoverable and linked in `README.md`.
- Emit a deterministic evidence markdown block to `/tmp`.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - workflow checks are unavailable or non-successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`status`, `db`, `version`)
  - required Ticket #11 references are missing in docs/README
- Script does not modify API contracts or runtime behavior.

## Execution Command

```bash
TICKET11_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-11-production-readiness-sop-hardening.sh
```
