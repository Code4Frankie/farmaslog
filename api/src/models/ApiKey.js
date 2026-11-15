import mongoose from 'mongoose';
import { PLANS, SCOPE_LIST } from '../config/constants.js';

const apiKeySchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    name: { type: String, required: true, trim: true },
    keyPrefix: { type: String, required: true, unique: true }, // e.g. sk_test_ab12cd34 (not secret)
    secretHash: { type: String, required: true }, // SHA-256 of the secret part; the secret is never stored
    mode: { type: String, enum: ['test', 'live'], required: true },
    plan: { type: String, enum: PLANS, default: 'free' },
    rateLimitPerMinute: Number, // optional override of the plan default
    scopes: { type: [String], enum: SCOPE_LIST, default: ['verify:read'] },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    expiresAt: Date,
    revokedAt: Date,
    lastUsedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const ApiKey = mongoose.model('ApiKey', apiKeySchema);
