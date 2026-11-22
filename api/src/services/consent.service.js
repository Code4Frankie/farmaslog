import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from './audit.service.js';
import { CURRENT_CONSENT_VERSION, isLegacyVersion, renderConsent } from '../config/consent.js';

export const consentValues = () => env.consent;

export function getConsent({ version = CURRENT_CONSENT_VERSION, language = 'en' } = {}) {
  return renderConsent({ version, language, values: consentValues() });
}

/** Build the stored consent sub-document from validated input. Server time and recorder are always set here. */
export function buildConsentRecord(input, ctx) {
  const now = new Date();
  const legacy = isLegacyVersion(input.wordingVersion);
  const rendered = legacy ? null : getConsent({ version: input.wordingVersion, language: input.language });
  return {
    consent: {
      given: true,
      wordingVersion: input.wordingVersion,
      purpose: input.purpose,
      capturedAt: input.capturedAt || now,
      language: input.language,
      textLanguage: rendered?.textLanguage ?? input.textLanguage,
      method: input.method,
      recordedAt: now,
      recordedBy: ctx.actor?.id ?? null,
      partnerSharing: input.partnerSharing,
      mediaStorage: !!input.mediaStorage,
      textHash: rendered ? crypto.createHash('sha256').update(rendered.text).digest('hex') : undefined,
    },
    consentStatus: legacy ? 'needs_reconsent' : 'valid',
  };
}

export async function withdrawConsent(farmer, { reason } = {}, ctx) {
  if (farmer.consentStatus === 'withdrawn') throw new AppError(409, 'ALREADY_WITHDRAWN', 'Consent was already withdrawn for this record.');
  const from = farmer.consentStatus || 'valid';
  farmer.consentStatus = 'withdrawn';
  farmer.consentWithdrawnAt = new Date();
  farmer.consentWithdrawnBy = ctx.actor?.id;
  farmer.consentWithdrawalReason = reason || undefined;
  await farmer.save();
  // The reason is free text and may contain personal details, so the audit entry records only that one was given.
  await writeAudit(ctx, { action: 'farmer.consent.withdrawn', entityType: 'Farmer', entityId: farmer._id, changes: { consentStatus: { from, to: 'withdrawn' }, reasonGiven: !!reason } });
  return farmer;
}

export async function recordReconsent(farmer, consentInput, ctx) {
  const from = farmer.consentStatus || 'valid';
  const rec = buildConsentRecord(consentInput, ctx);
  farmer.consent = rec.consent;
  farmer.consentStatus = rec.consentStatus;
  farmer.consentWithdrawnAt = undefined;
  farmer.consentWithdrawnBy = undefined;
  farmer.consentWithdrawalReason = undefined;
  await farmer.save();
  await writeAudit(ctx, { action: 'farmer.consent.recorded', entityType: 'Farmer', entityId: farmer._id, changes: { consentStatus: { from, to: farmer.consentStatus }, wordingVersion: rec.consent.wordingVersion, language: rec.consent.language, method: rec.consent.method } });
  return farmer;
}
