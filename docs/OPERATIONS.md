# FarmasLog operations

(Grows each phase. Phase 9 adds SMS/captcha settings and the field-agent QA checklist.)

## Consent

**Fill in the consent text.** Set these in Render > Environment, then redeploy. Until all are set the consent text shows `[bracketed]` gaps and the web app warns staff not to use it with real farmers.

| Variable | Fills |
|---|---|
| `CONSENT_REGISTERED_ADDRESS` | [registered address] |
| `CONSENT_CONTACT_EMAIL` | [email] |
| `CONSENT_CONTACT_PHONE` | [phone number] (also used in the agent read-aloud script) |
| `CONSENT_CONTACT_WHATSAPP` | [WhatsApp number] |
| `CONSENT_RETENTION_PERIOD` | [retention period], e.g. `2 years` |
| `CONSENT_HOSTING` | [hosting provider/country] |

Check: `GET /v1/reference/consent` returns `"incomplete": false`.

**Translations.** Hausa, Yoruba, Igbo, Tiv and Pidgin are placeholders in `api/src/config/consent.js` and are served in English (flagged `needsTranslation`). Replace one only after a person has translated it and a second person has back-translated it. Changing wording means a new version key, not editing `consent-v1-draft`.

**Legacy records.** On every start the API flags records using `console-draft-v0` or `qservers-form-v1` as `needs_reconsent` (also `npm run migrate:consent`). Nothing is deleted or hidden. Filter the Farmers list by Consent > Needs re-consent; an agent visits and uses Record consent. To hide such records from partners set `HIDE_NEEDS_RECONSENT=true`.

**Withdrawal.** Farmers list > Withdraw consent (or `POST /v1/farmers/:id/consent-withdrawal`). The record is hidden from partner verification at once and cannot be approved, enriched or field-verified. Fresh consent (Record consent) reverses it.

**Erasure (manual, super admin).** Withdrawal does not delete data. When a farmer asks for deletion: confirm identity through the record's phone, withdraw consent, then delete the `Farmer`, its `Farm` and the uploaded files (`UPLOAD_DIR/<farmerId>`) in Atlas, and write down the date and who did it. Audit entries are kept; they hold IDs and field names, not personal details.


## One-time codes (SMS) and captcha
Farmers prove they control a phone number with a 6-digit code sent by text message. Nothing in the API works until these are set on Render.

**Termii (SMS)**
1. Create a Termii account, add credit, and copy the API key into `TERMII_API_KEY`.
2. Register the sender ID `FarmasLog` in the Termii dashboard (Sender ID section). Approval can take a few days. Until it is approved, messages may not arrive. `TERMII_SENDER_ID` must match the approved name exactly.
3. Leave `TERMII_CHANNEL=dnd`. The `generic` channel is cheaper but is blocked for numbers on Nigeria's Do-Not-Disturb list.
4. Without `TERMII_API_KEY` the API answers `503 SMS_UNAVAILABLE` in production. Nothing is recorded and no code is sent.

**Cloudflare Turnstile (captcha)**
1. In Cloudflare, Turnstile, add a widget for `farmaslog.vercel.app` (and your own domain later). Copy the secret key into `TURNSTILE_SECRET` on Render. The site key goes into the web page in Phase 5.
2. In production captcha is required. If `TURNSTILE_SECRET` is missing the API fails closed (`503 CAPTCHA_UNAVAILABLE`) rather than letting bots through. `CAPTCHA_REQUIRED=false` is for staging only.
3. Phase 5 will also loosen `web/vercel.json` Content-Security-Policy to allow `https://challenges.cloudflare.com`.

**Limits**: 10 code requests and 30 checks per IP per 15 minutes; per phone, one code every 30 seconds and 3 per hour; 5 wrong tries kill a code; a code lasts 10 minutes. Change with the `OTP_*` variables.

**Privacy**: the phone number and code are never logged or stored in the clear (only keyed hashes). Audit entries hold the purpose and a short hash reference. The API answers the same for numbers that are on FarmasLog and numbers that are not.

**Website (Vercel)**: add `FARMASLOG_TURNSTILE_SITE_KEY` (the Turnstile *site* key, which is public) in the Vercel project settings, then redeploy with `cd web && npx vercel --prod`. Without it the farmer form shows no security check, and in production the API will refuse code requests (captcha required). Self-registered farmers appear in the Farmers list as "Pending review" with source `self_registration`; approve them like any other record.

## Offline register (field agents)
- Agents must open the site once with signal, sign in, and visit the Register tab. That saves the app, the area list and the consent text on the phone. After that the app opens with no signal.
- Farmers registered with no signal are kept in the browser's storage on that phone and upload by themselves when it is online again (or from "Upload now" on the Register or My work tab). Tell agents: use one browser, do not clear its data, and do not sign out until the box says nothing is waiting.
- The phone's clock matters: it dates the farmer's consent. A phone clock that is more than 10 minutes ahead makes the upload fail with a message to fix the date.
- This keeps farmers' personal details on the agent's phone until upload. Ask agents to use a phone lock screen. Later we can add encryption at rest or an installable app.
- After a deploy the app updates itself next time the phone has signal (the service worker checks the network first).
