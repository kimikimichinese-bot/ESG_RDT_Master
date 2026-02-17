# TICKET #15 — Production readiness mandatory docs hardening

## Goal
Add a deterministic one-command check that verifies the minimum production readiness
documentation set is present and aligned with the current release evidence flow, without
changing application runtime behavior.

## Scope
- Add `./scripts/ticket-15-production-readiness-mandatory-docs.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` with fallback to `lint-build-test`
- Validate `/api/ready` and `/api/health` contracts.
- Validate mandatory production-readiness documentation references are present:
  - `README.md` includes the Ticket #15 section
  - `README.md` includes the Production freeze policy note
  - `docs/tickets/TICKET-15.md` exists and describes the scope
- Validate release tag to expected commit mapping used for version comparison.
- Emit an evidence file in `/tmp` in ticket-standard format.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable / auth missing
  - required workflow runs are missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - mandatory docs references are missing
  - release tag cannot be resolved
- Script does not alter API contracts or runtime behavior.

## Execution Command

```bash
TICKET15_RELEASE_TAG="v1.0.6" \
TICKET15_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-15-production-readiness-mandatory-docs.sh
```
