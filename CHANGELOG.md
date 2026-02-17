# Changelog

## [v1.0.2] - 2026-02-17

### Added
- Enforced PR-only production freeze policy into production runbook (`README.md`).
- Documented final full production execution flow tied to latest deployment verification.
- Added one-command production verification block in `README.md` with version-pin by release tag (`v1.0.2`).

### Changed
- Re-released production green state after latest merge-freeze pipeline and deployment.
- Replaced health DB probe in `/api/health` with direct PostgreSQL `pg` runtime check for Vercel stability.

### Production status
- Release tag: `v1.0.2`.
- Release commit: `c37ddc6` (`v1.0.2` tag points here, annotated).
- Production-ready deploy verification run: `22114771265` (`production-readiness` success, job `Neon/Postgres + env readiness` success).
- Latest known production alias/deploy:
  - alias: `https://esg-rdt-master-pi.vercel.app`
  - deployment: `https://esg-rdt-master-l9bysy27j-kimikimichineses-projects.vercel.app`
- Verified `/api/ready` and `/api/health` on production alias.

### Release evidence (appendix)
```bash
git show --stat v1.0.2
# Expected output: health endpoint runtime check migration from Prisma-in-route to `pg`, tag alignment to c37ddc6

gh run view 22114771265 --json conclusion,status,headSha,startedAt,updatedAt,url,name,jobs
# Expected output:
# {
#   "conclusion": "success",
#   "status": "completed",
#   "headSha": "69cc102038b4e8d163a69ec4c5eb7f71b1f327cc",
#   "jobs": [{"name":"Neon/Postgres + env readiness","status":"completed","conclusion":"success"}]
# }
```

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
