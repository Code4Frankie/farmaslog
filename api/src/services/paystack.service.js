import { Payment, PaymentEvent } from '../models/Payment.js';
import { env } from '../config/env.js';

async function verifyWithPaystack(reference) {
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.paystackSecret}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Paystack verify failed with ${r.status}`);
  return (await r.json()).data;
}

// Idempotent: the same event delivered twice is processed once. If processing throws, the event stays
// unprocessed and we return 5xx so Paystack retries.
export async function handlePaystackEvent(evt) {
  const data = evt?.data ?? {};
  const eventId = `${evt.event}:${data.id ?? data.reference}`;
  const ev = await PaymentEvent.findOneAndUpdate(
    { eventId },
    { $setOnInsert: { eventId, event: evt.event, reference: data.reference } },
    { upsert: true, returnDocument: 'after' },
  );
  if (ev.processed) return { duplicate: true };

  if (data.reference) {
    if (evt.event === 'charge.success') {
      let reconciliationStatus = 'pending';
      let state = 'pending';
      if (env.paystackServerVerify) {
        const v = await verifyWithPaystack(data.reference); // throws on network failure -> retry
        const ok = v?.status === 'success' && v.amount === data.amount && v.currency === data.currency;
        reconciliationStatus = ok ? 'reconciled' : 'mismatch';
        state = ok ? 'success' : 'pending';
      } else {
        state = 'success';
      }
      const existing = await Payment.findOne({ reference: data.reference });
      if (!existing || existing.state !== 'refunded') {
        await Payment.findOneAndUpdate(
          { reference: data.reference },
          { $set: { state, reconciliationStatus, amount: data.amount, currency: data.currency, partnerId: data.metadata?.partnerId, lastEventId: eventId } },
          { upsert: true },
        );
      }
    } else if (evt.event === 'refund.processed') {
      await Payment.findOneAndUpdate(
        { reference: data.transaction_reference || data.reference },
        { $set: { state: 'refunded', lastEventId: eventId } },
        { upsert: true },
      );
    }
  }
  ev.processed = true;
  ev.processedAt = new Date();
  await ev.save();
  return { duplicate: false };
}
