import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Otp } from '../models/Otp.js';
import { AppError } from '../utils/AppError.js';
import { normalizeNigerianPhone } from '../utils/phone.js';
import { lookupHash } from '../utils/lookupHash.js';
import { sendSms } from './sms.service.js';
import { writeAudit } from './audit.service.js';

const HOUR = 3600_000;
const AUDIENCE = 'farmaslog-phone-proof';
export const OTP_PURPOSES = ['register', 'access'];

const phoneRef = (phone) => lookupHash('otp-phone', phone);
const codeHash = (ref, purpose, code) => crypto.createHmac('sha256', env.lookupHmacSecret).update(`otp:${ref}:${purpose}:${code}`).digest('hex');
const same = (a, b) => { const x = Buffer.from(a || ''); const y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function messageFor(code) {
  return `FarmasLog code: ${code}. It works for ${env.otp.ttlMinutes} minutes. Do not share it with anyone.`;
}

/**
 * Send a one-time code to a Nigerian mobile number. It works the same whether or not the number is on FarmasLog, and
 * limits (cooldown, sends per hour) are applied silently, so the caller can never learn anything about the number.
 * Returns only { resendAfterSeconds }.
 */
export async function requestOtp({ phone, purpose }, ctx) {
  const e164 = normalizeNigerianPhone(phone);
  if (!e164) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Nigerian mobile number.');
  const ref = phoneRef(e164);
  const now = Date.now();
  const { resendSeconds, maxSendsPerHour, ttlMinutes } = env.otp;

  let row = await Otp.findOne({ phoneHash: ref, purpose });
  if (row && now - row.windowStartedAt.getTime() >= HOUR) { await Otp.deleteOne({ _id: row._id }); row = null; }
  const coolingDown = row?.lastSentAt && now - row.lastSentAt.getTime() < resendSeconds * 1000;
  if (coolingDown || (row && row.sendCount >= maxSendsPerHour)) {
    await writeAudit(ctx, { action: 'otp.request_limited', entityType: 'Otp', changes: { purpose, phoneRef: ref.slice(0, 12) } });
    return { resendAfterSeconds: resendSeconds };
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const windowStartedAt = row?.windowStartedAt ?? new Date(now);
  // Send first: if the provider fails, nothing is recorded, so the person can try again at once.
  await sendSms(e164, messageFor(code));
  await Otp.findOneAndUpdate(
    { phoneHash: ref, purpose },
    {
      $set: { codeHash: codeHash(ref, purpose, code), codeExpiresAt: new Date(now + ttlMinutes * 60_000), attempts: 0, lastSentAt: new Date(now), windowStartedAt, expiresAt: new Date(windowStartedAt.getTime() + HOUR) },
      $inc: { sendCount: 1 },
    },
    { upsert: true },
  );
  await writeAudit(ctx, { action: 'otp.requested', entityType: 'Otp', changes: { purpose, phoneRef: ref.slice(0, 12) } });
  return { resendAfterSeconds: resendSeconds };
}

/**
 * Check a code. Every failure looks the same (wrong, expired, used, never sent, too many tries).
 * On success the code is burned and a short-lived proof token is returned that other endpoints can ask for.
 */
export async function verifyOtp({ phone, purpose, code }, ctx) {
  const fail = () => new AppError(400, 'INVALID_CODE', 'That code is not right or has expired. Request a new one.');
  const e164 = normalizeNigerianPhone(phone);
  if (!e164) throw fail();
  const ref = phoneRef(e164);
  const row = await Otp.findOne({ phoneHash: ref, purpose });
  if (!row?.codeHash || !row.codeExpiresAt || row.codeExpiresAt.getTime() < Date.now() || row.attempts >= env.otp.maxAttempts) throw fail();

  if (!same(row.codeHash, codeHash(ref, purpose, code))) {
    const updated = await Otp.findOneAndUpdate({ _id: row._id }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (updated.attempts >= env.otp.maxAttempts) await writeAudit(ctx, { action: 'otp.locked', entityType: 'Otp', changes: { purpose, phoneRef: ref.slice(0, 12) } });
    throw fail();
  }
  // Burn the code atomically so two simultaneous checks cannot both succeed.
  const burned = await Otp.findOneAndUpdate({ _id: row._id, codeHash: row.codeHash }, { $unset: { codeHash: 1, codeExpiresAt: 1 } });
  if (!burned) throw fail();
  await writeAudit(ctx, { action: 'otp.verified', entityType: 'Otp', changes: { purpose, phoneRef: ref.slice(0, 12) } });
  const expiresIn = env.otp.proofMinutes * 60;
  const proof = jwt.sign({ typ: 'phone_proof', purpose, ph: ref }, env.jwtSecret, { algorithm: 'HS256', audience: AUDIENCE, expiresIn });
  return { proof, expiresInSeconds: expiresIn };
}

/** For Phase 5 and 8: does this proof show that `phone` was verified for `purpose`? Throws 403 PHONE_NOT_VERIFIED if not. */
export function requirePhoneProof(proof, phone, purpose) {
  const deny = () => new AppError(403, 'PHONE_NOT_VERIFIED', 'Verify your phone number first.');
  const e164 = normalizeNigerianPhone(phone);
  if (!proof || !e164) throw deny();
  let p;
  try { p = jwt.verify(proof, env.jwtSecret, { algorithms: ['HS256'], audience: AUDIENCE }); } catch { throw deny(); }
  if (p.typ !== 'phone_proof' || p.purpose !== purpose || !same(p.ph, phoneRef(e164))) throw deny();
  return e164;
}
