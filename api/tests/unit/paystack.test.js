import crypto from 'node:crypto';
import { verifyPaystackSignature } from '../../src/utils/paystack.js';
import { generateFarmaslogId, FARMASLOG_ID_RE } from '../../src/utils/ids.js';

const secret = 'sk_test_dummy';
const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 1, reference: 'r1' } }));
const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');

test('valid signature passes', () => expect(verifyPaystackSignature(body, sig, secret)).toBe(true));
test('tampered body fails', () => expect(verifyPaystackSignature(Buffer.from(body.toString() + ' '), sig, secret)).toBe(false));
test('wrong secret / missing / bad hex / non-buffer fail', () => {
  expect(verifyPaystackSignature(body, sig, 'other')).toBe(false);
  expect(verifyPaystackSignature(body, undefined, secret)).toBe(false);
  expect(verifyPaystackSignature(body, 'zz', secret)).toBe(false);
  expect(verifyPaystackSignature(body.toString(), sig, secret)).toBe(false);
});
test('FarmasLog IDs match the documented format', () => {
  for (let i = 0; i < 200; i++) expect(generateFarmaslogId()).toMatch(FARMASLOG_ID_RE);
});
