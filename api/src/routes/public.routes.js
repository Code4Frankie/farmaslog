import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { otpRequestLimiter, otpVerifyLimiter, registrationLimiter } from '../middleware/rateLimit.js';
import { otpRequestSchema, otpVerifySchema, publicRegistrationSchema } from '../validators/index.js';
import { auditCtx } from '../services/audit.service.js';
import { verifyCaptcha } from '../services/captcha.service.js';
import { requestOtp, verifyOtp } from '../services/otp.service.js';
import { submitSelfRegistration } from '../services/selfRegistration.service.js';

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

// A farmer registers themselves. Needs the phoneProof from /otp/verify. Same answer whether or not the farmer is already on record.
router.post('/registrations', registrationLimiter, validate(publicRegistrationSchema), asyncHandler(async (req, res) => {
  res.status(202).json(await submitSelfRegistration(req.body, auditCtx(req)));
}));

export default router;
