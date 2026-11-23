import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { otpRequestLimiter, otpVerifyLimiter } from '../middleware/rateLimit.js';
import { otpRequestSchema, otpVerifySchema } from '../validators/index.js';
import { auditCtx } from '../services/audit.service.js';
import { verifyCaptcha } from '../services/captcha.service.js';
import { requestOtp, verifyOtp } from '../services/otp.service.js';

// Public endpoints used by farmers (no sign-in). They are rate limited and never reveal whether a phone number is on FarmasLog.
const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Send a one-time code by text message. Always answers 202 for a valid number, whether or not it is on FarmasLog.
router.post('/otp/request', otpRequestLimiter, validate(otpRequestSchema), asyncHandler(async (req, res) => {
  await verifyCaptcha(req.body.captchaToken, req.ip);
  const { resendAfterSeconds } = await requestOtp(req.body, auditCtx(req));
  res.status(202).json({ status: 'sent_if_valid', resendAfterSeconds });
}));

// Check the code. Returns a short-lived proof that the person controls this number.
router.post('/otp/verify', otpVerifyLimiter, validate(otpVerifySchema), asyncHandler(async (req, res) => {
  const { proof, expiresInSeconds } = await verifyOtp(req.body, auditCtx(req));
  res.json({ phoneProof: proof, expiresInSeconds });
}));

export default router;
