# TICKET #18 — Production readiness README audit

## Goal
Add a deterministic proof command that verifies the production readiness
documentation trail in `README.md` stays coherent with release evidence requirements.

## Scope
- Add `./scripts/ticket-18-readme-audit.sh`.
- Validate required workflow status on `master`:
  - `production-readiness`
  - `ci` (with `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts.
- Validate `README.md` contains the expected production control entries:
  - Ticket #18 section
  - one-command full production check
  - Production freeze policy (strict PR-only)
- Emit compact evidence in `/tmp` for audit insertion.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable or not authenticated
  - required workflow runs are missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - mandatory README/docs references are missing
- Script does not alter application runtime/API contract.

## Execution Command

```bash
TICKET18_RELEASE_TAG="v1.0.6" \
TICKET18_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-18-readme-audit.sh
```

