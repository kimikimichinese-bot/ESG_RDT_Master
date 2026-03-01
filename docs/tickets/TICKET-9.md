# TICKET #9 — Production readiness automation command

## Goal
Add a single deterministic command for pre-merge and post-merge production readyness automation.

## Scope
- Add `./scripts/ticket-9-production-readiness-automation.sh`.
- Validate latest run status for:
  - `production-readiness`
  - `lint-build-test`
- Validate `/api/ready` and `/api/health` contracts.
- Check branch state and working tree health for evidence.

## Acceptance Criteria
- Script exits non-zero if:
  - required commands are missing (`gh`, `curl`, `git`, `jq`)
  - any required workflow run is not successful
  - `/api/ready` contract mismatch
  - `/api/health` version mismatch for expected commit
- Script prints an auditable evidence block and writes `/tmp/ticket-9-readiness-automation.md` by default.

## Execution Command

```bash
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-9-production-readiness-automation.sh
```

To validate a newer rollout commit, set `TICKET9_EXPECTED_COMMIT` explicitly.
Default expected commit is set to `v1.0.6^{}` for stable production evidence snapshots.
