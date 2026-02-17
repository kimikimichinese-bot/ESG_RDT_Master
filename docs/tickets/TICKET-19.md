# TICKET #19 — Production readiness docs continuity

## Goal
Add a deterministic check that validates README continuity for production-readiness
ticket documentation and guarantees the runbook chain remains coherent.

## Scope
- Add `./scripts/ticket-19-readme-continuity.sh`.
- Validate required workflow status on `master`:
  - `production-readiness`
  - `ci` (with `lint-build-test` fallback)
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity and ticket mapping in `README.md`:
  - Ticket #18 exists
  - Ticket #19 exists
  - Ticket #19 appears after Ticket #18
  - One-command full production check block is present
  - Production freeze policy (strict PR-only) section exists
- Emit compact audit evidence in `/tmp`.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable or not authenticated
  - required workflow runs are missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - README continuity references are missing or malformed
  - ticket continuity checks fail
- Script does not alter application runtime/API contract.

## Execution Command

```bash
TICKET19_RELEASE_TAG="v1.0.6" \
TICKET19_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-19-readme-continuity.sh
```

