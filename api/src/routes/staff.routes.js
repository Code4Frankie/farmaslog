import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ONBOARDABLE_ROLES, ROLES, STAFF_ROLES } from '../config/constants.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createStaffSchema, staffListSchema, staffStatusSchema } from '../validators/index.js';
import { auditCtx, writeAudit } from '../services/audit.service.js';

// FarmasLog's own team (field agents, data managers, finance, auditors). Super admin only.
// A new account gets a one-time temporary password and cannot do anything except choose its own password.
const router = Router();
router.use(authenticate, authorize(ROLES.SUPER_ADMIN));

const tempPassword = () => crypto.randomBytes(12).toString('base64url'); // 16 characters, shown once
const view = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, status: u.status, mustChangePassword: Boolean(u.mustChangePassword), phone: u.phone ?? null, state: u.state ?? null, lga: u.lga ?? null, createdAt: u.createdAt });
const NOTE = 'Share this temporary password privately. It is shown once, and they must choose their own at first sign-in.';

async function loadStaff(id) {
  const u = mongoose.isValidObjectId(id) ? await User.findById(id) : null;
  if (!u || !STAFF_ROLES.includes(u.role)) throw new AppError(404, 'STAFF_NOT_FOUND', 'Team member not found.');
  return u;
}

router.get('/', validate(staffListSchema, 'query'), asyncHandler(async (req, res) => {
  const filter = { role: { $in: STAFF_ROLES }, ...(req.query.status ? { status: req.query.status } : {}) };
  res.json({ data: (await User.find(filter).sort({ createdAt: -1 }).lean()).map(view) });
}));

router.post('/', validate(createStaffSchema), asyncHandler(async (req, res) => {
  const { name, role } = req.body;
  const email = req.body.email.toLowerCase();
  if (!ONBOARDABLE_ROLES.includes(role)) throw new AppError(400, 'ROLE_NOT_ALLOWED', 'That role cannot be created here.');
  if (await User.exists({ email })) throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
  const password = tempPassword();
  const u = await User.create({ email, name, role, mustChangePassword: true, passwordHash: await bcrypt.hash(password, 12) });
  await writeAudit(auditCtx(req), { action: 'staff.created', entityType: 'User', entityId: u._id, changes: { role } });
  res.status(201).json({ ...view(u), temporaryPassword: password, note: NOTE });
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const u = await loadStaff(req.params.id);
  if (String(u._id) === req.user.id) throw new AppError(400, 'USE_CHANGE_PASSWORD', 'Change your own password from the Password tab.');
  if (u.role === ROLES.SUPER_ADMIN) throw new AppError(403, 'FORBIDDEN', 'Administrator passwords cannot be reset here.');
  const password = tempPassword();
  u.passwordHash = await bcrypt.hash(password, 12);
  u.mustChangePassword = true;
  await u.save();
  await writeAudit(auditCtx(req), { action: 'staff.password_reset', entityType: 'User', entityId: u._id });
  res.json({ ...view(u), temporaryPassword: password, note: NOTE });
}));

// Field-agent applications (POST /v1/auth/agent-signup) wait here for a decision.
for (const [action, status, audit] of [['approve', 'active', 'staff.application_approved'], ['reject', 'disabled', 'staff.application_rejected']]) {
  router.post(`/:id/${action}`, asyncHandler(async (req, res) => {
    const u = await loadStaff(req.params.id);
    if (u.status !== 'pending') throw new AppError(409, 'NOT_PENDING', 'This application has already been decided.');
    u.status = status;
    await u.save();
    await writeAudit(auditCtx(req), { action: audit, entityType: 'User', entityId: u._id });
    res.json(view(u));
  }));
}

router.post('/:id/status', validate(staffStatusSchema), asyncHandler(async (req, res) => {
  const u = await loadStaff(req.params.id);
  if (String(u._id) === req.user.id) throw new AppError(400, 'CANNOT_DISABLE_SELF', 'You cannot disable your own account.');
  if (u.role === ROLES.SUPER_ADMIN) throw new AppError(403, 'FORBIDDEN', 'Administrator accounts cannot be disabled here.');
  if (u.status === 'pending') throw new AppError(409, 'NOT_ACTIVATABLE', 'This account is waiting for approval, not onboarding.');
  u.status = req.body.status;
  await u.save();
  await writeAudit(auditCtx(req), { action: req.body.status === 'disabled' ? 'staff.disabled' : 'staff.enabled', entityType: 'User', entityId: u._id });
  res.json(view(u));
}));

export default router;
