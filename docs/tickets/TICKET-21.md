# TICKET #21 — Production readiness hardening and command continuity

## Goal
Add a second-pass production readiness guard for deterministic merge confidence by
reusing ticket #20 checks with explicit continuity targets for Ticket #21 scope.

## Scope
- Add `./scripts/ticket-21-readiness-hardening.sh`.
- Reuse the same required checks used in production readiness gate:
  - `production-readiness`
  - `ci` (with `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts against expected commit.
- Validate README continuity so Ticket #21 is ordered after Ticket #20.
- Emit compact evidence into `/tmp`.

## Acceptance Criteria
- Script exits non-zero if:
  - required tooling is missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable
  - required workflow run history for depth is missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok`, version not expected)
  - Ticket #21 README or docs references are missing/invalid

## Execution Command

```bash
TICKET21_RELEASE_TAG="v1.0.6" \
TICKET21_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET21_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-21-readiness-hardening.sh
```
