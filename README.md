# FarmasLog

Farmer and farm verification for agricultural lenders and programmes.

```
farmaslog/
  api/   Node.js + Express + MongoDB verification API (tests, Swagger at /docs, Postman collection)
  web/   Sign in / request access site (plain HTML/CSS/JS, deploys on Vercel, has a demo mode)
  render.yaml   Render Blueprint for the API
  DEPLOY.md     Step-by-step live deployment (Atlas + Render + Vercel) with commands
```

## Open in VS Code
```bash
code farmaslog
```
Accept the recommended extensions. Then **Terminal > Run Task**: `API: install`, `API: unit tests`, `API: dev server`, `Web: serve on :5173`. **Run > Start Debugging** runs the API under the debugger (needs `api/.env`, copy from `api/.env.example`).

## Demo it for any state
The sign-in page has a fillable sample slip (pick or type any state, LGA, community and crop), and the API accepts any area. Seed a demo for another state with `cd api && npm run seed -- --demo --state=Kano --lga=Gwale --community=Gwale`.

## Next
- Go live: follow [DEPLOY.md](DEPLOY.md).
- API details: [api/README.md](api/README.md).
- Front end details: [web/README.md](web/README.md).
