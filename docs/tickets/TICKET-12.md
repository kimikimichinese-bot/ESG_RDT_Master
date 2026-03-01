# TICKET #12 — Production readiness evidence hardening

## Goal
Add an auditable, deterministic one-command evidence check focused on production readiness evidence
artifacts (workflow state + endpoint contracts + release/docs linkage) to support stable handoffs.

## Scope
- Add `./scripts/ticket-12-readiness-evidence-hardening.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` with fallback to `lint-build-test`
- Validate `/api/ready` and `/api/health` contracts.
- Verify that Ticket #12 docs and the README command reference exist.
- Emit a compact evidence block to `/tmp` for copy/paste.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - required workflow run is missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` + expected version)
  - docs/readme references for Ticket #12 are missing
- Script does not alter API contracts or runtime behavior.

## Execution Command

```bash
TICKET12_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-12-readiness-evidence-hardening.sh
```

