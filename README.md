# ESG Enterprise Data Platform — Master Documentation  
**Starter spec (GitHub + Vercel + Neon + Codex-ready)**

**Status:** Project Starter (Expanded + Implementable)  
**Date:** 2026-02-17  
**Primary Stack:** GitHub • Vercel • Neon (Postgres) • Prisma • Next.js (Turborepo)  
**Optional Stack:** Upstash Redis • Vercel Blob • Arelle (XBRL validation)

---

## How to use this document

- Drop this file into your repo as `docs/MASTER.md` (or keep it as your root `README.md`).
- Treat it as the **single source of truth** for architecture + product scope.
- Each section includes **implementation-ready decisions** and “Definition of Done” checklists so Codex can execute reliably.

---

## Table of Contents

1. [Vision, Scope, Non‑Goals](#1-vision-scope-non-goals)  
2. [Architecture (Vercel + Neon compatible)](#2-architecture-vercel--neon-compatible)  
3. [Monorepo Layout & Conventions](#3-monorepo-layout--conventions)  
4. [Environments, Preview Deployments, Neon Branching](#4-environments-preview-deployments-neon-branching)  
5. [Data Model & Multi‑Tenancy](#5-data-model--multi-tenancy)  
6. [Event Sourcing + CQRS (MVP‑safe)](#6-event-sourcing--cqrs-mvp-safe)  
7. [Modules & Functional Requirements](#7-modules--functional-requirements)  
8. [Ingestion & Evidence Vault (PDF-first)](#8-ingestion--evidence-vault-pdf-first)  
9. [Calculation Engine (Scope 1/2) + Methodology](#9-calculation-engine-scope-12--methodology)  
10. [Reporting & Exports (JSON/PDF/DOCX/XLSX/XBRL)](#10-reporting--exports-jsonpdfdocxxlsxxbrl)  
11. [Security Baseline (RBAC + Audit + Tenant Isolation)](#11-security-baseline-rbac--audit--tenant-isolation)  
12. [Observability, Reliability, Operations](#12-observability-reliability-operations)  
13. [Billing & Entitlements (Stripe-ready)](#13-billing--entitlements-stripe-ready)  
14. [Roadmap (P0/P1/P2)](#14-roadmap-p0p1p2)  
15. [Codex Development Contract (for agents)](#15-codex-development-contract-for-agents)  
16. [Appendix: Checklists & Templates](#16-appendix-checklists--templates)  

---

## 1. Vision, Scope, Non‑Goals

### 1.1 Vision (What we’re building)

An **enterprise-grade ESG data platform** that supports an end‑to‑end audit‑ready flow:

1) Upload evidence (PDF bills, invoices, meter reports)  
2) Extract & structure (OCR / parsing)  
3) Normalize units and validate quality  
4) Append immutable events (event store)  
5) Build read models (CQRS) for dashboard & exports  
6) Compute emissions (Scope 1 & 2, location- and market-based)  
7) Generate reports & platform-ready datasets (EcoVadis/CDP ready packs)

### 1.2 Scope (MVP → V1)

**MVP**
- Multi-tenant SaaS, tenant isolation, RBAC
- Evidence upload + metadata + PDF viewer
- Manual activity entry + templates download
- Scope 1/2 calculator (deterministic)
- Dashboard KPIs + audit log
- Exports: JSON + PDF; scaffold DOCX/XLSX

**V1**
- DOCX/XLSX template engine
- Data quality scores (completeness + outliers + duplicates)
- Approval workflow (Draft → Submitted → Approved → Locked)
- Platform-ready dataset packs (at least 1: EcoVadis or CDP)
- Strict compliance mode in CI/Prod

### 1.3 Non‑Goals (avoid scope creep)

- Full Scope 3 LCA engine end-to-end (only scaffold + placeholders)
- ERP replacement
- Heavy data warehouse (stick to read models + exports)

---

## 2. Architecture (Vercel + Neon compatible)

### 2.1 Key constraints (hard)

- **GitHub** is the source of truth (branches → PRs → reviews).
- **Vercel** handles Preview + Production deployments.
- **Neon** is the database for Dev/Preview/Prod (no local DB required).
- **No WebSocket server on Vercel Functions**: realtime must be SSE/polling or external provider.
- **All evidence blobs must be stored outside Postgres** (Vercel Blob or S3-compatible).

### 2.2 Recommended “Vercel-native” container architecture

**Core (runs on Vercel)**
- `apps/web` — Next.js dashboard + UI + server actions
- `apps/api` — HTTP API (Next.js route handlers OR NestJS packaged for functions)
- `apps/worker` — background jobs triggered by Vercel Cron (MVP) or external runner (later)

**Data**
- Neon Postgres — event store + relational core + read models
- Upstash Redis — cache, rate limit, job queue (optional for MVP)
- Vercel Blob — evidence files + generated artifacts

> MVP principle: keep “worker” as **cron-triggered functions** + Neon polling. If throughput grows, move workers to dedicated compute (Fly/Render/K8s) without changing the DB contract.

### 2.3 Realtime strategy (Vercel-safe)

Because Vercel Functions are not suitable as a WebSocket server, choose one:

**Option A (MVP default): SSE + polling**
- SSE endpoints for progress (jobs/export), plus short polling for dashboards.
- Works on Vercel and is simple.

**Option B (Enterprise): external realtime provider**
- Ably/Pusher/Cloudflare PubSub, etc.
- Useful for high-frequency updates, notifications, collaborative features.

### 2.4 Storage strategy

- **Evidence & artifacts**: Vercel Blob (recommended)  
- **Metadata + hashes + lineage**: Postgres (Neon)

---

## 3. Monorepo Layout & Conventions

### 3.1 Turborepo layout (suggested)

```
ESGPlatform/
  apps/
    web/                # Next.js UI
    api/                # API (Next route handlers OR NestJS)
    worker/             # background jobs (cron-triggered)
  packages/
    db/                 # Prisma schema, migrations, db client
    shared/             # shared types, zod schemas, utils
    ui/                 # shared UI components (tailwind)
  docs/
    MASTER.md           # this file
    ADR/                # architecture decisions
  scripts/              # helper scripts
  .github/workflows/    # CI
  turbo.json
  package.json
```

### 3.2 Node & tooling baseline

- Node.js: 20+  
- Package manager: `pnpm`  
- TypeScript: strict  
- Lint/format: ESLint + Prettier  
- Validation: Zod schemas shared between UI/API

### 3.3 Turbo tasks (minimum)

- `dev` — local dev  
- `build` — production build  
- `test` — unit tests  
- `lint` — lint  
- `typecheck` — TS checks  
- `db:migrate` — Prisma migrate  
- `db:seed` — seed demo tenant + dataset

---

## 4. Environments, Preview Deployments, Neon Branching

### 4.1 Vercel environments

- **Development**: local machine, but uses cloud services (Neon)  
- **Preview**: per branch / PR deployment  
- **Production**: main branch / release

### 4.2 Neon branching workflow (must)

Use Neon’s Vercel integration to:
- create a **database branch per preview deployment**
- inject env vars automatically into Vercel (e.g., `DATABASE_URL`, `DATABASE_URL_UNPOOLED`)

### 4.3 Environment variables (baseline)

**Database**
- `DATABASE_URL` (Neon pooled)
- `DATABASE_URL_UNPOOLED` (Neon unpooled; recommended for migrations)

**Auth**
- `AUTH_SECRET` (or `NEXTAUTH_SECRET`)
- `AUTH_TRUST_HOST=true` (if required by your auth stack)

**App URLs**
- `NEXT_PUBLIC_WEB_URL`
- `NEXT_PUBLIC_API_URL`

**Storage**
- `BLOB_READ_WRITE_TOKEN` (if using Vercel Blob SDK)
- or `S3_*` variables if using S3/R2

**Queue/Cache (optional)**
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### 4.4 Local env workflow

- Use Vercel CLI to pull env vars:
  - `vercel env pull .env.local`
- Local dev runs against the same Neon branch (Dev) or an explicit personal branch.

---

## 5. Data Model & Multi‑Tenancy

### 5.1 Tenancy model (strict logical separation)

- Single shared DB; every table includes `tenantId` (UUID).
- Every query path must enforce tenant scope:
  - API middleware enforces `tenantId` from session/JWT.
  - Prisma client helpers require tenantId for all reads/writes.
- Indexes must include tenantId as the leading column:
  - `(tenantId, entityId)`
  - `(tenantId, createdAt)` for timelines.

### 5.2 Core entities (MVP)

- `Tenant`, `User`, `UserRole`, `Membership`
- `OrganizationalUnit` (adjacency list)
- `Site` (facility)
- `MetricDefinition`
- `ActivityData`
- `Evidence` (metadata) + `EvidenceVersion`
- `EmissionFactorLibrary` + `EmissionFactor`
- `CalculationRun` + `EmissionsResult`
- `AuditLog` (tamper-evident)
- `EventStore` (append-only)

### 5.3 Data lineage (must for ESG)

Every computed KPI/report row must be traceable:

- `reportValue` → `calculationRunId`
- `calculationRunId` → input `activityDataIds` + `factorSetVersion`
- `activityDataId` → `evidenceId` (optional) + transformations

---

## 6. Event Sourcing + CQRS (MVP‑safe)

### 6.1 Why event sourcing here

- Auditability: immutable log
- Reproducibility: runs are pinned
- Recovery: rebuild read models

### 6.2 Event store schema (minimum)

`EventStore` columns:
- `eventId` (UUID, PK)
- `tenantId`
- `eventType`
- `schemaVersion`
- `occurredAt`
- `actorId` (nullable system)
- `payload` (JSONB)
- `hash` (sha256)
- `prevHash` (for chain integrity per tenant/stream)

### 6.3 CQRS projector

- Consumes events and updates:
  - `facility_metrics_daily`
  - `org_totals`
  - `supplier_risk_rollups` (later)

**MVP worker mode**
- Vercel Cron triggers `/api/cron/projector` every N minutes.
- The worker uses offset/sequence to fetch new events and project deterministically.

---

## 7. Modules & Functional Requirements

### 7.1 Product modules (packaging)

1) **Core ESG**  
2) **Evidence Vault**  
3) **Reporting Advanced**  
4) **Supply Chain**  
5) **Enterprise** (SSO/SCIM/MFA/retention)

### 7.2 Functional matrix (MVP)

| Area | End user action | Output | DoD |
|---|---|---|---|
| Org/Sites | create org + 2 sites | cards visible | tenant scoped |
| Evidence | upload + view PDF | versioned file + metadata | hash + audit event |
| Activities | create/edit activity record | normalized data | units validated |
| Calculator | run scope 1/2 | emissions result | deterministic runId |
| Dashboard | view KPIs | read model totals | under 2s p95 |
| Exports | generate JSON/PDF | downloadable artifacts | stored in blob |
| Audit | view actions | immutable audit | chain hash |

---

## 8. Ingestion & Evidence Vault (PDF-first)

### 8.1 Evidence lifecycle

**States**
- `Draft` → `Submitted` → `Approved` → `Locked` (V1)
- MVP: `Draft` + `Locked` (optional)

### 8.2 Upload design (Vercel Blob recommended)

- Client requests an upload token (server route)
- Client uploads directly to Blob store
- Server writes `EvidenceVersion` row:
  - blob URL, size, contentType, sha256
- Emit event `EvidenceUploaded`

### 8.3 PDF viewer

- Inline PDF preview in UI (tenant-scoped access)
- Download button with access control

---

## 9. Calculation Engine (Scope 1/2) + Methodology

### 9.1 Supported scopes (MVP)

- Scope 1: stationary combustion, mobile combustion, refrigerants (basic)
- Scope 2: electricity, heat (location-based + market-based)

### 9.2 Emission factors (EF) strategy

Priority order:
1) tenant custom factors (override)
2) country/region library
3) global fallback

All calculation runs must pin:
- `factorSetVersion`
- methodology profile
- unit conversion profile

### 9.3 Determinism & reproducibility

A `CalculationRun` is immutable:
- Inputs snapshot (IDs + values + units)
- EF version pinned
- Output stored with hashes

---

## 10. Reporting & Exports (JSON/PDF/DOCX/XLSX/XBRL)

### 10.1 Export formats

- **JSON** (canonical, always)
- **PDF** (immutable official rendering)
- **DOCX** (template-driven, editable)
- **XLSX** (dataset + pivots + dictionary)
- **XBRL zip** (minimal taxonomy + validation report)

### 10.2 Template engine (V1)

- Store templates per tenant (Blob) and track versions
- Placeholders map to canonical JSON paths
- Validate template compatibility by schema version

### 10.3 “Platform-ready” packs (V1)

- Zip containing:
  - dataset CSV/XLSX
  - mapping manifest (json)
  - validation report (json)
  - changelog (md)

---

## 11. Security Baseline (RBAC + Audit + Tenant Isolation)

### 11.1 Roles (RBAC)

- SuperAdmin
- TenantAdmin
- Manager
- Personnel
- Auditor (read-only)

### 11.2 Mandatory controls (MVP)

- Tenant isolation enforced at:
  - API layer (middleware + policy)
  - DB layer (indexes + constraints)
- File access checks (Blob URLs must be protected or signed)
- Rate limiting (optional but recommended)
- Audit log (append-only, chain-hashed)

### 11.3 Enterprise controls (V1/P2)

- OIDC / SAML SSO
- SCIM provisioning
- MFA (TOTP/WebAuthn)
- Retention & legal hold
- Export audit for external assurance

---

## 12. Observability, Reliability, Operations

### 12.1 Logging (must)

Structured JSON logs:
- `requestId`, `tenantId`, `actorId`, `route`, `latencyMs`, `status`

### 12.2 Metrics (minimum)

- ingestion throughput
- job durations (p95)
- export failures rate
- queue depth (if Redis)

### 12.3 Runbooks (must write)

- DB connection failures
- Blob upload failures
- Projector stuck / replay
- Export failing

---

## 13. Billing & Entitlements (Stripe-ready)

### 13.1 Entitlements model (feature flags)

- `maxUsers`
- `maxEvidenceGB`
- `ocrPagesPerMonth`
- `exportsPerMonth`
- `modulesEnabled`: supplyChain, advancedReporting, sso

### 13.2 Downgrade rules

- No data deletion on downgrade
- Read-only access beyond quotas
- Block new exports/uploads when over limit

---

## 14. Roadmap (P0/P1/P2)

### P0 (demo-blocking)
- Evidence upload + versioning + PDF viewer
- Activity CRUD + unit normalization
- Scope 1/2 deterministic calculator
- JSON + PDF exports
- Audit log + tenant isolation
- Neon preview branches integrated with Vercel previews

### P1 (V1 readiness)
- Approval workflow
- DOCX/XLSX template engine
- Data quality score + completeness dashboard
- Worker robustness: retries + DLQ (logical)
- Strict compliance mode in CI

### P2 (Enterprise)
- SSO + SCIM + MFA
- Assurance workspace + sampling
- Residency & retention policies
- Full platform-ready packs (EcoVadis + CDP)

---

## 15. Codex Development Contract (for agents)

This section is written to be “agent-friendly” so Codex can execute tasks consistently.

### 15.1 Repository rules

- Never bypass tenant isolation.
- Any new DB table MUST include `tenantId` and indexes.
- Any write endpoint MUST emit an audit entry and (if relevant) an event.
- All exports MUST be reproducible: pin versions & store artifacts in Blob.

### 15.2 Commands Codex should run

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:migrate` (when schema changes)

### 15.3 PR hygiene

- Small diffs, one feature per PR
- Update docs when behavior changes
- Include “DoD checklist” in PR description

### 15.4 Recommended companion file: `AGENTS.md`

Create `AGENTS.md` at repo root (or in `/docs`) with:
- “Project charter”
- “Commands”
- “Do not touch” files
- “Acceptance criteria style”

A minimal template is in the Appendix.

---

## 16. Appendix: Checklists & Templates

### 16.1 Definition of Done (feature)

- [ ] Tenant-scoped (API + DB)
- [ ] Audit event logged
- [ ] Tests updated/added
- [ ] Typecheck + lint pass
- [ ] UI states handled (loading/error/empty)
- [ ] Docs updated if contract changed

### 16.2 `AGENTS.md` template (copy/paste)

```md
# AGENTS — ESG Platform

## Mission
Implement features for an ESG multi-tenant platform with strict tenant isolation, auditability, and reproducible exports.

## Hard rules
- Every table has tenantId + indexes
- Every write logs audit + emits event where relevant
- No WebSocket server (use SSE/polling or provider)
- Files go to Blob storage; DB stores metadata + hashes only

## Commands
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate

## Acceptance criteria
- Works for Preview (Neon branch) and Prod
- Deterministic calculations with pinned factor versions
- No cross-tenant data access possible
```

### 16.3 `.env.local` example (NO secrets)

```env
# Neon (injected on Vercel Preview/Prod, pulled locally via `vercel env pull`)
DATABASE_URL="__INJECTED_BY_NEON__"
DATABASE_URL_UNPOOLED="__INJECTED_BY_NEON__"

# App URLs
NEXT_PUBLIC_WEB_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"

# Auth
AUTH_SECRET="__SET_ME__"

# Blob (if used)
BLOB_READ_WRITE_TOKEN="__SET_ME__"

# Redis (if used)
UPSTASH_REDIS_REST_URL="__SET_ME__"
UPSTASH_REDIS_REST_TOKEN="__SET_ME__"
```

### 16.4 `vercel.json` cron example (worker trigger)

```json
{
  "crons": [
    { "path": "/api/cron/projector", "schedule": "*/5 * * * *" }
  ]
}
```

> Note: Cron schedule frequency depends on your Vercel plan. Keep this flexible.

### Production merge runbook (kimikimichinese-bot)

To keep branch protection and CI gates reproducible:

1. Ensure this branch is up to date and all required checks are green.
2. Confirm the PR status/check summary on GitHub (`lint-build-test`, `Neon/Postgres + env readiness`).
3. Merge from PR using:
   - `gh pr merge <PR_NUMBER> --merge --delete-branch`

Fallback direct flow (if needed from local branch):

1. `git fetch origin`
2. `git checkout master`
3. `git pull`
4. Wait for all required checks on the PR to be green before merging.

---

**End of document.**

### Branch protection gates (Kimikimichinese-bot)

For production-readiness gating on `ESG_RDT_Master` (`master`):

- Required status checks (exact names):
  - `Neon/Postgres + env readiness`
  - `lint-build-test`
- Branch rules:
  - `master` is protected
  - Strict mode enabled
  - 1 required approving review
  - Admin enforcement enabled

Health monitoring endpoints available on Vercel:
- `https://esg-rdt-master-pi.vercel.app/api/ready`
- `https://esg-rdt-master-pi.vercel.app/api/health`

### Final Go-Live Checklist (Production)

Use this for each production-ready push on `master`:

1. Verify hard context isolation:
   - `./scripts/context-check.sh`
   - `gh auth status` shows `kimikimichinese-bot`
   - `vercel whoami` shows `kimikimichinese-bot`
2. Confirm branch state:
   - On `master` and tracking `origin/master`
   - No local divergence (`git status`)
3. Run the required production readiness workflow:
   - `gh workflow run production-readiness.yml -f run_migrations=true --ref master`
4. Confirm required checks on `master` are green:
   - `Neon/Postgres + env readiness`
   - `lint-build-test`
5. Merge only when checks are green, then verify deployment:
   - `./scripts/context-check.sh`
   - `vercel ls esg-rdt-master`
   - `curl -sfS https://esg-rdt-master-pi.vercel.app/api/ready`
   - `curl -sfS https://esg-rdt-master-pi.vercel.app/api/health`

### Uptime & alias rollout note (kimikimichinese-bot)

- Primary production alias: `esg-rdt-master-pi.vercel.app`
- Latest known production deployment: `https://esg-rdt-master-l9bysy27j-kimikimichineses-projects.vercel.app`
- Alias update pattern used during rollout: push → deploy → alias points to latest production-ready deployment on Vercel.
- Quick rollout checks:
  - `vercel ls esg-rdt-master`
  - `vercel alias ls | grep esg-rdt-master-pi.vercel.app`

### One-command full production check (copy-paste)

```bash
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app"
PROD_DEPLOYMENT="https://esg-rdt-master-l9bysy27j-kimikimichineses-projects.vercel.app"
PROD_EXPECTED_COMMIT="$(git rev-parse --short v1.0.2)"

echo "Production alias: ${PROD_ALIAS}"
echo "Latest production deployment: ${PROD_DEPLOYMENT}"
echo "Expected version: ${PROD_EXPECTED_COMMIT}"

./scripts/context-check.sh && \
gh workflow run production-readiness.yml -f run_migrations=true --ref master && \
sleep 30 && \
gh run list --workflow production-readiness --branch master --limit 1 && \
./scripts/context-check.sh && \
vercel --prod --yes && \
curl -sfS https://esg-rdt-master-pi.vercel.app/api/ready && \
curl -sfS "${PROD_ALIAS}/api/health" | tee /tmp/health.json && \
grep -q "\"version\":\"${PROD_EXPECTED_COMMIT}\"" /tmp/health.json && \
echo "Health commit check passed."
```

### Ticket #3 one-command pre-merge check

```bash
RUN_MIGRATIONS=false \
TICKET3_EXPECTED_COMMIT="$(git rev-parse --short=8 HEAD)" \
./scripts/ticket-3-full-check.sh
```

### Ticket #4 release audit signature

```bash
TICKET4_TAG="v1.0.4" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-4-release-signature.sh
```

### Ticket #5 audit evidence bundle

```bash
TICKET5_TAG="v1.0.4" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-5-audit-bundle.sh
```

### Ticket #6 production handoff command

```bash
TICKET6_EXPECTED="v1.0.5^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-6-production-handoff.sh
```

### Ticket #7 release evidence bundle

```bash
TICKET7_EXPECTED_COMMIT="v1.0.5^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-7-release-evidence-pack.sh
```

### Ticket #8 production drift check

```bash
TICKET8_EXPECTED_COMMIT="v1.0.5^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-8-production-drift.sh
```

### Ticket #9 production readiness automation

```bash
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-9-production-readiness-automation.sh
```

Default expected commit is `v1.0.6^{}`.
To validate a different deploy commit, set `TICKET9_EXPECTED_COMMIT` explicitly:
`TICKET9_EXPECTED_COMMIT="abcdef12" ./scripts/ticket-9-production-readiness-automation.sh`

### Ticket #10 production readiness docs hardening

```bash
TICKET10_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-10-readiness-docs-hardening.sh
```

### Ticket #11 production readiness SOP hardening

```bash
TICKET11_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-11-production-readiness-sop-hardening.sh
```

### Ticket #12 production readiness evidence hardening

```bash
TICKET12_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-12-readiness-evidence-hardening.sh
```

### Ticket #13 production release audit hardening

```bash
TICKET13_RELEASE_TAG="v1.0.6" \
TICKET13_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-13-release-audit-hardening.sh
```

### Ticket #14 production readiness release log compact

```bash
TICKET14_RELEASE_TAG="v1.0.6" \
TICKET14_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-14-production-readiness-release-log-compact.sh
```

### Ticket #15 production readiness mandatory docs

```bash
TICKET15_RELEASE_TAG="v1.0.6" \
TICKET15_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-15-production-readiness-mandatory-docs.sh
```

### Ticket #16 production release log evidence format

```bash
TICKET16_RELEASE_TAG="v1.0.6" \
TICKET16_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-16-release-log-evidence-format.sh
```

### Ticket #17 production readiness observability log checks

```bash
TICKET17_RELEASE_TAG="v1.0.6" \
TICKET17_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-17-readiness-observability-log-checks.sh
```

### Ticket #18 production readiness README audit

```bash
TICKET18_RELEASE_TAG="v1.0.6" \
TICKET18_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-18-readme-audit.sh
```

### Ticket #19 production readiness docs continuity

```bash
TICKET19_RELEASE_TAG="v1.0.6" \
TICKET19_EXPECTED_COMMIT="v1.0.6^{}" \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-19-readme-continuity.sh
```

### Ticket #20 production readiness log depth and continuity evidence

```bash
TICKET20_RELEASE_TAG="v1.0.6" \
TICKET20_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET20_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-20-log-depth-checks.sh
```

### Ticket #21 production readiness hardening and command continuity

```bash
TICKET21_RELEASE_TAG="v1.0.6" \
TICKET21_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET21_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-21-readiness-hardening.sh
```

### Ticket #22 production readiness docs hygiene

```bash
TICKET22_RELEASE_TAG="v1.0.6" \
TICKET22_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET22_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-22-production-readiness-docs-hygiene.sh
```

### Ticket #23 production readiness docs hygiene continuity

```bash
TICKET23_RELEASE_TAG="v1.0.6" \
TICKET23_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET23_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-23-production-readiness-docs-hygiene-continuity.sh
```

### Ticket #24 production readiness ops handoff

```bash
TICKET24_RELEASE_TAG="v1.0.6" \
TICKET24_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET24_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-24-production-readiness-ops-handoff.sh
```

### Production freeze policy (strict PR-only)

From this point onward, **do not push directly to `master`**.

Use this rule:

1. Work on a feature branch.
2. Open PR to `master`.
3. Require required checks:
   - `Neon/Postgres + env readiness`
   - `lint-build-test`
4. Require review + merge via PR UI/CLI:
   - `gh pr merge <PR_NUMBER> --merge --delete-branch`
5. Run one-command full production check only on merged state.

`master` is the production control plane for `kimikimichinese-bot` and must stay protected.

Keep `dituccios` and every other project fully in separate branches/credentials and never merge here.

# ESG_RDT_Master
```

# ESG_RDT_Master

### Ticket #25 production readiness evidence continuity

```bash
TICKET25_RELEASE_TAG="v1.0.6" \
TICKET25_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET25_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-25-production-readiness-evidence-continuity.sh
```

### Ticket #26 production readiness ops drift check

```bash
TICKET26_RELEASE_TAG="v1.0.6" \
TICKET26_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET26_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-26-production-readiness-ops-drift-check.sh
```

### Ticket #27 production readiness docs hardening

```bash
TICKET27_RELEASE_TAG="v1.0.6" \
TICKET27_EXPECTED_COMMIT="v1.0.6^{}" \
TICKET27_LOG_DEPTH=3 \
PROD_ALIAS="https://esg-rdt-master-pi.vercel.app" \
./scripts/ticket-27-production-readiness-docs-hardening.sh
```
