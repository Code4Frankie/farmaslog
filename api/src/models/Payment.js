import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'paystack' },
    reference: { type: String, required: true, unique: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    amount: Number, // minor units (kobo)
    currency: String,
    state: { type: String, enum: ['pending', 'success', 'failed', 'refunded'], default: 'pending' },
    reconciliationStatus: { type: String, enum: ['pending', 'reconciled', 'mismatch'], default: 'pending' },
    lastEventId: String,
  },
  { timestamps: true },
);

const eventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true }, // idempotency key
    event: String,
    reference: String,
    processed: { type: Boolean, default: false },
    processedAt: Date,
  },
  { timestamps: true },
);

export const Payment = mongoose.model('Payment', paymentSchema);
export const PaymentEvent = mongoose.model('PaymentEvent', eventSchema);
