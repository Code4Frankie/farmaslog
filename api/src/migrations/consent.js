import { Farmer } from '../models/Farmer.js';
import { AuditLog } from '../models/AuditLog.js';
import { LEGACY_VERSIONS } from '../config/consent.js';

/**
 * Flag every farmer whose consent used a pre-launch wording as `needs_reconsent`. Idempotent: records already flagged
 * (or withdrawn) are untouched, nothing is hidden or deleted. Returns the number flagged.
 */
export async function migrateConsent() {
  const filter = { 'consent.wordingVersion': { $in: LEGACY_VERSIONS }, $or: [{ consentStatus: { $exists: false } }, { consentStatus: 'valid' }] };
  const res = await Farmer.updateMany(filter, { $set: { consentStatus: 'needs_reconsent' } });
  const n = res.modifiedCount ?? 0;
  if (n) await AuditLog.create({ action: 'migration.consent_flagged', entityType: 'Farmer', entityId: 'bulk', changes: { count: n }, requestId: 'migration' });
  // Records with a current-version consent and no status simply default to 'valid'.
  await Farmer.updateMany({ consentStatus: { $exists: false } }, { $set: { consentStatus: 'valid' } });
  return n;
}
