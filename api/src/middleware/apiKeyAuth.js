import { ApiKey } from '../models/ApiKey.js';
import { Partner } from '../models/Partner.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseKey, secretMatches } from '../services/apiKey.service.js';

export const apiKeyAuth = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AppError(401, 'MISSING_API_KEY', 'Send your API key as: Authorization: Bearer <API_KEY>');
  }
  const parsed = parseKey(token);
  if (!parsed) throw new AppError(401, 'INVALID_API_KEY', 'The API key is invalid.');
  res.locals.vlog.keyPrefix = parsed.prefix; // prefix is not secret; useful for abuse investigation

  const key = await ApiKey.findOne({ keyPrefix: parsed.prefix });
  if (!key || !secretMatches(parsed.secret, key.secretHash)) throw new AppError(401, 'INVALID_API_KEY', 'The API key is invalid.');
  if (key.status !== 'active') throw new AppError(401, 'API_KEY_REVOKED', 'This API key has been revoked.');
  if (key.expiresAt && key.expiresAt <= new Date()) throw new AppError(401, 'API_KEY_EXPIRED', 'This API key has expired.');

  const partner = await Partner.findById(key.partnerId).lean();
  if (!partner || partner.status !== 'active') throw new AppError(403, 'PARTNER_SUSPENDED', 'This partner account is not active.');

  Object.assign(res.locals.vlog, { partnerId: key.partnerId, apiKeyId: key._id, plan: key.plan });
  req.apiKey = key;
  req.partner = partner;

  // Best-effort, throttled to one write a minute per key.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    ApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() }).catch(() => {});
  }
  next();
});

export const requireScope = (scope) => (req, res, next) => {
  if (req.apiKey.scopes.includes(scope)) return next();
  return next(new AppError(403, 'INSUFFICIENT_SCOPE', `This API key lacks the ${scope} scope.`));
};
