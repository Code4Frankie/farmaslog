import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * Verify a Cloudflare Turnstile token. Where captcha is not required (local development and tests) this does nothing.
 * Where it is required but no secret is configured, it fails closed so a misconfigured deploy never lets bots through.
 */
export async function verifyCaptcha(token, ip) {
  const { required, turnstileSecret, verifyUrl } = env.captcha;
  if (!required) return;
  if (!turnstileSecret) throw new AppError(503, 'CAPTCHA_UNAVAILABLE', 'Security check is not available right now. Please try again later.');
  if (!token) throw new AppError(400, 'CAPTCHA_FAILED', 'Please complete the security check and try again.');
  let ok = false;
  try {
    const body = new URLSearchParams({ secret: turnstileSecret, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(verifyUrl, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    ok = res.ok && (await res.json()).success === true;
  } catch (err) {
    logger.error('captcha_check_failed', { reason: err.name });
    throw new AppError(503, 'CAPTCHA_UNAVAILABLE', 'Security check is not available right now. Please try again later.');
  }
  if (!ok) throw new AppError(400, 'CAPTCHA_FAILED', 'The security check failed. Please try again.');
}
