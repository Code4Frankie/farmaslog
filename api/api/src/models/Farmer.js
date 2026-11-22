import mongoose from 'mongoose';
import { FARMER_STATUS, FARMER_SOURCE } from '../config/constants.js';
import { CONSENT_METHODS, CONSENT_STATUSES } from '../config/consent.js';

const { Schema } = mongoose;

const farmerSchema = new Schema(
  {
    farmaslogId: { type: String, default: undefined },
    name: { type: String, required: true, trim: true },
    phoneNormalized: { type: String, required: true },
    state: { type: String, required: true, trim: true },
    lga: { type: String, required: true, trim: true },
    ward: { type: String, trim: true },
    community: { type: String, trim: true },
    consent: {
      given: { type: Boolean, required: true },
      wordingVersion: { type: String, required: true },
      purpose: String,
      capturedAt: { type: Date, default: Date.now },
      language: String, // language the consent was given in
      textLanguage: String, // language of the text actually shown (English until a reviewed translation exists)
      method: { type: String, enum: CONSENT_METHODS },
      recordedAt: Date, // server time
      recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      partnerSharing: Boolean,
      mediaStorage: Boolean,
      textHash: String, // sha256 of the exact text shown (placeholders filled)
    },
    consentStatus: { type: String, enum: CONSENT_STATUSES, default: 'valid' },
    consentWithdrawnAt: Date,
    consentWithdrawnBy: { type: Schema.Types.ObjectId, ref: 'User' },
    consentWithdrawalReason: { type: String, maxlength: 300 },
    source: { type: String, enum: FARMER_SOURCE, default: 'field_agent' },
    status: { type: String, enum: FARMER_STATUS, default: 'pending_review' },
    isSynthetic: { type: Boolean, default: false },
    // Where the record came from. sourceRef makes imports idempotent (e.g. 'webform:FB-BE-20261020-101010-AB12CD').
    sourceRef: { type: String, default: undefined },
    sourceChannel: { type: String, enum: ['web_form', 'field_app', 'manual', 'csv_import'] },
    submittedAt: Date,
    programmeRequested: String, // internal only: never returned by /v1/verify
    registeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: String,
  },
  { timestamps: true },
);

// An ID is only issued once dedup checks pass, so it is optional but unique when present.
farmerSchema.index({ farmaslogId: 1 }, { unique: true, partialFilterExpression: { farmaslogId: { $type: 'string' } } });
// Only one ACTIVE record per phone. Duplicate candidates wait in review; nothing is merged silently.
farmerSchema.index({ phoneNormalized: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
farmerSchema.index({ sourceRef: 1 }, { unique: true, partialFilterExpression: { sourceRef: { $type: 'string' } } });
farmerSchema.index({ phoneNormalized: 1, status: 1 });
farmerSchema.index({ state: 1, lga: 1, status: 1 });
farmerSchema.index({ registeredBy: 1, createdAt: -1 });
farmerSchema.index({ consentStatus: 1 });

export const Farmer = mongoose.model('Farmer', farmerSchema);
