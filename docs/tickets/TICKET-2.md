# TICKET #2 — Production diagnostics landing page

## Goal
Expose a clear production diagnostics entrypoint in the main web workspace so operators can quickly validate environment health and endpoint status.

## Scope
- Update `apps/web/app/page.js` to show:
  - project identity (ESG RDT Master)
  - direct links to `/api/ready` and `/api/health`
  - deployment and monitoring checklist CTA
- Add small “operational” framing text to keep scope minimal and read-only.

## Acceptance Criteria
- Home route renders the diagnostics links on `/`.
- No functional behavior change for API contracts.
- UI is copy/paste-friendly and safe for production visibility checks.
