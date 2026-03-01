# TICKET #4 — Release evidence signature automation

## Goal
Add a small, deterministic command to generate a release signature block for audit-ready evidence
after production-ready merges, without altering application runtime or API contracts.

## Scope
- Add `./scripts/ticket-4-release-signature.sh` to collect:
  - latest `production-readiness` workflow run on `master`
  - `/api/ready` and `/api/health` payloads from alias
  - tag evidence (`git show --stat`-style commit digest and version)
- Keep the command non-destructive and local-only.
- Store results in a temporary file for copy/paste into changelogs or release notes.

## Acceptance Criteria
- Script exits non-zero on missing tools (`gh`, `curl`, `git`) or failed `/api/*` checks.
- Command prints a complete release evidence block including:
  - tag / commit
  - workflow run id + URL
  - `/api/ready` payload
  - `/api/health` payload
- No production/CI behavior is changed by this ticket.

## Execution Command

```bash
TICKET4_TAG="v1.0.4" \
PROD_ALIAS="https://esg-rdt-master-kimikimichineses-projects.vercel.app" \
./scripts/ticket-4-release-signature.sh
```
