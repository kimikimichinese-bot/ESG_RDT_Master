# Online smoke report (Deployment Protection bypass)

- HEAD: f3ec0b776d58010968b2e0fe2386869fe3a4b008
- Vercel details: https://vercel.com/kimikimichineses-projects/esg-rdt-master/E5BsyXhatNoRhwaEaR2mKTuX5E8B
- Domain: https://esg-rdt-master-14nzib8u5-kimikimichineses-projects.vercel.app

## Results (bypass via header `x-vercel-protection-bypass`, secret not logged)

- / => HTTP 200
  - server: Vercel
  - cache: public, max-age=0, must-revalidate
  - snippet: <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-s

- /api/health => HTTP 503
  - server: Vercel
  - cache: public, max-age=0, must-revalidate
  - snippet: {"status":"degraded","service":"esg-rdt-master-api","timestamp":"2026-02-27T14:50:33.805Z","version":"c53d7bed","request

- /api/ready => HTTP 503
  - server: Vercel
  - cache: public, max-age=0, must-revalidate
  - snippet: {"status":"degraded","service":"esg-rdt-master-api","timestamp":"2026-02-27T14:50:34.086Z","version":"c53d7bed","request

- /api/v1/health => HTTP 503
  - server: Vercel
  - cache: public, max-age=0, must-revalidate
  - snippet: {"status":"degraded","service":"esg-rdt-master-api","timestamp":"2026-02-27T14:50:34.382Z","version":"c53d7bed","request

- /api/v1/status => HTTP 503
  - server: Vercel
  - cache: public, max-age=0, must-revalidate
  - snippet: {"status":"degraded","service":"esg-rdt-master-api","timestamp":"2026-02-27T14:50:34.694Z","version":"c53d7bed","request

## Notes
- If an endpoint returns 404, it is acceptable when the route is intentionally absent.
- Goal is to avoid 401 (protection gating) and identify 5xx runtime errors.
