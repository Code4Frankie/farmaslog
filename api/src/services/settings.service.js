import { env } from '../config/env.js';
import { Setting } from '../models/Setting.js';
import { PLACEHOLDERS } from '../config/consent.js';
import { writeAudit } from './audit.service.js';

const KEY = 'consentDetails';
export const CONSENT_DETAIL_KEYS = Object.keys(PLACEHOLDERS); // registeredAddress, email, phone, whatsapp, retention, hosting

// Saved overrides are cached in memory so the consent text can be built synchronously. They are loaded at startup and
// replaced whenever an administrator saves. Order of precedence: saved value, then CONSENT_* environment variable, then the
// built-in default (FarmasLog's published contact details).
let saved = {};

export async function loadSettings() {
  const row = await Setting.findOne({ key: KEY }).lean();
  saved = row?.value ?? {};
  return saved;
}

export function consentDetails() {
  const out = {};
  for (const k of CONSENT_DETAIL_KEYS) out[k] = (saved[k] ?? '').trim() || env.consent[k] || '';
  return out;
}

/** Same values plus where each one comes from, for the admin screen. */
export function consentDetailsView() {
  const values = consentDetails();
  return CONSENT_DETAIL_KEYS.map((k) => ({
    key: k, label: PLACEHOLDERS[k].label, value: values[k],
    source: (saved[k] ?? '').trim() ? 'saved' : env.consent[k] ? 'default' : 'missing',
  }));
}

/** patch: { key: string }. An empty string removes the saved value (falls back to the default). Only changed keys are audited. */
export async function updateConsentDetails(patch, ctx) {
  const before = consentDetails();
  const next = { ...saved };
  for (const [k, v] of Object.entries(patch)) {
    const t = String(v).trim();
    if (t) next[k] = t; else delete next[k];
  }
  await Setting.findOneAndUpdate({ key: KEY }, { value: next, updatedBy: ctx.actor?.id }, { upsert: true });
  saved = next;
  const after = consentDetails();
  const changed = CONSENT_DETAIL_KEYS.filter((k) => before[k] !== after[k]);
  if (changed.length) await writeAudit(ctx, { action: 'settings.consent_details_updated', entityType: 'Setting', entityId: undefined, changes: Object.fromEntries(changed.map((k) => [k, { from: before[k] || null, to: after[k] || null }])) });
  return { changed };
}
