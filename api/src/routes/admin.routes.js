import { Router } from 'express';
import mongoose from 'mongoose';
import { ROLES } from '../config/constants.js';
import { VerificationLog } from '../models/VerificationLog.js';
import { AuditLog } from '../models/AuditLog.js';
import { Partner } from '../models/Partner.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { usageSchema, logListSchema } from '../validators/index.js';

const { SUPER_ADMIN, FINANCE, AUDITOR, PARTNER_VERIFIER } = ROLES;
const router = Router();
router.use(['/usage', '/verification-logs', '/audit-logs'], authenticate);

// Partner users can only ever see their own partner's data.
function partnerFilter(req, requested) {
  if (req.user.role !== PARTNER_VERIFIER) return requested;
  if (!req.user.partnerId) throw new AppError(403, 'FORBIDDEN', 'Your account is not linked to a partner.');
  return req.user.partnerId;
}
const dateRange = (q) => {
  const now = new Date();
  const from = q.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = q.to ?? now;
  return { $gte: from, $lte: to };
};

// Usage aggregated by partner, plan and period, straight from server-side logs (FR-07).
router.get('/usage', authorize(SUPER_ADMIN, FINANCE, AUDITOR, PARTNER_VERIFIER), validate(usageSchema, 'query'), asyncHandler(async (req, res) => {
  const match = { createdAt: dateRange(req.query), partnerId: { $ne: null } };
  const pid = partnerFilter(req, req.query.partnerId);
  if (pid) match.partnerId = new mongoose.Types.ObjectId(pid);
  const fmt = req.query.groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const rows = await VerificationLog.aggregate([
    { $match: match },
    { $group: {
      _id: { partnerId: '$partnerId', plan: '$plan', period: { $dateToString: { format: fmt, date: '$createdAt' } } },
      requests: { $sum: 1 },
      billableUnits: { $sum: '$usageUnits' },
      errors: { $sum: { $cond: [{ $gte: ['$responseCode', 400] }, 1, 0] } },
      avgLatencyMs: { $avg: '$latencyMs' },
    } },
    { $sort: { '_id.period': 1, '_id.partnerId': 1 } },
  ]);
  const partners = await Partner.find({ _id: { $in: rows.map((r) => r._id.partnerId) } }).lean();
  const names = new Map(partners.map((p) => [String(p._id), p.organization]));
  res.json({
    data: rows.map((r) => ({
      partnerId: r._id.partnerId, organization: names.get(String(r._id.partnerId)) ?? null, plan: r._id.plan, period: r._id.period,
      requests: r.requests, billableUnits: r.billableUnits, errors: r.errors, avgLatencyMs: Math.round(r.avgLatencyMs),
    })),
  });
}));

router.get('/verification-logs', authorize(SUPER_ADMIN, FINANCE, AUDITOR, PARTNER_VERIFIER), validate(logListSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const filter = { createdAt: dateRange(req.query) };
  const pid = partnerFilter(req, req.query.partnerId);
  if (pid) filter.partnerId = pid;
  if (req.query.result) filter.result = req.query.result;
  const [data, total] = await Promise.all([
    VerificationLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    VerificationLog.countDocuments(filter),
  ]);
  res.json({ data, page, limit, total });
}));

router.get('/audit-logs', authorize(SUPER_ADMIN, AUDITOR), validate(logListSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const filter = { createdAt: dateRange(req.query) };
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entityType) filter.entityType = req.query.entityType;
  const [data, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ data, page, limit, total });
}));

export default router;
