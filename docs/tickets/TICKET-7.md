# TICKET #7 — Audit-ready release evidence bundle

## Goal
Create a deterministic, one-command bundle for post-merge release evidence that is useful for audit logs and handoff notes.

## Scope
- Add `./scripts/ticket-7-release-evidence-pack.sh`.
- Collect and validate the latest:
  - production readiness workflow state (`production-readiness`)
  - `/api/ready` contract
  - `/api/health` contract and observed version
  - source commit context (`origin/master` + chosen release reference)
- Save evidence in a single Markdown file (`/tmp/ticket-7-release-bundle.md` by default).

## Acceptance Criteria
- Script exits non-zero on:
  - missing required tools (`gh`, `curl`, `git`, `jq`)
  - readiness workflow not found/failed
  - readiness or health contract mismatch
- Script generates a compact auditable bundle in deterministic stdout/file form.
- No API contract changes.

## Execution Command

```bash
TICKET7_EXPECTED_COMMIT="v1.0.5^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-7-release-evidence-pack.sh
```
