import mongoose from 'mongoose';
import { EVIDENCE_STATUS, ENRICHMENT_STATE, LOCATION_SOURCE } from '../config/constants.js';

const { Schema } = mongoose;

const locationSchema = new Schema(
  {
    lat: Number,
    lng: Number,
    source: { type: String, enum: LOCATION_SOURCE },
    accuracyMeters: Number,
    collectedAt: Date,
    provider: String,
  },
  { _id: false },
);

const farmSchema = new Schema(
  {
    farmerId: { type: Schema.Types.ObjectId, ref: 'Farmer', required: true },
    crop: { type: String, trim: true },
    // Self-reported and satellite-estimated values are stored separately (FR-05).
    reportedArea: { value: Number, unit: { type: String, default: 'hectares' } },
    estimatedArea: {
      value: Number,
      unit: { type: String, default: 'hectares' },
      method: String,
      provider: String,
      assessedAt: Date,
      imageryDate: Date,
      coveragePct: Number,
    },
    location: { type: locationSchema, default: undefined },
    enrichment: {
      state: { type: String, enum: ENRICHMENT_STATE, default: 'not_assessed' },
      reason: String,
      requestedAt: Date,
      completedAt: Date,
      satellite: { ndvi: Number, imageryDate: Date, provider: String, method: String, coveragePct: Number },
    },
    evidence: {
      status: { type: String, enum: EVIDENCE_STATUS, default: 'pending' },
      confidence: Number,
      reasons: [String],
      assessedAt: Date,
    },
    // Bumped whenever location/area change, so older field verification can be flagged stale.
    evidenceInputsUpdatedAt: Date,
    fieldVerification: {
      outcome: { type: String, enum: ['verified', 'rejected'] },
      method: String,
      notes: String,
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: Date,
    },
    files: [
      {
        originalName: String,
        storedName: String,
        mimeType: String,
        size: Number,
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

farmSchema.index({ farmerId: 1 }, { unique: true });

export const Farm = mongoose.model('Farm', farmSchema);
