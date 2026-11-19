import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Keyed hash so logs can show "same lookup repeated" without storing the phone number itself.
export const lookupHash = (type, value) =>
  crypto.createHmac('sha256', env.lookupHmacSecret).update(`${type}:${value}`).digest('hex').slice(0, 32);
