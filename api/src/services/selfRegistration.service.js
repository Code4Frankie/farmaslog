import crypto from 'node:crypto';
import { Farmer } from '../models/Farmer.js';
import { registerFarmer } from './farmer.service.js';
import { requirePhoneProof } from './otp.service.js';

const DAY = 24 * 3600_000;
export const MAX_SELF_REGISTRATIONS_PER_PHONE_PER_DAY = 5;
// No 0/O/1/I so a reference read out over the phone is not misheard.
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newReference = () => Array.from(crypto.randomBytes(8), (b) => REF_CHARS[b % REF_CHARS.length]).join('');

/**
 * A farmer registers themselves. The phone must have been verified by a one-time code (phoneProof).
 * The record is created exactly like an agent's: pending review, no FarmasLog ID until a data manager approves it, and it can
 * never be "verified" without a field visit. The answer is the same whether or not the farmer is already on FarmasLog:
 * a possible duplicate just waits in duplicate review, and the caller is never told.
 */
export async function submitSelfRegistration(input, ctx) {
  const phone = requirePhoneProof(input.phoneProof, input.phone, 'register');
  const reference = newReference();
  const received = { status: 'received', reference };

  // A cap per phone per day. Over the cap the answer looks the same, but nothing is stored.
  const recent = await Farmer.countDocuments({ phoneNormalized: phone, source: 'self_registration', createdAt: { $gte: new Date(Date.now() - DAY) } });
  if (recent >= MAX_SELF_REGISTRATIONS_PER_PHONE_PER_DAY) return received;

  await registerFarmer({
    name: input.name, phone,
    state: input.state, lga: input.lga, ward: input.ward || undefined, community: input.community || undefined,
    inclusion: input.inclusion,
    consent: { ...input.consent, method: 'self_checkbox', purpose: 'Farmer and farm verification' },
    source: 'self_registration', sourceChannel: 'web_form', sourceRef: `self:${reference}`,
    farm: {
      crop: input.crop, reportedAreaHa: input.reportedAreaHa,
      location: input.location ? { ...input.location, source: 'farmer_pin' } : undefined,
    },
  }, ctx);
  return received;
}
