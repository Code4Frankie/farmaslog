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

**Translations.** Hausa, Yoruba, Igbo and Pidgin are placeholders in `api/src/config/consent.js` and are served in English (flagged `needsTranslation`). Replace one only after a person has translated it and a second person has back-translated it. Changing wording means a new version key, not editing `consent-v1-draft`.

**Legacy records.** On every start the API flags records using `console-draft-v0` or `qservers-form-v1` as `needs_reconsent` (also `npm run migrate:consent`). Nothing is deleted or hidden. Filter the Farmers list by Consent > Needs re-consent; an agent visits and uses Record consent. To hide such records from partners set `HIDE_NEEDS_RECONSENT=true`.

**Withdrawal.** Farmers list > Withdraw consent (or `POST /v1/farmers/:id/consent-withdrawal`). The record is hidden from partner verification at once and cannot be approved, enriched or field-verified. Fresh consent (Record consent) reverses it.

**Erasure (manual, super admin).** Withdrawal does not delete data. When a farmer asks for deletion: confirm identity through the record's phone, withdraw consent, then delete the `Farmer`, its `Farm` and the uploaded files (`UPLOAD_DIR/<farmerId>`) in Atlas, and write down the date and who did it. Audit entries are kept; they hold IDs and field names, not personal details.
