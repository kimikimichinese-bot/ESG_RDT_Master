# Vercel Support Ticket - TLS handshake failure on legacy alias

## Subject
`ERR_CONNECTION_CLOSED` / TLS handshake abort on `esg-rdt-master-pi.vercel.app` while production deployment is healthy

## Date (UTC)
2026-03-01T21:33:03Z

## Project
- Team: `kimikimichineses-projects`
- Project: `esg-rdt-master`
- Production deployment tested: `dpl_2CZtqHyWDKaLCgTd9skVuntudYA4`
- Deployment URL: `https://esg-rdt-master-1qvm6rp1r-kimikimichineses-projects.vercel.app`

## Impact
Users opening `https://esg-rdt-master-pi.vercel.app` receive connection-closed errors (`ERR_CONNECTION_CLOSED`).
The app itself is healthy on canonical aliases.

## Repro steps
1. Run:
   ```bash
   curl -svI https://esg-rdt-master-pi.vercel.app/
   ```
2. Observe TLS negotiation stops before HTTP response.

## Actual result
```text
* Host esg-rdt-master-pi.vercel.app:443 was resolved.
* IPv4: 216.198.79.3, 64.29.17.3
* Connected to esg-rdt-master-pi.vercel.app ...
* LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to esg-rdt-master-pi.vercel.app:443
```

## Expected result
Alias should either:
- serve normal HTTP response (200/30x/40x), or
- resolve to deterministic Vercel domain-not-configured response,
without TLS handshake abort.

## Control checks (healthy)
```bash
curl -I https://esg-rdt-master-kimikimichineses-projects.vercel.app/login
# HTTP/2 200

curl -I https://esg-rdt-master-kimikimichineses-projects.vercel.app/api/v1/auth/bootstrap
# HTTP/2 200
```

## Mitigations already applied
1. Removed all repository references to `esg-rdt-master-pi.vercel.app`.
2. Updated Vercel env base URLs to canonical alias:
   - `API_BASE_URL`
   - `NEXT_PUBLIC_API_URL`
   - `DIAGNOSTICS_PROXY_API_BASE`
   -> `https://esg-rdt-master-kimikimichineses-projects.vercel.app`
3. Removed `esg-rdt-master-pi.vercel.app` from project domains (`/v9/projects/{id}/domains`).
4. Redeployed production after env/domain cleanup.

## Requested action from Vercel
1. Investigate stale edge routing/cert state for `esg-rdt-master-pi.vercel.app` causing TLS abort.
2. Purge/fix residual edge mapping so the hostname no longer returns handshake failure.
3. Confirm whether this alias is still attached anywhere in internal control plane despite domain removal.
4. Provide recommended permanent cleanup procedure to prevent recurrence.

## Additional context
- `vercel api /v9/projects/{id}/domains` currently returns empty list for this project.
- Canonical production alias is healthy; issue is isolated to legacy `-pi` hostname behavior at TLS layer.
