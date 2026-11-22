import { VerificationLog } from '../models/VerificationLog.js';
import { logger } from '../utils/logger.js';

const RESULT_BY_CODE = { 200: 'found', 400: 'invalid', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'ambiguous', 429: 'rate_limited' };

// Mounted BEFORE auth so failed/unauthenticated attempts are logged too. Metering comes from these
// server-side rows, never from client claims (PRD section 10).
export function verificationLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.locals.vlog = {};
  res.on('finish', () => {
    const v = res.locals.vlog;
    const code = res.statusCode;
    VerificationLog.create({
      partnerId: v.partnerId,
      apiKeyId: v.apiKeyId,
      keyPrefix: v.keyPrefix,
      plan: v.plan,
      lookupType: v.lookupType || 'unknown',
      lookupHash: v.lookupHash,
      result: v.result || RESULT_BY_CODE[code] || 'error',
      responseCode: code,
      latencyMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
      usageUnits: code === 200 ? 1 : 0,
      requestId: req.id,
      ip: req.ip,
    }).catch((err) => logger.error('verification_log_failed', { requestId: req.id, message: err.message }));
  });
  next();
}
