# TICKET #6 — Production handoff runbook automation

## Goal
Create a deterministic handoff block for operations and future agents to verify production readiness before/after every release handoff.

## Scope
- Add `./scripts/ticket-6-production-handoff.sh` to collect a compact production handoff evidence package.
- Keep checks focused on existing production contract and repository state:
  - latest production-readiness workflow status
  - alias + endpoint contract checks (`/api/ready`, `/api/health`)
  - commit/version consistency with current `origin/master`
  - local branch tracking sanity
- Document one-command invocation in `README.md`.

## Acceptance Criteria
- Script exits non-zero on failed workflow status, contract mismatch, or missing version alignment.
- Script prints a full audit block ready to paste in operations notes.
- No API route contract changes; this is ops/infra documentation + verification only.

## Execution Command

```bash
TICKET6_EXPECTED="$(git rev-parse --short=8 origin/master)" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-6-production-handoff.sh
```
