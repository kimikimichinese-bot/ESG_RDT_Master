# TICKET #5 — Audit bundle and post-release evidence

## Goal
Add a single-command local audit bundle to capture post-release evidence in a copy-paste-ready form.

## Scope
- Add `./scripts/ticket-5-audit-bundle.sh` that performs:
  - latest `production-readiness` run metadata lookup
  - `/api/ready` validation
  - `/api/health` validation
  - local `git` snapshot (tag + branch tip) for traceability
- Keep this ticket strictly operational/informational (no API contract changes).

## Acceptance Criteria
- Script exits non-zero if any required check fails.
- Script prints versioned, structured evidence that can be pasted into a release log.
- Script supports optional override:
  - `TICKET5_REF` to pin a specific checked commit
  - `TICKET5_TAG` when capturing release evidence

## Execution Command

```bash
TICKET5_TAG="v1.0.4" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-5-audit-bundle.sh
```
