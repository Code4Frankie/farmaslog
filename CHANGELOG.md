# Changelog

## Consent wording editor and website pages
- Administrators can now write and publish the consent text from the dashboard. New tab **Consent text** (super admin edits; data manager reads): start a draft (a copy of the English text in use), edit title, sections, tick-box wording and the read-aloud script, one language at a time, see a live preview, then publish.
- Versioned and immutable: a published version can never be edited (start a new one). Each consent already on record keeps its version and the hash of the exact text shown. Only one draft at a time.
- Translations: a language is served only when marked reviewed (with the reviewer's name, "translated and back-translated"). Until then farmers get English, as before.
- Publishing asks what happens to existing farmers: `none`, or `flag` (valid consents on older wordings become `needs_reconsent`; withdrawn stays withdrawn). It is refused while contact details (address, retention, hosting...) are still missing, so a farmer never sees "[retention period]". Only the six known placeholders may be used.
- New consents must use the version now in force (`wordingVersion` is checked on every request; the built-in `consent-v1-draft` is the starting point). Legacy wordings are accepted for imports as before.
- New tab **Pages** and public `#/privacy` and `#/terms` pages (footer links). Starter wording is provided as a draft, nothing is public until saved and published; each publish is a new version and earlier ones are kept. Visitors see "being finalised" until then. Have a lawyer review the starter text before publishing.
- API: `/v1/admin/consent-texts` (list, create draft, get, save language, remove language, discard, publish), `/v1/admin/pages` (list, get, save, publish), public `GET /v1/reference/pages/{slug}`. Audit: `consent_text.draft_created|draft_updated|draft_discarded|published`, `page.draft_saved|published` (version, language and counts only, never the text).
- Tests: `tests/integration/consent-texts.test.js`, `tests/integration/pages.test.js`.
- Note: published wordings are cached in memory at start-up. With more than one API instance, restart after publishing (the free Render plan runs one).

## Phase 7: Offline register
- Field agents can register farmers with no signal. The app (service worker `web/sw.js`) reopens offline, the consent text for every language is kept on the phone, and a farmer saved offline waits in the browser's storage ("Saved on this phone") until the phone has signal. It then uploads by itself, or with "Upload now". Agents stay signed in on the phone (until the 8-hour sign-in expires) so the app can open without signal.
- `POST /v1/farmers/sync` (up to 25 records): each record is the usual registration plus `clientId` and `capturedAt`. The server sets source (`field_agent`), channel (`field_app`) and the reference (`app:<agentId>:<clientId>`), so uploading twice, or an online retry after a lost answer, never creates two farmers. Each record gets its own result (`created`, `already_synced`, `duplicate_review`, `error`); a bad record never blocks the others. Consent is dated `capturedAt` and stamped with the server's `recordedAt`. A capture time in the future (more than 10 minutes) or older than 120 days is refused.
- `POST /v1/farmers` by a field agent: `sourceRef` must be in the agent's own `app:` namespace; source and channel are forced.
- Everything else is unchanged: offline records arrive as `pending_review`, are reviewed by a data manager, duplicates wait in duplicate review, and only a farm visit makes a record "verified". Audit: each farmer as before, plus one `farmer.offline_sync` summary with counts only.
- Limits: unsent farmers live on that phone, in that browser. Clearing browser data, a different browser, or a lost phone loses them. Signing out with unsent farmers asks first.
- Tests: `tests/integration/offline-sync.test.js`.

## Phase 6: Agent console
- `GET /v1/agent/summary` and `GET /v1/agent/visits?scope=mine|area|all` (field agents only). Summary: registrations by status, farms waiting for a visit, farms verified by me, records needing new consent, and my patch. Visits: approved farmers whose farm has no confirming visit and who have not withdrawn consent, longest waiting first.
- A field agent's patch is the state (and optional LGA) on their account. Within it they can now open and field-verify approved farmers registered by others, including farmers who registered themselves on the website. They still cannot change consent or files on records they did not register, and the Farmers list is still their own registrations only. An agent with no state set has no patch.
- Only a visit by an agent sets "verified"; nothing else changed in the review flow. Field verifications are audited with the agent as actor, as before.
- Web: new "My work" tab for field agents: tiles, farms to visit (All / Mine / My patch) with "Verified on site" and "Not confirmed".
- Tests: `tests/integration/agent.test.js`.

## Phase 5: Public farmer registration
- `POST /v1/public/registrations`: a farmer registers themselves after verifying their phone by one-time code (`phoneProof`, purpose `register`). The record is created like an agent's: `pending_review`, source `self_registration`, channel `web_form`, consent method `self_checkbox`, no FarmasLog ID until a data manager approves, and never "verified" without a field visit. Review flow unchanged.
- Consent must be in the current wording. `partnerSharing: false` is accepted and keeps the farmer hidden from partners.
- Optional farm location is stored as a farmer pin; optional inclusion answers are staff-only.
- BVN, NIN, date of birth and photos are refused with `400`.
- Never reveals existence: the answer is always `202 { status: "received", reference }`. A possible duplicate waits in duplicate review. A phone can register at most 5 records a day (extras look accepted but are not stored). 8 submissions per hour per IP.
- Web: the "Farmers: register" page is now the form (phone, code, details and optional questions, consent, thank-you with reference). Cloudflare Turnstile loads when `FARMASLOG_TURNSTILE_SITE_KEY` is set on Vercel. `web/vercel.json` CSP allows `https://challenges.cloudflare.com` for scripts and frames.
- Tests: `tests/integration/public-registration.test.js`.

## Phase 4: One-time codes (OTP) and SMS
- `POST /v1/public/otp/request` and `POST /v1/public/otp/verify` (no sign-in; purposes `register` and `access`). A correct code returns `phoneProof`, a signed 15-minute token that Phase 5 (self-registration) and Phase 8 (farmer view and correction) will require via `requirePhoneProof(proof, phone, purpose)`.
- Never reveals anything about a number: `request` answers the same `202` for any valid Nigerian number, and the 30-second cooldown and 3-per-hour limit are applied silently. Every code failure is the same `400 INVALID_CODE`.
- Codes: 6 digits, 10 minutes, one use, 5 tries, a new code replaces the old one. Phone and code are stored only as keyed hashes (`otps` collection, TTL-cleaned). Per-IP rate limits on both endpoints. Audit: `otp.requested`, `otp.request_limited`, `otp.verified`, `otp.locked` with purpose and a short hash reference, never the number or code.
- SMS service (`sms.service.js`): Termii provider (`TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_CHANNEL`), in-memory outbox for tests and local development, fails with `503 SMS_UNAVAILABLE` in production when unconfigured. If the provider fails nothing is recorded, so the person can retry at once. Nothing about the message is logged.
- Captcha (`captcha.service.js`): Cloudflare Turnstile, required in production, fails closed without `TURNSTILE_SECRET`.
- Tests: `tests/unit/sms.test.js`, `tests/integration/otp.test.js`. Setup steps in `docs/OPERATIONS.md`.

## Consent details editable, with FarmasLog contact defaults
- The consent text's contact details now default to the published ones (phone 0802 863 8349, WhatsApp 0706 758 4686, email info@frankiecode.org.ng). Address, retention period and hosting still show as [bracketed] gaps until set.
- `GET /v1/admin/consent-details` (super admin, data manager, auditor) and `PUT /v1/admin/consent-details` (super admin only, audited). Saved values beat `CONSENT_*` env vars, which beat the defaults. An empty string removes a saved value. Stored in a new `settings` collection, loaded at startup.
- New consents use the new text and hash; consents already recorded keep the hash of the text the farmer saw.
- Web: new "Consent info" tab (administrator edits with an Edit button; data managers read only). Site footer shows the phone and email.
- Tests: `tests/integration/consent-details.test.js`.

## Phase 3: Inclusion fields and statistics
- New optional, voluntary fields on a farmer: `inclusion.gender` (`female` | `male` | `other` | `prefer_not_to_say`), `inclusion.ageBand` (`18_24` ... `65_plus`, `prefer_not_to_say`) and `inclusion.disability` (`none` | `yes` | `prefer_not_to_say`). Age is a band, never a date of birth. Accepted on registration and `PATCH /v1/farmers/:id` (only the fields sent change; audited).
- Staff-only: never returned by `/v1/verify`, never used for matching, billing or eligibility.
- `GET /v1/admin/inclusion-stats` (super admin, data manager, auditor): aggregate counts by gender, age band and disability, optional `state`/`lga` filter and `groupBy=state|lga`. Rejected and withdrawn records are excluded; unanswered shows as `not_recorded`. Groups of 1 to 4 are hidden (`count: null, suppressed: true`), and a lone hidden group is protected from subtraction by also hiding the smallest visible group.
- Web: "About the farmer (optional)" on the Register screen.
- Tests: `tests/integration/inclusion.test.js`.

## Phase 2: Optional phone, contact person, shared phones
- A farmer no longer needs a phone. Registration needs the farmer's `phone` OR a `contactVia` (`farmer` | `relative` | `cooperative_leader` | `agent`, with name, phone, relationship). The FarmasLog ID is the identity key. A contact person's number is never used to look the farmer up.
- A phone may be shared. The "one active farmer per phone" unique index is dropped by a startup migration (`migrations/phone.js`). `sharedPhone` is set automatically on both records when a different person uses the same number, and a data manager can correct it (`PATCH /v1/farmers/:id`).
- Duplicates are judged on name + LGA + phone together (with no phone: name + LGA + community). A true duplicate goes to duplicate review without an ID; approving it while the original is active is still blocked.
- `GET /v1/verify` by phone: when several approved records match, it returns `409 MULTIPLE_RECORDS` (not billed, reveals nothing about the records). Add `state`/`lga` or use `farmaslogId`. A single match behaves as before.
- Phone can be removed with `PATCH {phone: null}` only if a contact person remains.
- Web: phone optional on the Register screen with a contact-person section; Farmers list shows "Contact: ..." / "No phone", a "Shared phone" tag, and a data-manager "Phone is shared" toggle.
- Tests: `tests/integration/phone.test.js`. Existing journey/smoke/webform fixtures now use a same-name duplicate.

## Phase 1: Consent
- Versioned consent texts in `api/src/config/consent.js` (`consent-v1-draft`; ha/yo/ig/tiv/pcm are placeholders and fall back to English). Contact, retention and hosting details come from `CONSENT_*` env vars and show as [bracketed] gaps until set.
- `GET /v1/reference/consent?lang=` (public). Returns `{ version, language, textLanguage, text, sections, agreements, readAloud, incomplete }`.
- Farmer consent now stores language, method, server `recordedAt`, `recordedBy`, `partnerSharing`, `mediaStorage` and a hash of the text shown. Unknown `wordingVersion` values are rejected.
- `consentStatus` (`valid` | `needs_reconsent` | `withdrawn`). Startup migration (also `npm run migrate:consent`) flags records using `console-draft-v0` / `qservers-form-v1`. Nothing is deleted or hidden by it.
- `POST /v1/farmers/:id/consent-withdrawal` and `POST /v1/farmers/:id/reconsent`. Withdrawn records vanish from `/v1/verify` and cannot be approved, enriched or field-verified. Audited; the reason text never enters the audit log.
- `/v1/verify` also hides farmers who declined partner sharing, and (only if `HIDE_NEEDS_RECONSENT=true`) records needing re-consent.
- Web: Register screen loads the consent text from the API with language picker, read-aloud script, three agreements; Farmers list shows consent flags with Record consent / Withdraw consent actions.
