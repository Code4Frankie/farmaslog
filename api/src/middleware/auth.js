import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// JWT auth for dashboard/staff users (admin, data manager, field agent, finance, auditor, partner users).
export const authenticate = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired.');
  }
  const user = await User.findById(payload.sub).lean();
  if (!user || user.status !== 'active') throw new AppError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired.');
  req.user = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    partnerId: user.partnerId ? String(user.partnerId) : null,
  };
  next();
});

export const authorize = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(new AppError(403, 'FORBIDDEN', 'Your role cannot perform this action.'));
