# TICKET #13 — Production release audit hardening

## Goal
Build a deterministic, auditable command for release evidence verification that validates
production workflow health, endpoint contracts, and the expected release tag mapping before
handover.

## Scope
- Add `./scripts/ticket-13-release-audit-hardening.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` with fallback to `lint-build-test`
- Validate `/api/ready` and `/api/health` contract checks.
- Validate that the ticket docs and README invocation are present.
- Validate release reference mapping (`TICKET13_RELEASE_TAG` -> commit used for expected checks).
- Emit a structured evidence block in `/tmp`.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - required workflow runs are missing or not successful
  - `/api/ready` payload mismatch
  - `/api/health` payload mismatch (including `db: ok`)
  - expected release tag cannot be resolved
  - docs/README ticket references are missing
- Script does not change application contracts or runtime behavior.

## Execution Command

```bash
TICKET13_RELEASE_TAG="v1.0.6" \
TICKET13_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-13-release-audit-hardening.sh
```
