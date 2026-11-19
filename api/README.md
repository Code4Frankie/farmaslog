# FarmasLog-API

Farmer and farm verification service from the Frankiecode Solutions PRD (v1.0, 28 Oct 2026).
Node.js (ES modules) + Express + MongoDB/Mongoose. Pilot: Ihugh, Vandeikya LGA, Benue State.

## Run it

```bash
cp .env.example .env          # set JWT_SECRET and LOOKUP_HMAC_SECRET for anything beyond local dev
npm install
npm run seed -- --demo        # super admin + synthetic Micheal/Nancy journey; credentials and a test API key are printed ONCE
npm run dev                   # http://localhost:3000/docs  (Swagger UI)
```

Try the partner call with the key the seed printed:

```bash
curl -H "Authorization: Bearer sk_test_..." \
  "http://localhost:3000/v1/verify?phone=08000000001&state=Benue&lga=Vandeikya"
```

## Testing the API

Four layers, from fastest to most realistic:

| Layer | Command | Needs |
|---|---|---|
| Unit tests (rules, adapter, keys, signatures) | `npm run test:unit` | nothing |
| Integration tests (full journey, import, webhook, limits) | `npm test` | downloads a MongoDB binary via mongodb-memory-server, **or** `npm run test:db` against your own MongoDB (`docker compose up -d mongo`) |
| Smoke test against a running API | `npm run smoke` | a running API + a super_admin login |
| Partner/manual testing | Swagger at `/docs`, Postman collection in `postman/` | a test API key |

```bash
# Local stack (Docker): API + MongoDB, with a known admin password for testing only
docker compose up -d --build
docker compose exec api node scripts/seed.js --demo        # prints test logins and an API key once
BASE_URL=http://localhost:3000 SMOKE_ADMIN_EMAIL=admin@farmaslog.local \
  SMOKE_ADMIN_PASSWORD=local-test-admin-password npm run smoke
```

The smoke test registers a synthetic farmer, checks duplicate handling, review, verification, field verification and the 400/401/404 cases, and exits non-zero on any failure. It works against Render staging too (see `../render.yaml` and `../DEPLOY.md`; needs `ALLOW_SYNTHETIC=true` there, never on real production).

Status when this was written: 67 unit tests, 28 integration tests and the 19-check smoke test all passed, run against a MongoDB-compatible stand-in (FerretDB). Two things need real MongoDB to confirm: the usage-report aggregation (one test is skipped on the stand-in) and the partial unique indexes (a backstop for one-active-record-per-phone; the same rule is also enforced in code). `TEST_DB_COMPAT=no-partial-indexes` exists only for such stand-ins.

## Importing the website's CSV

```bash
npm run sample                                                   # regenerate the synthetic, deliberately messy fixture
node scripts/import-webform.js export.csv --dry-run             # map and validate only; no database needed
node scripts/import-webform.js export.csv                       # import; records land as pending_review
```

- Maps the form's columns to the API: first+last name joined, phone to +234 format, acres to hectares, LGA/state typos corrected against the Benue list (23 LGAs), wardOrCommunity stored as `community`, formula characters stripped from names.
- Typed coordinates are kept as `farmer_reported` and treated as **weak** evidence until a field agent confirms them; out-of-Nigeria or half-filled coordinates are dropped with a warning, not fatal.
- Idempotent: each row keeps the website's `farmerId` as `sourceRef`, so re-importing a cumulative export skips rows already imported.
- Rejected rows go to a `.rejects.csv` with reasons; fix and re-run.
- Nothing is approved by the import. A data manager approves via `POST /v1/farmers/:id/review`.
- `consent.purpose` records what the original checkbox actually covers (registration and eligibility for government programmes). It does not cover sharing with banks or insurers, so keep that in mind before onboarding such partners.
- `programmeRequested` is stored for staff only and is never returned by `/v1/verify`.

## How the PRD maps to code

| PRD | Where |
|---|---|
| FR-01/02 registration, consent, dedup | `services/farmer.service.js`: duplicates get `duplicate_review` and no ID; approval is blocked while another active record has the phone; nothing is merged silently |
| FR-03/05 evidence, never conflated | `models/Farm.js` keeps reported vs estimated area separate; `services/evidence.service.js` holds every status rule |
| FR-04 `/v1/verify` | `routes/verify.routes.js` and `services/verification.service.js` (200/400/401/403/404/429, `requestId` on every response) |
| FR-06 roles | `middleware/auth.js`; field agents only see their own registrations; partners only see their own usage |
| FR-07 metering | `VerificationLog` row per request; billable only on 200; `GET /v1/usage` aggregates by partner, plan and period |
| FR-08 Paystack | `routes/webhook.routes.js`, `services/paystack.service.js`: raw-body HMAC-SHA512, event-ID idempotency, server-side verify, retry-safe |
| FR-09 docs | `/docs` (OpenAPI), `npm run postman` -> `postman/` |
| Section 9 security | hashed API keys (shown once, rotate/revoke), per-key and per-IP limits, Joi, helmet, audit log, no phone numbers in logs |

## Partner sign-up and approval

`POST /v1/auth/signup` lets an organisation request access (creates a pending partner and user). Sign-in is refused with `ACCOUNT_PENDING` until a super admin approves it: `GET /v1/partners?status=pending`, then `POST /v1/partners/{id}/approve`. Approved users can sign in; API keys are still issued by a super admin. The web front end in `farmaslog-web` uses these endpoints. Emails are not sent yet.

## Decisions I made where the PRD was silent (change freely)

- **`verificationStatus`**: `verified` only after a field review; `review_required` when evidence conflicts; otherwise `record_found`. A satellite signal alone never produces `verified`.
- **Open decision 3 (coordinates)**: partners get a location summary only. Exact coordinates need both `VERIFY_INCLUDE_COORDINATES=true` and a key with the `coordinates:read` scope.
- **Pending, duplicate and rejected records** are invisible to partners (404).
- **Partners can use a record without agent-confirmed GPS.** Approval (identity and duplicate check) is what makes a record verifiable, not GPS. `/v1/verify` returns `locationConfirmation` (`confirmed_by_field_agent` / `unconfirmed` / `not_provided`) and `limitations`, so each bank or programme applies its own policy: e.g. accept `self_reported` for small amounts and require `field_verified` for larger ones.
- **Typed coordinates are weak.** Coordinates entered by a farmer (`farmer_reported`), geocoded points and coarse fixes never count as parcel-level evidence. A satellite result on such a location is set aside and the record stays `self_reported`; it is not pushed into review.
- **Plans/limits**: free = 50 checks/month, 60 req/min; payg 60; growth/enterprise 300. Per-key override available. Free-quota overage returns 429 `QUOTA_EXCEEDED`.
- **Confidence** numbers are a simple documented heuristic in `evidence.service.js`, to be calibrated with pilot data.
- **Logs** store an HMAC of the lookup value, not the phone; audit entries redact name, phone and location values.

## Not built yet (stubs or out of scope)

- **Satellite and geocoding providers**: interfaces and honest "not configured" states exist (`services/enrichment/providers.js`); pick a provider (open decision 2) and implement `analyze()`. Parcel boundaries/GPS tracks for area estimation are not modelled yet.
- **Billing**: usage is metered; there is no invoicing, tier pricing, overage rules or unpaid-account grace period (open decision 4).
- **Escrow**: intentionally absent until legal/compliance approval (open decision 6).
- **Uploads** are stored on local disk. Render's disk is ephemeral, so use a persistent disk or object storage with signed URLs before the pilot.
- **Partner portal UI**, retention/deletion jobs, correction workflow, backups and monitoring.
- Duplicate detection is by phone only (no fuzzy name matching yet).
