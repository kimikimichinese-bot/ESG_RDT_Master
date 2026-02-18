# Ticket catalog (compacted)

To avoid a repetitive list in one place, this compact index groups tickets by operational pattern.

## Active pattern from Ticket #55 onwards (continuity wrapup wave)

- Scope: `ticket-<N>-production-readiness-evidence-continuity-wrapup.sh`
- Command style:
  - `TICKET<N>_RELEASE_TAG="v1.0.6"`
  - `TICKET<N>_EXPECTED_COMMIT="v1.0.6^{}"`
  - `TICKET<N>_LOG_DEPTH=4`
  - `PROD_ALIAS="https://esg-rdt-master-pi.vercel.app"`
  - `./scripts/ticket-<N>-production-readiness-evidence-continuity-wrapup.sh`

Range covered in this repo:

- `55 <= N <= 198` (already present with per-ticket scripts and docs).

## Recommended bulk execution

Use one command for the whole range:

```bash
./scripts/run-ticket-wave.sh \
  --from 55 \
  --to 198 \
  --check-script-template "ticket-%d-production-readiness-evidence-continuity-wrapup.sh" \
  --create-missing-prs true \
  --default-deploy-flag false \
  --deploy-final false \
  --repo kimikimichinese-bot/ESG_RDT_Master
```

This keeps PR/merge/check flow quota-safe and avoids command-by-command repetition.

