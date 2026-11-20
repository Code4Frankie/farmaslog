# Deploy FarmasLog: API on Render, web on Vercel, data on MongoDB Atlas

Order matters: database first, then API, then web, then connect them. Allow about 45 minutes the first time.

| Piece | Where | Cost for a demo | Watch out |
|---|---|---|---|
| Database | MongoDB Atlas (free shared cluster) | free | Render has no MongoDB, so Atlas is needed |
| API (`api/`) | Render web service | free plan | Sleeps after 15 min idle (about 1 min to wake). No persistent disk: uploaded evidence files are lost on restart |
| Web (`web/`) | Vercel | free Hobby plan | Hobby is for **non-commercial** use only. Use a paid plan once this is a commercial product |

## 0. Prerequisites
Node 20 or newer, Git, a GitHub account, and free accounts on MongoDB Atlas, Render and Vercel. Optional: `jq` (for the curl examples) and the GitHub CLI (`gh`).

## 1. Run it locally first (10 minutes, optional but worth it)
```bash
cd farmaslog/api
cp .env.example .env          # defaults are fine for local development
npm install
npm run test:unit             # 71 tests, no database needed
# With Docker you can also run the database-backed tests and a local API:
docker compose up -d mongo && npm run test:db
npm run dev                   # http://localhost:3000/docs
```
In a second terminal, open the site (demo mode): `cd farmaslog/web && npm run dev` then visit http://localhost:5173.

## 2. Create the database (MongoDB Atlas)
1. cloud.mongodb.com > create a project > **Create a cluster** > choose the **free** shared tier (M0), any region near you.
2. **Database Access** > Add database user. Choose a username and a strong password (avoid `@ : / ?` in the password, or URL-encode them).
3. **Network Access** > Add IP address > **Allow access from anywhere (0.0.0.0/0)**. Render's free plan has no fixed IP, so this is needed. Your database password is then the only protection, so make it long. Tighten this before real use.
4. **Connect > Drivers**, copy the connection string and add the database name:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/farmaslog?retryWrites=true&w=majority`
   Keep it handy. It is a secret: never commit it.

## 3. Put the code on GitHub
```bash
cd farmaslog
git init -b main
git add .
git status                    # check that .env and node_modules are NOT listed
git commit -m "FarmasLog: api + web"
# Option A, GitHub CLI:
gh repo create farmaslog --private --source=. --push
# Option B: create an empty private repo on github.com, then:
# git remote add origin https://github.com/YOUR-USER/farmaslog.git && git push -u origin main
```
Vercel Hobby can only import repos owned by your **personal** GitHub account, not an organisation.

## 4. Deploy the API on Render
1. render.com > **New > Blueprint** > connect GitHub > choose the `farmaslog` repo. Render reads `render.yaml`.
2. It asks for four values:

| Variable | What to enter |
|---|---|
| `MONGODB_URI` | the Atlas string from step 2 |
| `CORS_ORIGINS` | `https://example.com` for now (you fix this in step 6) |
| `BOOTSTRAP_ADMIN_EMAIL` | your admin email |
| `BOOTSTRAP_ADMIN_PASSWORD` | at least 12 characters. This creates your first admin on first start |

3. **Apply**. Wait for the deploy to go live (a few minutes), then copy the service URL (like `https://farmaslog-api.onrender.com`).
```bash
API=https://farmaslog-api.onrender.com      # use YOUR url
curl -s $API/health                         # {"status":"ok"}  (the first call after sleep takes about a minute)
curl -s $API/ready                          # {"status":"ready"} means the database connected
```
Swagger docs are at `$API/docs`. If `/ready` says `not_ready`, see Troubleshooting.

## 5. Deploy the web on Vercel
**Dashboard way:** vercel.com > **Add New > Project** > import the repo > set **Root Directory** to `web` > Framework Preset **Other** > add the environment variable `FARMASLOG_API_URL` = your Render URL (https, no trailing slash) > **Deploy**.

**CLI way:**
```bash
npm i -g vercel
cd farmaslog/web
vercel login
vercel link                                  # create/link a project; accept the defaults
vercel env add FARMASLOG_API_URL production  # paste your Render URL when asked
vercel --prod
```
Copy the production URL (like `https://farmaslog-xyz.vercel.app`). If the page shows the orange **Demo mode** banner, the variable was missing at build time: add it and redeploy (`vercel --prod`, or Deployments > Redeploy).

## 6. Connect them (CORS)
The API only accepts browser calls from origins you list. In Render > your service > **Environment**, set:
```
CORS_ORIGINS=https://farmaslog-xyz.vercel.app
```
Add more origins comma-separated (a custom domain, a preview URL you will present from). Saving redeploys the API.

## 7. Check it works
```bash
# a) Sign in on the Vercel site with your bootstrap admin: you should land on the Welcome page.
# b) End-to-end test of the live API (creates clearly-labelled synthetic test data in your database):
cd farmaslog/api
BASE_URL=https://farmaslog-api.onrender.com \
SMOKE_ADMIN_EMAIL=you@example.com SMOKE_ADMIN_PASSWORD='your-bootstrap-password' \
npm run smoke
```
Expect `20/20 checks passed`.

## 8. Run the demo flow
```bash
API=https://farmaslog-api.onrender.com
TOKEN=$(curl -s $API/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-bootstrap-password"}' | jq -r .token)

# 1. Someone requests access on the Vercel site (Request access). Then you list pending organisations:
curl -s "$API/v1/partners?status=pending" -H "Authorization: Bearer $TOKEN" | jq '.data[] | {_id, organization}'

# 2. Approve one:
PID=PASTE_THE__id_HERE
curl -s -X POST $API/v1/partners/$PID/approve -H "Authorization: Bearer $TOKEN" | jq .status

# 3. Give that partner an API key (shown once; copy it now):
curl -s -X POST $API/v1/partners/$PID/api-keys -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"demo key","mode":"test","plan":"free"}' | jq -r .apiKey
```
To have a record to verify, load the synthetic demo farmer from your laptop (it writes to the same Atlas database). It defaults to Awe, Nasarawa, but **any area works**: add e.g. `-- --state=Kano --lga=Gwale --community=Gwale --crop=Sorghum` to demo another state:
```bash
cd farmaslog/api
MONGODB_URI='your-atlas-string' npm run seed -- --demo     # prints demo logins and a test API key once
KEY=PASTE_THE_API_KEY
curl -s "$API/v1/verify?phone=08000000001&state=Nasarawa&lga=Awe" -H "Authorization: Bearer $KEY" | jq
```
The seed's farmer is synthetic ("Micheal Ahile (TEST)") and is labelled `synthetic: true` in the response.

## 9. Before you present
- Open the API URL (`$API/health`) about two minutes beforehand so it is awake.
- Do a full dry run: sign up, approve, key, verify.
- Have the demo-mode site as a fallback: deploy a second Vercel project from the same `web` folder **without** `FARMASLOG_API_URL`.

## 10. Before real use (not for the demo)
- Render: move to a paid instance (always on, from about $7/month) and attach a persistent disk, or store files in object storage.
- Vercel: use a paid plan once this is a commercial product.
- Atlas: paid tier with backups; restrict network access; rotate the database password.
- Remove `ALLOW_SYNTHETIC` and the `BOOTSTRAP_ADMIN_*` variables; use a separate database for real data.
- Finalise consent wording, data-sharing agreements and data-protection duties before collecting real farmer records.
- Custom domains, monitoring/uptime alerts, and a backup/restore test.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Site shows "Demo mode" | `FARMASLOG_API_URL` was not set at build time. Add it in Vercel and redeploy |
| Browser console: CORS error / sign-in says "Cannot reach the server" | `CORS_ORIGINS` on Render must exactly match your Vercel URL (https, no trailing slash). Redeploy after saving. The API may also be waking up: wait a minute |
| `/ready` is `not_ready`, logs show `MongooseServerSelectionError` | Atlas Network Access must allow 0.0.0.0/0, and the user/password in `MONGODB_URI` must be right (URL-encode special characters) |
| Render deploy fails with a missing variable | Set `MONGODB_URI`; `JWT_SECRET` and `LOOKUP_HMAC_SECRET` are generated automatically |
| Sign-in says "waiting for approval" | Approve the organisation (step 8) |
| Smoke test: `SYNTHETIC_NOT_ALLOWED` | `ALLOW_SYNTHETIC` must be `true` on Render (it is in `render.yaml`) |
| Bootstrap admin was not created | `BOOTSTRAP_ADMIN_PASSWORD` needs 12+ characters, and it only works while no super admin exists. Or run `npm run seed` from your laptop with `MONGODB_URI` and `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` |
| First request is very slow | Normal on Render's free plan after 15 minutes idle |
