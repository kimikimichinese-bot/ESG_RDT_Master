# TICKET #22 — Production readiness docs hygiene hardening

## Goal
Add a deterministic check that enforces documentation and execution-hygiene continuity for production-readiness
runbooks after each merge.

## Scope
- Add `./scripts/ticket-22-production-readiness-docs-hygiene.sh`.
- Keep the same required operational checks as previous tickets:
  - `production-readiness` workflow status (recent run history)
  - `ci` workflow status (or `lint-build-test` fallback)
  - `/api/ready` contract validation
  - `/api/health` contract validation and version pin
- Validate continuity/hygiene in project docs:
  - `docs/tickets/TICKET-22.md` exists and is in scope
  - `README.md` contains Ticket #22 section and command
  - Ticket #22 section is after Ticket #21 in `README.md`
  - `/README` still contains required one-command full production check anchor

## Acceptance Criteria
- Script exits non-zero if:
  - required commands are missing (`gh`, `curl`, `git`, `jq`)
  - GitHub API is unavailable
  - workflow history for requested depth is missing or contains failures
  - `/api/ready` contract mismatch (`status != ready` or `checks.web != ok`)
  - `/api/health` contract mismatch (`status != ok`, `db != ok`, version mismatch/empty)
  - Ticket #22 docs/README references are missing or out of order
- On pass, script writes `/tmp/ticket-22-production-readiness-docs-hygiene.md`
  with a compact evidence fingerprint.

## Execution Command

```bash
TICKET22_RELEASE_TAG="v1.0.6" \
TICKET22_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET22_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-22-production-readiness-docs-hygiene.sh
```
