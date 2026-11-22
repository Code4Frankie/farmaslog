# Changelog

## Phase 1: Consent
- Versioned consent texts in `api/src/config/consent.js` (`consent-v1-draft`; ha/yo/ig/pcm are placeholders and fall back to English). Contact, retention and hosting details come from `CONSENT_*` env vars and show as [bracketed] gaps until set.
- `GET /v1/reference/consent?lang=` (public). Returns `{ version, language, textLanguage, text, sections, agreements, readAloud, incomplete }`.
- Farmer consent now stores language, method, server `recordedAt`, `recordedBy`, `partnerSharing`, `mediaStorage` and a hash of the text shown. Unknown `wordingVersion` values are rejected.
- `consentStatus` (`valid` | `needs_reconsent` | `withdrawn`). Startup migration (also `npm run migrate:consent`) flags records using `console-draft-v0` / `qservers-form-v1`. Nothing is deleted or hidden by it.
- `POST /v1/farmers/:id/consent-withdrawal` and `POST /v1/farmers/:id/reconsent`. Withdrawn records vanish from `/v1/verify` and cannot be approved, enriched or field-verified. Audited; the reason text never enters the audit log.
- `/v1/verify` also hides farmers who declined partner sharing, and (only if `HIDE_NEEDS_RECONSENT=true`) records needing re-consent.
- Web: Register screen loads the consent text from the API with language picker, read-aloud script, three agreements; Farmers list shows consent flags with Record consent / Withdraw consent actions.
