# TICKET #20 — Production readiness log depth and continuity evidence

## Goal
Add a deterministic check that verifies production readiness run-history depth
and README continuity before considering a merge complete.

## Scope
- Add `./scripts/ticket-20-log-depth-checks.sh`.
- Validate required workflow status on `master`:
  - `production-readiness`
  - `ci` (with `lint-build-test` fallback)
- Validate that both required workflows have recent successful history
  for the configured `TICKET20_LOG_DEPTH` window.
- Validate `/api/ready` and `/api/health` contracts.
- Validate README continuity for Ticket #20.
- Emit compact evidence in `/tmp` for audit insertion.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable or not authenticated
  - required workflow runs are missing or not successful
  - required recent run depth is below threshold
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - README continuity references are missing
- Script does not alter application runtime/API contract.

## Execution Command

```bash
TICKET20_RELEASE_TAG="v1.0.6" \
TICKET20_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET20_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-20-log-depth-checks.sh
```

