# Online smoke report (Deployment Protection bypass attempt)

- HEAD: `4f16c7c`
- Vercel details: https://vercel.com/kimikimichineses-projects/esg-rdt-master/FiUfPvpgtogKEfBxiVwQsbQ3eZhK
- Domain used for checks: https://esg-rdt-master-lzgida4ga-kimikimichineses-projects.vercel.app
- Note: Header-based bypass was attempted with `x-vercel-protection-bypass` but endpoints still return 401.
- Note: A valid `VERCEL_AUTOMATION_BYPASS_SECRET` (already set to a non-empty value in session) was used; please verify it matches the Vercel project secret if 401 persists.

## Results
| Endpoint | HTTP status | Snippet |
|---|---:|---|
| / | 401 | This page requires Vercel authentication. Here are your options: |
| /api/health | 401 | This page requires Vercel authentication. Here are your options: |
| /api/ready | 401 | This page requires Vercel authentication. Here are your options: |
| /api/v1/health | 401 | This page requires Vercel authentication. Here are your options: |
| /api/v1/status | 401 | This page requires Vercel authentication. Here are your options: |

## Notes
- If secret is correct and 401 persists, check whether the deployment target is protected by Vercel Project Protection and whether the bypass secret in GitHub Actions / local env matches the project setting.
