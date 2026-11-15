import mongoose from 'mongoose';
import { PLANS } from '../config/constants.js';

const partnerSchema = new mongoose.Schema(
  {
    organization: { type: String, required: true, trim: true },
    type: { type: String, enum: ['programme', 'bank', 'insurer', 'cooperative', 'extension', 'other'], default: 'other' },
    status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active' },
    plan: { type: String, enum: PLANS, default: 'free' },
    billingEmail: { type: String, trim: true, lowercase: true },
  },
  { timestamps: true },
);

export const Partner = mongoose.model('Partner', partnerSchema);
