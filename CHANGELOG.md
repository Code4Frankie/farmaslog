# Changelog

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
