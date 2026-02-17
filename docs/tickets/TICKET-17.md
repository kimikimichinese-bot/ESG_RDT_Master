# TICKET #17 — Production readiness observability log checks

## Goal
Add a one-command readiness check focused on production observability evidence
and required operational checks used in release handoff.

## Scope
- Add `./scripts/ticket-17-readiness-observability-log-checks.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` with fallback to `lint-build-test`
- Validate `/api/ready` and `/api/health` contracts.
- Validate that key production readiness documentation is present in `README.md`:
  - ticket 17 entry exists
  - production freeze policy remains documented
  - one-command full production check exists
- Emit a compact evidence file under `/tmp`.

## Acceptance Criteria
- Script exits non-zero if:
  - required tools are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable / auth missing
  - required workflow runs are missing or not successful
  - `/api/ready` contract mismatch
  - `/api/health` contract mismatch (`db: ok` and expected version)
  - mandatory observability docs refs are missing
  - release tag cannot be resolved
- Script does not alter API contracts or runtime behavior.

## Execution Command

```bash
TICKET17_RELEASE_TAG="v1.0.6" \
TICKET17_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-17-readiness-observability-log-checks.sh
```
