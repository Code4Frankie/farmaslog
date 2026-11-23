import mongoose from 'mongoose';

// One row per (phone, purpose). The phone number is never stored: only a keyed hash. The code is stored as a keyed hash too.
// The row also tracks the hourly send window, and disappears an hour after the window opened (TTL index).
const otpSchema = new mongoose.Schema({
  phoneHash: { type: String, required: true },
  purpose: { type: String, required: true, enum: ['register', 'access'] },
  codeHash: String,
  codeExpiresAt: Date,
  attempts: { type: Number, default: 0 },
  sendCount: { type: Number, default: 0 },
  windowStartedAt: { type: Date, required: true },
  lastSentAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
otpSchema.index({ phoneHash: 1, purpose: 1 }, { unique: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = mongoose.model('Otp', otpSchema);
