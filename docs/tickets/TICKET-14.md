# TICKET #14 — Production readiness release log compact

## Goal
Add a deterministic, compact release-log helper that validates production readiness checks and
emits a tiny evidence block suitable for handoff notes.

## Scope
- Add `./scripts/ticket-14-production-readiness-release-log-compact.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` with fallback to `lint-build-test`
- Validate `/api/ready` and `/api/health` contracts.
- Validate release tag → commit mapping used for version comparison.
- Emit a compact evidence file in `/tmp` with workflow metadata, endpoint payloads, and release
  references.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable / auth missing
  - required workflow runs are missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - release tag cannot be resolved
- Script does not alter API contracts or runtime behavior.

## Execution Command

```bash
TICKET14_RELEASE_TAG="v1.0.6" \
TICKET14_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-14-production-readiness-release-log-compact.sh
```
