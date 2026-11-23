import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

// Messages sent in tests and local development when no real provider is configured. Never used in production.
export const outbox = [];

/**
 * Send one text message. Never logs the number or the text (a one-time code is in it).
 * Throws AppError(503 SMS_UNAVAILABLE) if the message could not be handed to the provider.
 */
export async function sendSms(to, text) {
  const { provider } = env.sms;
  if (provider === 'memory') { outbox.push({ to, text, at: new Date() }); return { provider }; }
  if (provider === 'termii') return sendViaTermii(to, text);
  throw new AppError(503, 'SMS_UNAVAILABLE', 'Text messages are not available right now. Please try again later.');
}

async function sendViaTermii(to, text) {
  const { termiiApiKey, termiiBaseUrl, senderId, channel } = env.sms;
  if (!termiiApiKey) throw new AppError(503, 'SMS_UNAVAILABLE', 'Text messages are not available right now. Please try again later.');
  let res;
  try {
    res = await fetch(`${termiiBaseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Termii wants the number without the plus sign.
      body: JSON.stringify({ to: to.replace(/^\+/, ''), from: senderId, sms: text, type: 'plain', channel, api_key: termiiApiKey }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    logger.error('sms_send_failed', { provider: 'termii', reason: err.name });
    throw new AppError(503, 'SMS_UNAVAILABLE', 'We could not send the text message. Please try again in a moment.');
  }
  if (!res.ok) {
    logger.error('sms_send_failed', { provider: 'termii', status: res.status });
    throw new AppError(503, 'SMS_UNAVAILABLE', 'We could not send the text message. Please try again in a moment.');
  }
  return { provider: 'termii' };
}
