import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: String,
    changes: mongoose.Schema.Types.Mixed,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ entityType: 1, entityId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', schema);
