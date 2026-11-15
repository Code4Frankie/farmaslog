import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { ROLES, PLANS } from '../config/constants.js';
import { Partner } from '../models/Partner.js';
import { User } from '../models/User.js';
import { ApiKey } from '../models/ApiKey.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createApiKey } from '../services/apiKey.service.js';
import { auditCtx, writeAudit } from '../services/audit.service.js';
import { createPartnerSchema, createUserSchema, createKeySchema, rotateKeySchema } from '../validators/index.js';

const router = Router();
// Scoped to these prefixes only, so this router never intercepts other /v1 paths.
router.use(['/partners', '/users', '/api-keys'], authenticate, authorize(ROLES.SUPER_ADMIN));

const keyView = (k) => ({
  id: k._id, name: k.name, keyPrefix: k.keyPrefix, mode: k.mode, plan: k.plan, scopes: k.scopes,
  rateLimitPerMinute: k.rateLimitPerMinute ?? null, status: k.status, expiresAt: k.expiresAt ?? null,
  lastUsedAt: k.lastUsedAt ?? null, createdAt: k.createdAt,
});
const ONCE = 'Store this key now. It is shown once and cannot be retrieved later.';

async function loadPartner(req, _res, next, id) {
  try {
    if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'PARTNER_NOT_FOUND', 'Partner not found.');
    req.partnerDoc = await Partner.findById(id);
    if (!req.partnerDoc) throw new AppError(404, 'PARTNER_NOT_FOUND', 'Partner not found.');
    next();
  } catch (err) { next(err); }
}
router.param('partnerId', loadPartner);

router.post('/partners', validate(createPartnerSchema), asyncHandler(async (req, res) => {
  const p = await Partner.create(req.body);
  await writeAudit(auditCtx(req), { action: 'partner.created', entityType: 'Partner', entityId: p._id, changes: { plan: p.plan } });
  res.status(201).json(p);
}));
router.get('/partners', asyncHandler(async (req, res) => {
  const filter = ['pending', 'active', 'suspended'].includes(req.query.status) ? { status: req.query.status } : {};
  res.json({ data: await Partner.find(filter).sort({ createdAt: -1 }) });
}));

router.post('/partners/:partnerId/approve', asyncHandler(async (req, res) => {
  const p = req.partnerDoc;
  if (p.status !== 'pending') throw new AppError(409, 'INVALID_STATE', 'Only a pending partner can be approved.');
  p.status = 'active';
  await p.save();
  const r = await User.updateMany({ partnerId: p._id, status: 'pending' }, { status: 'active' });
  await writeAudit(auditCtx(req), { action: 'partner.approved', entityType: 'Partner', entityId: p._id, changes: { usersActivated: r.modifiedCount } });
  res.json(p);
}));

// Staff or partner users (e.g. a partner_verifier such as Nancy's account)
router.post('/users', validate(createUserSchema), asyncHandler(async (req, res) => {
  const { partnerId, role } = req.body;
  if (role === ROLES.PARTNER_VERIFIER && !partnerId) throw new AppError(400, 'PARTNER_REQUIRED', 'partner_verifier users must belong to a partner.');
  if (partnerId && !(await Partner.exists({ _id: partnerId }))) throw new AppError(404, 'PARTNER_NOT_FOUND', 'Partner not found.');
  const u = await User.create({ ...req.body, passwordHash: await bcrypt.hash(req.body.password, 12) });
  await writeAudit(auditCtx(req), { action: 'user.created', entityType: 'User', entityId: u._id, changes: { role } });
  res.status(201).json({ id: u._id, email: u.email, name: u.name, role: u.role, partnerId: u.partnerId ?? null });
}));

router.post('/partners/:partnerId/api-keys', validate(createKeySchema), asyncHandler(async (req, res) => {
  const { doc, fullKey } = await createApiKey({ ...req.body, plan: req.body.plan ?? req.partnerDoc.plan, partnerId: req.partnerDoc._id, createdBy: req.user.id });
  await writeAudit(auditCtx(req), { action: 'apikey.created', entityType: 'ApiKey', entityId: doc._id, changes: { keyPrefix: doc.keyPrefix, plan: doc.plan, scopes: doc.scopes } });
  res.status(201).json({ ...keyView(doc), apiKey: fullKey, note: ONCE });
}));

router.get('/partners/:partnerId/api-keys', asyncHandler(async (req, res) => {
  res.json({ data: (await ApiKey.find({ partnerId: req.partnerDoc._id }).sort({ createdAt: -1 })).map(keyView) });
}));

async function loadKey(id) {
  const key = mongoose.isValidObjectId(id) ? await ApiKey.findById(id) : null;
  if (!key) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
  return key;
}

router.post('/api-keys/:keyId/revoke', asyncHandler(async (req, res) => {
  const key = await loadKey(req.params.keyId);
  if (key.status !== 'revoked') { key.status = 'revoked'; key.revokedAt = new Date(); await key.save(); }
  await writeAudit(auditCtx(req), { action: 'apikey.revoked', entityType: 'ApiKey', entityId: key._id, changes: { keyPrefix: key.keyPrefix } });
  res.json(keyView(key));
}));

// Rotation: issue a new key now; the old one keeps working for graceHours (0 = revoke immediately).
router.post('/api-keys/:keyId/rotate', validate(rotateKeySchema), asyncHandler(async (req, res) => {
  const old = await loadKey(req.params.keyId);
  if (old.status !== 'active') throw new AppError(409, 'INVALID_STATE', 'Only an active key can be rotated.');
  const { doc, fullKey } = await createApiKey({
    partnerId: old.partnerId, name: `${old.name} (rotated)`, mode: old.mode, plan: old.plan,
    scopes: old.scopes, rateLimitPerMinute: old.rateLimitPerMinute, createdBy: req.user.id,
  });
  const { graceHours } = req.body;
  if (graceHours === 0) { old.status = 'revoked'; old.revokedAt = new Date(); }
  else {
    const cutoff = new Date(Date.now() + graceHours * 3600_000);
    old.expiresAt = old.expiresAt && old.expiresAt < cutoff ? old.expiresAt : cutoff;
  }
  await old.save();
  await writeAudit(auditCtx(req), { action: 'apikey.rotated', entityType: 'ApiKey', entityId: old._id, changes: { newKeyPrefix: doc.keyPrefix, graceHours } });
  res.status(201).json({ ...keyView(doc), apiKey: fullKey, note: ONCE, previousKey: keyView(old) });
}));

export default router;
