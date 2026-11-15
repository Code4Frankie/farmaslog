import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { verificationLogger } from '../middleware/verificationLogger.js';
import { apiKeyAuth, requireScope } from '../middleware/apiKeyAuth.js';
import { keyLimiter } from '../middleware/rateLimit.js';
import { quotaCheck } from '../middleware/quota.js';
import { verifyQuerySchema } from '../validators/index.js';
import { verifyFarmer } from '../services/verification.service.js';
import { SCOPES } from '../config/constants.js';

const router = Router();

// GET /v1/verify?phone=...&state=Benue&lga=Vandeikya   (or ?farmaslogId=FL-XXXXXXXX)
router.get(
  '/',
  verificationLogger, // first, so every attempt is logged
  apiKeyAuth,
  requireScope(SCOPES.VERIFY),
  keyLimiter,
  quotaCheck,
  validate(verifyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const body = await verifyFarmer(req.query, req.apiKey, res.locals.vlog);
    res.set('Cache-Control', 'no-store').json({ ...body, requestId: req.id });
  }),
);

export default router;
