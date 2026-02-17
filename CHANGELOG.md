# Changelog

## [v1.0.1] - 2026-02-17

### Added
- Added production uptime and rollout documentation in `docs-production-checks`:
  - Alias rollout timeline and alias ownership note for `esg-rdt-master-pi.vercel.app`.
  - One-command production verification runbook in README.
  - Explicit required checks and branch protection runbook updates.

### Changed
- Confirmed production-readiness workflow and context isolation checks are validated on release flow.
- Confirmed monitoring health endpoints (`/api/ready`, `/api/health`) as part of the release verification contract.

### Production status
- Release tag pushed: `v1.0.1`.
- Latest production deployment alias: `https://esg-rdt-master-pi.vercel.app`.
- Verified successful production readines run and green verification gates:
  - `production-readiness` workflow pass.
  - Vercel deployment healthy and endpoint checks passing.

## [v1.0.0]
- Initial production-readiness consolidation:
  - CI/CD guardrails for Neon/Postgres readiness and protected `master` merge flow.
- Context switching documentation and repository-level deployment runbooks.
