import mongoose from 'mongoose';
import { ROLE_LIST } from '../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_LIST, required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    status: { type: String, enum: ['active', 'disabled', 'pending'], default: 'active' },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
