import { Router } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyPaystackSignature } from '../utils/paystack.js';
import { handlePaystackEvent } from '../services/paystack.service.js';

const router = Router();

// Mounted with express.raw() in app.js: the signature must be checked against the exact raw bytes.
router.post('/paystack', asyncHandler(async (req, res) => {
  if (!verifyPaystackSignature(req.body, req.get('x-paystack-signature'), env.paystackSecret)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
  }
  let evt;
  try { evt = JSON.parse(req.body.toString('utf8')); } catch { throw new AppError(400, 'INVALID_JSON', 'Body is not valid JSON.'); }
  if (!evt?.event) throw new AppError(400, 'INVALID_EVENT', 'Missing event type.');
  const result = await handlePaystackEvent(evt);
  res.status(200).json({ received: true, duplicate: result.duplicate });
}));

export default router;
