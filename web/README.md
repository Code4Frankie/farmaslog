# FarmasLog web (sign in / request access)

Plain HTML, CSS and JavaScript. No build step, no dependencies.

## Deploy on Vercel
1. Put this folder in a Git repo (or use the Vercel CLI: `npx vercel` inside this folder).
2. In Vercel: **Add New > Project**, import the repo, set **Root Directory** to `web` and **Framework Preset: Other**. Build settings come from `vercel.json`.
3. Deploy. Without `FARMASLOG_API_URL` it runs in **demo mode** (sample data, banner shown): demo login `demo@farmaslog.test` / `demo-password-123`.

## Connect it to the real API
1. Deploy the API (see its README; Render staging blueprint included) over **https**.
2. On Vercel set the environment variable `FARMASLOG_API_URL=https://your-api-host` (https, no trailing slash) and redeploy. `build-config.js` writes it into `config.js` at build time. For local use, edit `config.js` directly.
3. On the API, set `CORS_ORIGINS=https://your-project.vercel.app` (comma-separate extra origins; each Vercel preview URL is a different origin).
4. Sign-up flow: an organisation requests access, then a super admin approves it with `POST /v1/partners/{id}/approve` (list pending ones with `GET /v1/partners?status=pending`). Approved users can sign in.

## Showing it for any state
The sample verification slip on the sign-in page is fillable: type or pick any state, LGA, community and crop and the slip updates. Suggestions come from `areas.json` (all 36 states, the FCT and 774 LGAs); anything not in the list can still be typed. Keep `areas.json` identical to `api/src/data/ng-areas.json`.

## Notes
- The sign-in token is kept in `sessionStorage` (cleared when the tab closes). Fine for a first build; revisit before real use.
- Sign-up is for partner organisations (banks, programmes, insurers). Farmer registration stays on the separate registration form.
- Screens by role: partner (Verify, API keys, Usage), administrator (Requests, Farmers, Register, API keys, Usage), data manager (Farmers, Register), field agent (Register, Farmers), finance and auditor (Usage, Farmers). In demo mode only sign-in and sign-up work.
- Not built yet: evidence-file upload, enrichment trigger, farmer edit, audit and request logs, team/user creation, key rotation, email notices, password reset.
