import mongoose from 'mongoose';

// One row per /v1/verify request. Stores a keyed hash of the lookup value, never the phone number.
const schema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey' },
    keyPrefix: String,
    plan: String,
    lookupType: { type: String, enum: ['phone', 'farmaslogId', 'unknown'], default: 'unknown' },
    lookupHash: String,
    result: {
      type: String,
      enum: ['found', 'not_found', 'invalid', 'unauthorized', 'forbidden', 'ambiguous', 'rate_limited', 'quota_exceeded', 'error'],
    },
    responseCode: Number,
    latencyMs: Number,
    usageUnits: { type: Number, default: 0 }, // 1 only for successful (200) lookups
    requestId: String,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ partnerId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

export const VerificationLog = mongoose.model('VerificationLog', schema);
