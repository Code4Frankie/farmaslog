import mongoose from 'mongoose';

// Small key/value store for settings an administrator can edit from the dashboard (for example the consent contact details).
const settingSchema = new mongoose.Schema(
  { key: { type: String, required: true, unique: true }, value: { type: mongoose.Schema.Types.Mixed, default: {} }, updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
  { timestamps: true },
);
export const Setting = mongoose.model('Setting', settingSchema);
