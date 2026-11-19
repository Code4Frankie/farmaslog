import { VerificationLog } from '../models/VerificationLog.js';
import { FREE_MONTHLY_QUOTA } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Free plan: 50 billable checks per calendar month (UTC), counted per partner from server logs.
export const quotaCheck = asyncHandler(async (req, res, next) => {
  if (req.apiKey.plan !== 'free') return next();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await VerificationLog.countDocuments({ partnerId: req.apiKey.partnerId, usageUnits: { $gt: 0 }, createdAt: { $gte: start } });
  if (used >= FREE_MONTHLY_QUOTA) {
    res.locals.vlog.result = 'quota_exceeded';
    const next1st = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const err = new AppError(429, 'QUOTA_EXCEEDED', `Free plan quota of ${FREE_MONTHLY_QUOTA} checks per month is used up.`);
    err.retryAfterSeconds = Math.ceil((next1st - now) / 1000);
    throw err;
  }
  return next();
});
