# Database package

Prisma contract placeholder for:
- Tenant isolation (`tenantId` in production model)
- Event store and core ESG entities
- Reproducible exports and calculation snapshots

Current defaults:
- Provider: PostgreSQL (Neon-compatible)
- Source env var: `DATABASE_URL`
