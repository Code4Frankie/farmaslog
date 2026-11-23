import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { Farm } from '../../src/models/Farm.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Otp } from '../../src/models/Otp.js';
import { outbox } from '../../src/services/sms.service.js';
import { MAX_SELF_REGISTRATIONS_PER_PHONE_PER_DAY } from '../../src/services/selfRegistration.service.js';
import { startTestEnv, makeUser, login, makePartnerKey } from '../helpers/setup.js';

let env, app, manager, key;
const consent = { given: true, wordingVersion: 'consent-v1-draft', language: 'en', partnerSharing: true };
const body = (proof, over = {}) => ({
  phoneProof: proof, name: 'Self Farmer', phone: '08000000501', state: 'Benue', lga: 'Vandeikya', community: 'Ihugh',
  crop: 'Yam', reportedAreaHa: 2, consent, ...over,
});
const lastCode = () => outbox.at(-1).text.match(/\b(\d{6})\b/)[1];
const resetCooldown = () => Otp.updateMany({}, { $set: { lastSentAt: new Date(Date.now() - 3600_000) } });
async function proofFor(phone) {
  await resetCooldown();
  await request(app).post('/v1/public/otp/request').send({ phone, purpose: 'register' });
  const r = await request(app).post('/v1/public/otp/verify').send({ phone, purpose: 'register', code: lastCode() });
  return r.body.phoneProof;
}
const register = (b) => request(app).post('/v1/public/registrations').send(b);

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('data_manager', 'dm@s.test'); manager = await login(app, 'dm@s.test');
  ({ fullKey: key } = await makePartnerKey());
});
afterAll(() => env?.stop());
beforeEach(async () => { await Farmer.deleteMany({}); await Farm.deleteMany({}); });

test('a farmer with a verified phone registers; the record waits for review like any other', async () => {
  const proof = await proofFor('08000000501');
  const r = await register(body(proof, { inclusion: { gender: 'female' }, location: { lat: 7.3, lng: 9.0, accuracyMeters: 25 } }));
  expect(r.status).toBe(202);
  expect(r.body).toEqual({ status: 'received', reference: expect.stringMatching(/^[A-Z2-9]{8}$/) });
  const f = await Farmer.findOne({ phoneNormalized: '+2348000000501' }).lean();
  expect(f).toMatchObject({ status: 'pending_review', source: 'self_registration', sourceChannel: 'web_form', consentStatus: 'valid', inclusion: { gender: 'female' } });
  expect(f.farmaslogId).toBeUndefined(); // an ID is issued when a data manager approves
  expect(f.consent).toMatchObject({ given: true, method: 'self_checkbox', partnerSharing: true, language: 'en' });
  expect(f.consent.textHash).toMatch(/^[0-9a-f]{64}$/);
  const farm = await Farm.findOne({ farmerId: f._id }).lean();
  expect(farm).toMatchObject({ crop: 'Yam', location: { source: 'farmer_pin' } });
  expect(farm.evidence.status).not.toBe('field_verified');
  expect(await AuditLog.countDocuments({ action: 'farmer.registered', entityId: String(f._id) })).toBe(1);
});

test('nothing is visible to partners until a data manager approves, and a farmer who declined partner sharing stays hidden', async () => {
  const proof = await proofFor('08000000502');
  await register(body(proof, { phone: '08000000502', consent: { ...consent, partnerSharing: false } }));
  const f = await Farmer.findOne({ phoneNormalized: '+2348000000502' });
  const verify = () => request(app).get('/v1/verify').set('Authorization', `Bearer ${key}`).query({ phone: '08000000502' });
  expect((await verify()).status).toBe(404);
  const ok = await request(app).post(`/v1/farmers/${f._id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
  expect(ok.status).toBe(200);
  expect((await verify()).status).toBe(404); // approved, but the farmer said no to partner sharing
});

test('the phone must be verified: no proof, a bad proof, a proof for another number or purpose are all refused', async () => {
  const proof = await proofFor('08000000503');
  expect((await register(body(undefined))).status).toBe(400);
  expect((await register(body('not-a-proof'))).status).toBe(403);
  expect((await register(body(proof, { phone: '08000000504' }))).status).toBe(403);
  await resetCooldown();
  await request(app).post('/v1/public/otp/request').send({ phone: '08000000505', purpose: 'access' });
  const access = (await request(app).post('/v1/public/otp/verify').send({ phone: '08000000505', purpose: 'access', code: lastCode() })).body.phoneProof;
  expect((await register(body(access, { phone: '08000000505' }))).status).toBe(403);
  expect(await Farmer.countDocuments()).toBe(0);
});

test('consent is required, in the current wording', async () => {
  const proof = await proofFor('08000000506');
  expect((await register(body(proof, { phone: '08000000506', consent: { ...consent, given: false } }))).status).toBe(400);
  expect((await register(body(proof, { phone: '08000000506', consent: { ...consent, wordingVersion: 'console-draft-v0' } }))).status).toBe(400);
  expect((await register(body(proof, { phone: '08000000506', consent: { given: true, wordingVersion: 'consent-v1-draft' } }))).status).toBe(400); // partnerSharing missing
  expect(await Farmer.countDocuments()).toBe(0);
});

test('BVN, NIN, date of birth and photos are refused, not quietly kept', async () => {
  const proof = await proofFor('08000000507');
  for (const extra of [{ bvn: '12345678901' }, { nin: '12345678901' }, { dob: '1990-01-01' }, { dateOfBirth: '1990-01-01' }, { photo: 'x' }]) {
    expect((await register(body(proof, { phone: '08000000507', ...extra }))).status).toBe(400);
  }
  expect(await Farmer.countDocuments()).toBe(0);
});

test('a farmer who is already on record gets the same answer; the new record waits in duplicate review', async () => {
  const p1 = await proofFor('08000000508');
  const first = await register(body(p1, { phone: '08000000508', name: 'Same Person' }));
  const p2 = await proofFor('08000000508');
  const second = await register(body(p2, { phone: '08000000508', name: 'Same Person' }));
  expect(second.status).toBe(first.status);
  expect(Object.keys(second.body)).toEqual(Object.keys(first.body));
  expect(second.body.reference).not.toBe(first.body.reference);
  expect((await Farmer.find({ phoneNormalized: '+2348000000508' }).lean()).map((f) => f.status).sort()).toEqual(['duplicate_review', 'pending_review']);
});

test('a phone can only register a few farmers a day; extras look accepted but nothing is stored', async () => {
  const proof = await proofFor('08000000509');
  for (let i = 0; i < MAX_SELF_REGISTRATIONS_PER_PHONE_PER_DAY + 2; i++) {
    const r = await register(body(proof, { phone: '08000000509', name: `Family Member ${i}` }));
    expect(r.status).toBe(202);
  }
  expect(await Farmer.countDocuments({ phoneNormalized: '+2348000000509' })).toBe(MAX_SELF_REGISTRATIONS_PER_PHONE_PER_DAY);
});

test('a family sharing one phone: different people are flagged as sharing, not as duplicates', async () => {
  const proof = await proofFor('08000000510');
  await register(body(proof, { phone: '08000000510', name: 'Mother One' }));
  await register(body(proof, { phone: '08000000510', name: 'Son Two' }));
  const rows = await Farmer.find({ phoneNormalized: '+2348000000510' }).lean();
  expect(rows).toHaveLength(2);
  expect(rows.every((f) => f.sharedPhone && f.status === 'pending_review')).toBe(true);
});
