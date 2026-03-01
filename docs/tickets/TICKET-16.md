# TICKET #16 — Production release log evidence formatting

## Goal
Add a deterministic formatter/check that emits a compact, audit-ready release log
signature block while validating production readiness gating and endpoint contracts.

## Scope
- Add `./scripts/ticket-16-release-log-evidence-format.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` with fallback to `lint-build-test`
- Validate `/api/ready` and `/api/health` contracts.
- Validate mandatory documentation mapping for Ticket #16.
- Resolve release tag and expected commit mapping.
- Emit a compact evidence block into `/tmp` for release note insertion.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable / auth missing
  - required workflow runs are missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - mandatory ticket refs are missing in README/docs
  - release tag cannot be resolved
- Script does not alter API contracts or runtime behavior.

## Execution Command

```bash
TICKET16_RELEASE_TAG="v1.0.6" \
TICKET16_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-16-release-log-evidence-format.sh
```
