import mongoose from 'mongoose';

// One wording of the consent text, with every language it has. A draft can be edited; a published version never changes
// (records point at it by version and by the hash of the text the farmer was shown). `texts` is { en: {...}, ha: {...} } where
// each entry holds title, sections, agreementsIntro, agreements, readAloud, agentNote and, for non-English, reviewed/reviewedBy.
const consentVersionSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, unique: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    texts: { type: mongoose.Schema.Types.Mixed, default: {} },
    notes: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reconsent: { type: String, enum: ['none', 'flag'] },
    flaggedCount: { type: Number },
  },
  { timestamps: true, minimize: false },
);
export const ConsentVersion = mongoose.model('ConsentVersion', consentVersionSchema);
