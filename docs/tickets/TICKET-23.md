# TICKET #23 — Production readiness docs continuity hardening

## Goal
Add an additional continuity hardening check that enforces Ticket #23 inclusion in README
and validates that the production-readiness one-command history remains coherent across recent
releases and ticket docs evolution.

## Scope
- Add `./scripts/ticket-23-production-readiness-docs-hygiene-continuity.sh`.
- Validate required workflows on `master`:
  - `production-readiness`
  - `ci` (or `lint-build-test` fallback if needed)
- Validate `/api/ready` and `/api/health` contracts and enforce expected commit from release tag.
- Validate README continuity and Ticket #23 references.
- Require the Ticket #23 command block is present in `README.md`.
- Emit deterministic evidence to `/tmp`.

## Acceptance Criteria
- Script exits non-zero if:
  - required tooling is missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API unavailable
  - required workflow history for requested depth is missing or not successful
  - `/api/ready` mismatch (`status != ready`, `checks.web != ok`)
  - `/api/health` mismatch (`status != ok`, `db != ok`, version mismatch/empty)
  - Ticket #23 docs/README continuity is missing or out of order
- On pass, script writes:
  - `/tmp/ticket-23-production-readiness-docs-hygiene-continuity.md`

## Execution Command

```bash
TICKET23_RELEASE_TAG="v1.0.6" \
TICKET23_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET23_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-23-production-readiness-docs-hygiene-continuity.sh
```
