import { Router } from 'express';
import Joi from 'joi';
import mongoose from 'mongoose';
import { ROLES } from '../config/constants.js';
import { ApiKey } from '../models/ApiKey.js';
import { Partner } from '../models/Partner.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createApiKey } from '../services/apiKey.service.js';
import { auditCtx, writeAudit } from '../services/audit.service.js';

// Self-service keys for a partner's own users. Test-mode keys only; live keys are issued by an admin.
const router = Router();
router.use(authenticate, authorize(ROLES.PARTNER_VERIFIER));
const MAX_ACTIVE = 5;
const view = (k) => ({ id: k._id, name: k.name, keyPrefix: k.keyPrefix, mode: k.mode, plan: k.plan, scopes: k.scopes, status: k.status, lastUsedAt: k.lastUsedAt ?? null, createdAt: k.createdAt });
const own = (req) => {
  if (!req.user.partnerId) throw new AppError(403, 'FORBIDDEN', 'Your account is not linked to a partner.');
  return req.user.partnerId;
};

router.get('/api-keys', asyncHandler(async (req, res) => {
  res.json({ data: (await ApiKey.find({ partnerId: own(req) }).sort({ createdAt: -1 })).map(view) });
}));

router.post('/api-keys', validate(Joi.object({ name: Joi.string().trim().min(2).max(80).required() })), asyncHandler(async (req, res) => {
  const partner = await Partner.findById(own(req));
  if (!partner || partner.status !== 'active') throw new AppError(403, 'PARTNER_NOT_ACTIVE', 'Your organisation is not approved yet.');
  if ((await ApiKey.countDocuments({ partnerId: partner._id, status: 'active' })) >= MAX_ACTIVE) {
    throw new AppError(409, 'KEY_LIMIT', `You can have at most ${MAX_ACTIVE} active keys. Revoke one first.`);
  }
  const { doc, fullKey } = await createApiKey({ partnerId: partner._id, name: req.body.name, mode: 'test', plan: partner.plan, createdBy: req.user.id });
  await writeAudit(auditCtx(req), { action: 'apikey.created', entityType: 'ApiKey', entityId: doc._id, changes: { keyPrefix: doc.keyPrefix, selfService: true } });
  res.status(201).json({ ...view(doc), apiKey: fullKey, note: 'Store this key now. It is shown once and cannot be retrieved later.' });
}));

router.post('/api-keys/:id/revoke', asyncHandler(async (req, res) => {
  const key = mongoose.isValidObjectId(req.params.id) ? await ApiKey.findOne({ _id: req.params.id, partnerId: own(req) }) : null;
  if (!key) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
  if (key.status !== 'revoked') { key.status = 'revoked'; key.revokedAt = new Date(); await key.save(); }
  await writeAudit(auditCtx(req), { action: 'apikey.revoked', entityType: 'ApiKey', entityId: key._id, changes: { keyPrefix: key.keyPrefix, selfService: true } });
  res.json(view(key));
}));

export default router;
