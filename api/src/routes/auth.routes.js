import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Partner } from '../models/Partner.js';
import { writeAudit } from '../services/audit.service.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { authenticate } from '../middleware/auth.js';
import { loginSchema, signupSchema } from '../validators/index.js';

const router = Router();
const orgName = async (id) => (id ? (await Partner.findById(id).lean())?.organization ?? null : null);
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps timing similar for unknown emails

router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash');
  const ok = await bcrypt.compare(req.body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  // Only someone who knows the password learns the account is waiting for approval.
  if (user.status === 'pending') throw new AppError(403, 'ACCOUNT_PENDING', 'Your access request is waiting for approval.');
  if (user.status !== 'active') throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  const token = jwt.sign({ role: user.role }, env.jwtSecret, { subject: String(user._id), expiresIn: env.jwtExpiresIn, algorithm: 'HS256' });
  res.json({ token, expiresIn: env.jwtExpiresIn, user: { id: user._id, email: user.email, name: user.name, role: user.role, partnerId: user.partnerId ?? null, organization: await orgName(user.partnerId) } });
}));

// Organisations request access; nothing works until a super admin approves (POST /v1/partners/:id/approve).
router.post('/signup', loginLimiter, validate(signupSchema), asyncHandler(async (req, res) => {
  const { organization, type, name, email, password } = req.body;
  if (await User.exists({ email: email.toLowerCase() })) throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists. Sign in instead.');
  const partner = await Partner.create({ organization, type, status: 'pending', plan: 'free', billingEmail: email });
  try {
    await User.create({ email, name, role: 'partner_verifier', partnerId: partner._id, status: 'pending', passwordHash: await bcrypt.hash(password, 12) });
  } catch (err) {
    await Partner.deleteOne({ _id: partner._id });
    throw err;
  }
  await writeAudit({ actor: null, requestId: req.id }, { action: 'partner.signup_requested', entityType: 'Partner', entityId: partner._id, changes: { type } });
  res.status(201).json({ message: 'Request received. An administrator will review it before you can sign in.' });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => res.json({ user: { ...req.user, organization: await orgName(req.user.partnerId) } })));

export default router;
