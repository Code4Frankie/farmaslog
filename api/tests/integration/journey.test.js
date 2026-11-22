import request from 'supertest';
import { VerificationLog } from '../../src/models/VerificationLog.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Farmer } from '../../src/models/Farmer.js';
import { startTestEnv, makeUser, login, makePartnerKey, sleep } from '../helpers/setup.js';

let env, app, agent, manager, admin, partner, key;
const PHONE = '08000000001'; // synthetic test number

const registration = (over = {}) => ({
  name: 'Micheal Ahile (TEST)', phone: PHONE, state: 'Benue', lga: 'Vandeikya', ward: 'Ihugh', community: 'Ihugh',
  consent: { given: true, wordingVersion: 'consent-v1-draft', language: 'en', method: 'agent_checkbox', partnerSharing: true }, isSynthetic: true,
  farm: { crop: 'White yam', reportedAreaHa: 1.5, location: { lat: 7.05, lng: 9.0, source: 'farmer_pin', accuracyMeters: 25 } },
  ...over,
});
const verify = (q, k = key) => request(app).get('/v1/verify').set('Authorization', `Bearer ${k}`).query(q);

beforeAll(async () => {
  env = await startTestEnv();
  app = env.app;
  await makeUser('field_agent', 'agent@t.test');
  await makeUser('data_manager', 'dm@t.test');
  await makeUser('super_admin', 'admin@t.test');
  agent = await login(app, 'agent@t.test');
  manager = await login(app, 'dm@t.test');
  admin = await login(app, 'admin@t.test');
  ({ partner, fullKey: key } = await makePartnerKey());
  await makeUser('partner_verifier', 'nancy@t.test', partner._id);
});
afterAll(() => env?.stop());

describe('Micheal registers, Nancy verifies', () => {
  let farmerId, farmaslogId;

  test('registration needs consent', async () => {
    const r = await request(app).post('/v1/farmers').set('Authorization', `Bearer ${agent}`).send(registration({ consent: { given: false, wordingVersion: 'consent-v1-draft' } }));
    expect(r.status).toBe(400);
  });

  test('field agent registers; record is pending and gets a FarmasLog ID', async () => {
    const r = await request(app).post('/v1/farmers').set('Authorization', `Bearer ${agent}`).send(registration());
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending_review');
    expect(r.body.farmaslogId).toMatch(/^FL-/);
    expect(r.body.farm.evidence.status).toBe('self_reported');
    ({ id: farmerId, farmaslogId } = r.body);
  });

  test('pending records are invisible to partners', async () => {
    expect((await verify({ phone: PHONE })).status).toBe(404);
    expect((await verify({ farmaslogId })).status).toBe(404);
  });

  test('a second registration with the same name, LGA and phone goes to duplicate review without an ID', async () => {
    const r = await request(app).post('/v1/farmers').set('Authorization', `Bearer ${agent}`).send(registration());
    expect(r.status).toBe(201);
    expect(r.body.duplicateCandidate).toBe(true);
    expect(r.body.status).toBe('duplicate_review');
    expect(r.body.farmaslogId).toBeNull();
  });

  test('field agents cannot approve; data manager can', async () => {
    expect((await request(app).post(`/v1/farmers/${farmerId}/review`).set('Authorization', `Bearer ${agent}`).send({ decision: 'approve' })).status).toBe(403);
    const r = await request(app).post(`/v1/farmers/${farmerId}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('active');
  });

  test('Nancy verifies: minimal response, no phone, no coordinates, self-reported evidence', async () => {
    const r = await verify({ phone: '+234 800 000 0001', state: 'benue', lga: 'VANDEIKYA' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      verificationStatus: 'record_found', farmaslogId, crop: 'White yam', evidenceStatus: 'self_reported',
      reportedArea: { value: 1.5, unit: 'hectares' }, estimatedArea: null, synthetic: true,
      locationConfirmation: 'unconfirmed', limitations: ['location_not_confirmed_by_field_agent', 'area_self_reported'],
    });
    expect(r.body.location.coordinates).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('8000000001');
    expect(r.body.requestId).toMatch(/^req_/);
  });

  test('state/LGA mismatch is a 404', async () => {
    expect((await verify({ phone: PHONE, lga: 'Gboko' })).status).toBe(404);
  });

  test('approving the duplicate is blocked, never merged', async () => {
    const dup = await Farmer.findOne({ status: 'duplicate_review' });
    const r = await request(app).post(`/v1/farmers/${dup._id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('DUPLICATE_PHONE');
  });

  test('field verification upgrades the status to verified', async () => {
    const r = await request(app).post(`/v1/farmers/${farmerId}/field-verification`).set('Authorization', `Bearer ${agent}`)
      .send({ outcome: 'verified', method: 'site_visit', location: { lat: 7.05, lng: 9.0, accuracyMeters: 6 } });
    expect(r.status).toBe(200);
    const v = await verify({ farmaslogId });
    expect(v.body).toMatchObject({ verificationStatus: 'verified', evidenceStatus: 'field_verified', locationConfirmation: 'confirmed_by_field_agent', limitations: ['area_self_reported'] });
    expect(v.body.evidenceMessage).toMatch(/^Field review completed on \d{4}-\d{2}-\d{2}/);
  });

  test('editing the location afterwards flags the record for review', async () => {
    const r = await request(app).patch(`/v1/farmers/${farmerId}`).set('Authorization', `Bearer ${manager}`)
      .send({ farm: { location: { lat: 7.5, lng: 9.2, source: 'farmer_pin', accuracyMeters: 20 } } });
    expect(r.status).toBe(200);
    expect((await verify({ farmaslogId })).body).toMatchObject({ verificationStatus: 'review_required', evidenceStatus: 'needs_review' });
  });

  test('every request is logged without the raw phone number; edits are audited', async () => {
    await sleep(300);
    const logs = await VerificationLog.find({}).lean();
    expect(logs.length).toBeGreaterThan(3);
    expect(JSON.stringify(logs)).not.toContain('8000000001');
    expect(logs.filter((l) => l.usageUnits === 1).every((l) => l.responseCode === 200)).toBe(true);
    const audits = await AuditLog.find({ entityType: 'Farmer' }).lean();
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['farmer.registered', 'farmer.review.approve', 'farmer.updated']));
    expect(JSON.stringify(audits)).not.toContain('8000000001');
  });

  // Needs $dateToString/$cond, which MongoDB-compatible stand-ins like FerretDB 1.x lack; run on real MongoDB.
  const onRealMongo = process.env.TEST_DB_COMPAT ? test.skip : test;
  onRealMongo('Nancy (partner user) sees only her own usage; finance-style aggregation works', async () => {
    const nancy = await login(app, 'nancy@t.test');
    const r = await request(app).get('/v1/usage').set('Authorization', `Bearer ${nancy}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((row) => String(row.partnerId) === String(partner._id))).toBe(true);
    expect((await request(app).get('/v1/audit-logs').set('Authorization', `Bearer ${nancy}`)).status).toBe(403);
    expect((await request(app).get('/v1/farmers').set('Authorization', `Bearer ${nancy}`)).status).toBe(403);
  });
});

describe('/v1/verify contract', () => {
  test('400 missing / ambiguous / invalid params', async () => {
    expect((await verify({})).status).toBe(400);
    expect((await verify({ phone: PHONE, farmaslogId: 'FL-00000000' })).status).toBe(400);
    expect((await verify({ phone: 'abc' })).body.errorCode).toBe('INVALID_PHONE');
    expect((await verify({ farmaslogId: 'nope' })).status).toBe(400);
  });
  test('401 for missing, malformed and unknown keys', async () => {
    expect((await request(app).get('/v1/verify').query({ phone: PHONE })).status).toBe(401);
    expect((await verify({ phone: PHONE }, 'garbage')).status).toBe(401);
    expect((await verify({ phone: PHONE }, `sk_test_00000000_${'a'.repeat(43)}`)).body.errorCode).toBe('INVALID_API_KEY');
  });
  test('error bodies carry errorCode, message, requestId', async () => {
    const r = await verify({});
    expect(r.body).toEqual(expect.objectContaining({ errorCode: expect.any(String), message: expect.any(String), requestId: expect.any(String) }));
  });
  test('revoked key -> 401', async () => {
    const { fullKey, keyDoc } = await makePartnerKey();
    expect((await verify({ phone: PHONE }, fullKey)).status).not.toBe(401);
    const r = await request(app).post(`/v1/api-keys/${keyDoc._id}/revoke`).set('Authorization', `Bearer ${admin}`);
    expect(r.status).toBe(200);
    expect((await verify({ phone: PHONE }, fullKey)).body.errorCode).toBe('API_KEY_REVOKED');
  });
  test('429 with retryAfterSeconds when the key limit is exceeded', async () => {
    const { fullKey } = await makePartnerKey({ rateLimitPerMinute: 2 });
    await verify({ phone: PHONE }, fullKey);
    await verify({ phone: PHONE }, fullKey);
    const r = await verify({ phone: PHONE }, fullKey);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ errorCode: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
  });
  test('free plan stops at 50 billable checks per month', async () => {
    const { fullKey, partner: p } = await makePartnerKey({ plan: 'free', rateLimitPerMinute: 1000 });
    await VerificationLog.insertMany(Array.from({ length: 50 }, () => ({ partnerId: p._id, usageUnits: 1, responseCode: 200, result: 'found' })));
    const r = await verify({ phone: PHONE }, fullKey);
    expect(r.status).toBe(429);
    expect(r.body.errorCode).toBe('QUOTA_EXCEEDED');
  });
  test('key without coordinates scope never receives coordinates', async () => {
    const r = await verify({ farmaslogId: (await Farmer.findOne({ status: 'active' })).farmaslogId });
    expect(r.body.location.coordinates).toBeUndefined();
  });
});

describe('key management', () => {
  test('keys are shown once; only the prefix is listed; rotation keeps the old key for a grace period', async () => {
    const p = await request(app).post('/v1/partners').set('Authorization', `Bearer ${admin}`).send({ organization: 'Bank X', type: 'bank' });
    const k = await request(app).post(`/v1/partners/${p.body._id}/api-keys`).set('Authorization', `Bearer ${admin}`).send({ name: 'sandbox' });
    expect(k.status).toBe(201);
    expect(k.body.apiKey).toMatch(/^sk_test_/);
    const list = await request(app).get(`/v1/partners/${p.body._id}/api-keys`).set('Authorization', `Bearer ${admin}`);
    expect(JSON.stringify(list.body)).not.toContain(k.body.apiKey);
    const rot = await request(app).post(`/v1/api-keys/${k.body.id}/rotate`).set('Authorization', `Bearer ${admin}`).send({ graceHours: 1 });
    expect(rot.status).toBe(201);
    expect(rot.body.apiKey).not.toBe(k.body.apiKey);
    expect((await verify({ phone: PHONE }, k.body.apiKey)).status).not.toBe(401); // still valid during grace
    expect((await verify({ phone: PHONE }, rot.body.apiKey)).status).not.toBe(401);
  });
});

describe('GPS not confirmed by a field agent does not block partners', () => {
  const enrol = async (phone, location) => {
    const r = await request(app).post('/v1/farmers').set('Authorization', `Bearer ${agent}`)
      .send(registration({ name: `Test ${phone}`, phone, farm: { crop: 'Maize', reportedAreaHa: 2, ...(location ? { location } : {}) } }));
    expect(r.status).toBe(201);
    expect((await request(app).post(`/v1/farmers/${r.body.id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' })).status).toBe(200);
    return r.body;
  };

  test('no coordinates at all: 200, self_reported, clearly labelled', async () => {
    await enrol('08000000041');
    const r = await verify({ phone: '08000000041' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verificationStatus: 'record_found', evidenceStatus: 'self_reported', locationConfirmation: 'not_provided' });
    expect(r.body.limitations).toContain('location_not_confirmed_by_field_agent');
    expect(r.body.location.coordinates).toBeUndefined();
  });

  test('coordinates typed by the farmer: 200, self_reported, unconfirmed', async () => {
    await enrol('08000000042', { lat: 7.2, lng: 9.1, source: 'farmer_reported' });
    const r = await verify({ phone: '08000000042' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verificationStatus: 'record_found', evidenceStatus: 'self_reported', locationConfirmation: 'unconfirmed' });
  });

  test('enrichment with no satellite provider configured leaves the record verifiable', async () => {
    const f = await enrol('08000000043', { lat: 7.3, lng: 9.2, source: 'farmer_reported' });
    expect((await request(app).post(`/v1/farmers/${f.id}/enrich`).set('Authorization', `Bearer ${manager}`)).status).toBe(202);
    await sleep(500);
    const r = await verify({ phone: '08000000043' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ evidenceStatus: 'self_reported', locationConfirmation: 'unconfirmed', verificationStatus: 'record_found' });
  });
});
