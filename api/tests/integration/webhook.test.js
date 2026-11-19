import crypto from 'node:crypto';
import request from 'supertest';
import { Payment, PaymentEvent } from '../../src/models/Payment.js';
import { env as appEnv } from '../../src/config/env.js';
import { startTestEnv } from '../helpers/setup.js';

let env, app;
const SECRET = 'sk_test_webhook_secret';
beforeAll(async () => { appEnv.paystackSecret = SECRET; appEnv.paystackServerVerify = false; env = await startTestEnv(); app = env.app; });
afterAll(() => env?.stop());

const send = (payload, sig) => {
  const raw = JSON.stringify(payload);
  const signature = sig ?? crypto.createHmac('sha512', SECRET).update(raw).digest('hex');
  return request(app).post('/v1/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(raw);
};
const evt = { event: 'charge.success', data: { id: 99, reference: 'ref_1', amount: 20000, currency: 'NGN' } };

test('bad signature -> 401, nothing stored', async () => {
  expect((await send(evt, 'deadbeef')).status).toBe(401);
  expect(await PaymentEvent.countDocuments()).toBe(0);
});
test('valid event records payment; replay is acknowledged but not reprocessed', async () => {
  const a = await send(evt);
  expect(a.status).toBe(200);
  expect(a.body.duplicate).toBe(false);
  const b = await send(evt);
  expect(b.body.duplicate).toBe(true);
  expect(await Payment.countDocuments({ reference: 'ref_1' })).toBe(1);
  expect((await Payment.findOne({ reference: 'ref_1' })).state).toBe('success');
});
test('refund moves state to refunded and a later replay of the charge does not undo it', async () => {
  await send({ event: 'refund.processed', data: { id: 100, reference: 'rf_1', transaction_reference: 'ref_1' } });
  expect((await Payment.findOne({ reference: 'ref_1' })).state).toBe('refunded');
  await send({ ...evt, data: { ...evt.data, id: 101 } }); // a new charge.success event id for the same reference
  expect((await Payment.findOne({ reference: 'ref_1' })).state).toBe('refunded');
});
