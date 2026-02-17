# TICKET #8 — Production drift detection (ops handoff)

## Goal
Provide a lightweight one-command check for visible production drift before/after handoff.

## Scope
- Add `./scripts/ticket-8-production-drift.sh`.
- Validate the latest production readiness workflow status.
- Validate `/api/ready` and `/api/health` contract.
- Verify working tree cleanliness on the checked-out branch used for handoff.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - `production-readiness` workflow on `master` is not successful
  - `/api/ready` contract is invalid
  - `/api/health` contract/version mismatch
  - local branch is not tracking an upstream (informational)
- Script prints evidence block for copy/paste in handoff notes.

## Execution Command

```bash
TICKET8_EXPECTED_COMMIT="v1.0.5^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-8-production-drift.sh
```
