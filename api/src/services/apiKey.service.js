import crypto from 'node:crypto';
import { ApiKey } from '../models/ApiKey.js';

// Format: sk_<test|live>_<8 hex id>_<43 char base64url secret>. Only SHA-256(secret) is stored.
const KEY_RE = /^(sk_(test|live)_[a-f0-9]{8})_([A-Za-z0-9_-]{43})$/;
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function generateKeyMaterial(mode) {
  const prefix = `sk_${mode}_${crypto.randomBytes(4).toString('hex')}`;
  const secret = crypto.randomBytes(32).toString('base64url');
  return { prefix, secret, fullKey: `${prefix}_${secret}`, secretHash: sha256(secret) };
}

export function parseKey(raw) {
  const m = KEY_RE.exec(raw || '');
  return m ? { prefix: m[1], mode: m[2], secret: m[3] } : null;
}

export function secretMatches(secret, storedHash) {
  const a = Buffer.from(sha256(secret), 'hex');
  const b = Buffer.from(storedHash || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createApiKey({ partnerId, name, mode = 'test', plan = 'free', scopes, rateLimitPerMinute, expiresAt, createdBy }) {
  const m = generateKeyMaterial(mode);
  const doc = await ApiKey.create({
    partnerId, name, mode, plan, rateLimitPerMinute, expiresAt, createdBy,
    ...(scopes ? { scopes } : {}),
    keyPrefix: m.prefix,
    secretHash: m.secretHash,
  });
  return { doc, fullKey: m.fullKey }; // fullKey is shown once and never retrievable again
}
