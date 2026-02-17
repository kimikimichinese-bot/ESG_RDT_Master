# TICKET #3 — Production readiness command hardening

## Goal
Add a deterministic one-command production readiness verification flow for `feature`/`master` synchronization checks before merge freeze and after merge on `master`.

## Scope
- Add `/scripts/ticket-3-full-check.sh` to run:
  - repository/account context isolation check
  - GitHub environment + database readiness workflow
  - Vercel production deploy (same alias target)
  - `/api/ready` + `/api/health` endpoint validation
  - optional release-contract check (`version` field in health payload)
- Keep behavior explicit and reproducible for PR/merge freeze process.

## Acceptance Criteria
- Command exits non-zero on any failed gate.
- `/api/ready` returns success marker (`status=ready`, `checks.web=ok`).
- `/api/health` returns success marker (`status=ok`, `db=ok`).
- Health payload contains expected commit/version when `TICKET3_EXPECTED_COMMIT` is set.
- Script works as a single operator command and documents the required check order in `README.md`.

## Execution Command
Run from `master`:

```bash
RUN_MIGRATIONS=false TICKET3_EXPECTED_COMMIT="$(git rev-parse --short v1.0.3)" ./scripts/ticket-3-full-check.sh
```

