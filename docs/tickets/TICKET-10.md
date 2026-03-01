# TICKET #10 — Production readiness docs hardening

## Goal
Strengthen production-readiness operability documentation so operators have a deterministic,
one-command route to validate docs + scripts + runtime checks before and after release handoffs.

## Scope
- Add `./scripts/ticket-10-readiness-docs-hardening.sh`.
- Verify:
  - latest `production-readiness` workflow status
  - latest `lint-build-test` / `ci` workflow status (with fallback)
  - `/api/ready` and `/api/health` contract checks
  - that Ticket #10 docs exist and are discoverable
  - that `README.md` contains the canonical Ticket #10 one-command reference
- Generate a small auditable evidence block to `/tmp` for cut/paste.

## Acceptance Criteria
- Script exits non-zero if any required command is missing (`gh`, `curl`, `git`, `jq`).
- Script exits non-zero if required checks fail:
  - workflow not found/unsuccessful
  - `/api/ready` payload mismatch
  - `/api/health` payload mismatch (including `db: ok`)
  - missing Ticket #10 docs/README references
- No contract/runtime changes; this is verification + documentation hardening only.

## Execution Command

```bash
TICKET10_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-10-readiness-docs-hardening.sh
```

