import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { PLAN_RATE_LIMITS } from '../config/constants.js';

function limited(req, res) {
  const t = req.rateLimit?.resetTime;
  const retryAfterSeconds = t ? Math.max(1, Math.ceil((t.getTime() - Date.now()) / 1000)) : 60;
  if (res.locals.vlog) res.locals.vlog.result = 'rate_limited';
  res.set('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    errorCode: 'RATE_LIMITED',
    message: 'Rate limit exceeded. Retry after the indicated delay.',
    retryAfterSeconds,
    requestId: req.id,
  });
}
const base = { standardHeaders: 'draft-7', legacyHeaders: false, handler: limited };

// Per-IP safety net for everything.
export const globalLimiter = rateLimit({ ...base, windowMs: 60_000, limit: env.isTest ? 100000 : 600 });
// Brute-force protection on login.
export const loginLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: env.isTest ? 100000 : 10 });
// Public one-time-code endpoints: per IP, on top of the per-phone limits in otp.service.js.
export const otpRequestLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: env.isTest ? 100000 : 10 });
export const otpVerifyLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: env.isTest ? 100000 : 30 });
// A farmer can only submit a few registrations per hour from one address (family members may share a phone or a shop).
export const registrationLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: env.isTest ? 100000 : 8 });
// Per API key, using the plan default unless the key has an override (PRD section 9).
export const keyLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: (req) => req.apiKey?.rateLimitPerMinute || PLAN_RATE_LIMITS[req.apiKey?.plan] || 60,
  keyGenerator: (req) => `key:${req.apiKey.id}`,
});
