import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { VerificationLog } from '../../src/models/VerificationLog.js';
import { migratePhoneIndex } from '../../src/migrations/phone.js';
import { startTestEnv, makeUser, login, makePartnerKey, sleep } from '../helpers/setup.js';

let env, app, agent, manager, key;
const consent = { given: true, wordingVersion: 'consent-v1-draft', language: 'en', method: 'agent_checkbox', partnerSharing: true };
const reg = (over = {}) => ({
  name: 'Phone Test', phone: '08000000201', state: 'Benue', lga: 'Vandeikya', community: 'Ihugh', consent, isSynthetic: true,
  farm: { crop: 'Maize', reportedAreaHa: 1 }, ...over,
});
const noPhone = (over = {}) => {
  const { phone, ...rest } = reg(over); // eslint-disable-line no-unused-vars
  return { ...rest, contactVia: { type: 'relative', name: 'Aunty Mary', phone: '08000000299', relationship: 'aunt' }, ...over };
};
const post = (token, body) => request(app).post('/v1/farmers').set('Authorization', `Bearer ${token}`).send(body);
const approve = (id) => request(app).post(`/v1/farmers/${id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
const verify = (q) => request(app).get('/v1/verify').set('Authorization', `Bearer ${key}`).query(q);
const patch = (token, id, body) => request(app).patch(`/v1/farmers/${id}`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('field_agent', 'agent@p.test'); await makeUser('data_manager', 'dm@p.test');
  agent = await login(app, 'agent@p.test'); manager = await login(app, 'dm@p.test');
  ({ fullKey: key } = await makePartnerKey());
});
afterAll(() => env?.stop());

test('migration drops the old one-active-farmer-per-phone unique index, and is idempotent', async () => {
  await Farmer.init();
  await Farmer.collection.createIndex({ phoneNormalized: 1 }, { name: 'phoneNormalized_1', unique: true, partialFilterExpression: { status: 'active' } });
  expect(await migratePhoneIndex()).toBe(true);
  expect(await migratePhoneIndex()).toBe(false);
  expect((await Farmer.collection.indexes()).some((i) => i.unique && i.key.phoneNormalized)).toBe(false);
});

describe('phone is optional, a contact person is the fallback', () => {
  test('a farmer with no phone but a contact person registers and gets a FarmasLog ID', async () => {
    const r = await post(agent, noPhone({ name: 'No Phone One' }));
    expect(r.status).toBe(201);
    expect(r.body.phone).toBeNull();
    expect(r.body.farmaslogId).toMatch(/^FL-/);
    expect(r.body.contactVia).toMatchObject({ type: 'relative', name: 'Aunty Mary', relationship: 'aunt' });
    expect(r.body.contactVia.phone).toMatch(/^\+?234/);
  });
  test('neither a phone nor a contact person is refused', async () => {
    const { phone, ...rest } = reg({ name: 'Nobody' }); // eslint-disable-line no-unused-vars
    const r = await post(agent, rest);
    expect(r.status).toBe(400);
  });
  test('a relative needs a phone; the agent as contact does not; a bad contact phone is refused', async () => {
    const { phone, ...rest } = reg({ name: 'Contact Rules' }); // eslint-disable-line no-unused-vars
    expect((await post(agent, { ...rest, contactVia: { type: 'relative', name: 'X' } })).status).toBe(400);
    expect((await post(agent, { ...rest, contactVia: { type: 'agent' } })).status).toBe(201);
    const bad = await post(agent, { ...rest, name: 'Contact Rules 2', contactVia: { type: 'relative', phone: '123' } });
    expect(bad.status).toBe(400);
    expect(bad.body.errorCode).toBe('INVALID_PHONE');
  });
  test('the contact person\'s number never finds the farmer', async () => {
    const r = await post(agent, noPhone({ name: 'Hidden Contact' }));
    await approve(r.body.id);
    expect((await verify({ phone: '08000000299' })).status).toBe(404);
    expect((await verify({ farmaslogId: r.body.farmaslogId })).status).toBe(200);
  });
  test('removing the phone is refused unless a contact person remains', async () => {
    const r = await post(agent, reg({ name: 'Remove Phone', phone: '08000000210' }));
    expect((await patch(manager, r.body.id, { phone: null })).status).toBe(400);
    const ok = await patch(manager, r.body.id, { phone: null, contactVia: { type: 'cooperative_leader', name: 'Chairman', phone: '08000000298' } });
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBeNull();
  });
});

describe('shared phones and duplicate detection (name + LGA + phone)', () => {
  test('a different person on the same phone is NOT a duplicate: both are flagged as sharing it', async () => {
    const a = await post(agent, reg({ name: 'Share A', phone: '08000000220' }));
    const b = await post(agent, reg({ name: 'Share B', phone: '08000000220' }));
    expect(b.status).toBe(201);
    expect(b.body.duplicateCandidate).toBe(false);
    expect(b.body.status).toBe('pending_review');
    expect(b.body.farmaslogId).toMatch(/^FL-/);
    expect(b.body.sharedPhone).toBe(true);
    expect((await Farmer.findById(a.body.id)).sharedPhone).toBe(true);
    const log = await AuditLog.findOne({ action: 'farmer.shared_phone_flagged', entityId: a.body.id });
    expect(log).toBeTruthy();
    expect(JSON.stringify(log.toObject())).not.toMatch(/8000000220/); // no phone numbers in audit entries
  });
  test('same name + LGA + phone is a duplicate and waits for review', async () => {
    await post(agent, reg({ name: 'Same Person', phone: '08000000221' }));
    const d = await post(agent, reg({ name: '  same   PERSON ', phone: '08000000221' }));
    expect(d.body.duplicateCandidate).toBe(true);
    expect(d.body.status).toBe('duplicate_review');
    expect(d.body.farmaslogId).toBeNull();
    expect(d.body.sharedPhone).toBe(false);
  });
  test('same name and phone in a different LGA is a different record (shared phone)', async () => {
    await post(agent, reg({ name: 'Mover', phone: '08000000222' }));
    const r = await post(agent, reg({ name: 'Mover', phone: '08000000222', lga: 'Gboko' }));
    expect(r.body.duplicateCandidate).toBe(false);
    expect(r.body.sharedPhone).toBe(true);
  });
  test('with no phone, same name + LGA + community is a duplicate', async () => {
    await post(agent, noPhone({ name: 'Quiet Farmer' }));
    const d = await post(agent, noPhone({ name: 'Quiet Farmer' }));
    expect(d.body.duplicateCandidate).toBe(true);
    const other = await post(agent, noPhone({ name: 'Quiet Farmer', community: 'Elsewhere' }));
    expect(other.body.duplicateCandidate).toBe(false);
  });
  test('approving a true duplicate of an active record is still blocked', async () => {
    const a = await post(agent, reg({ name: 'Twin', phone: '08000000223' }));
    await approve(a.body.id);
    const d = await post(agent, reg({ name: 'Twin', phone: '08000000223' }));
    const r = await approve(d.body.id);
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('DUPLICATE_PHONE');
  });
  test('a data manager can edit sharedPhone; a field agent cannot; the change is audited', async () => {
    const r = await post(agent, reg({ name: 'Flag Me', phone: '08000000224' }));
    expect((await patch(agent, r.body.id, { sharedPhone: true })).status).toBe(403);
    const ok = await patch(manager, r.body.id, { sharedPhone: true });
    expect(ok.status).toBe(200);
    expect(ok.body.sharedPhone).toBe(true);
    expect(await AuditLog.findOne({ action: 'farmer.updated', entityId: r.body.id })).toBeTruthy();
  });
});

describe('partner verify with a shared phone', () => {
  let a, b, c, d;
  beforeAll(async () => {
    a = (await post(agent, reg({ name: 'Verify A', phone: '08000000230', lga: 'Vandeikya' }))).body;
    b = (await post(agent, reg({ name: 'Verify B', phone: '08000000230', lga: 'Gboko' }))).body;
    c = (await post(agent, reg({ name: 'Verify C', phone: '08000000231' }))).body;
    d = (await post(agent, reg({ name: 'Verify D', phone: '08000000231' }))).body;
    for (const f of [a, b, c, d]) await approve(f.id);
  });
  test('one approved match: behaves as before', async () => {
    const solo = (await post(agent, reg({ name: 'Solo', phone: '08000000232' }))).body;
    await approve(solo.id);
    const r = await verify({ phone: '08000000232' });
    expect(r.status).toBe(200);
    expect(r.body.farmaslogId).toBe(solo.farmaslogId);
  });
  test('several matches: 409 MULTIPLE_RECORDS, never a guess, and not billed', async () => {
    const r = await verify({ phone: '08000000230' });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('MULTIPLE_RECORDS');
    expect(r.body.message).toMatch(/FarmasLog ID|LGA/);
    expect(JSON.stringify(r.body)).not.toMatch(/Verify A|Verify B|Gboko|Vandeikya/); // reveals nothing about the records
    await sleep(300);
    const log = await VerificationLog.findOne({ result: 'ambiguous' }).sort({ createdAt: -1 });
    expect(log).toBeTruthy();
    expect(log.usageUnits).toBe(0);
  });
  test('adding LGA narrows it; the FarmasLog ID always works', async () => {
    const r = await verify({ phone: '08000000230', lga: 'Gboko' });
    expect(r.status).toBe(200);
    expect(r.body.farmaslogId).toBe(b.farmaslogId);
    expect((await verify({ farmaslogId: a.farmaslogId })).status).toBe(200);
  });
  test('same phone AND same LGA is still ambiguous: the caller must use the ID', async () => {
    expect((await verify({ phone: '08000000231', lga: 'Vandeikya' })).status).toBe(409);
    expect((await verify({ farmaslogId: c.farmaslogId })).body.farmaslogId).toBe(c.farmaslogId);
  });
  test('pending records do not make a lookup ambiguous', async () => {
    const e = (await post(agent, reg({ name: 'Verify E', phone: '08000000233' }))).body;
    await approve(e.id);
    await post(agent, reg({ name: 'Verify F', phone: '08000000233' })); // stays pending_review
    expect((await verify({ phone: '08000000233' })).status).toBe(200);
  });
  test('partners never see phone, sharedPhone or contact fields', async () => {
    const body = JSON.stringify((await verify({ farmaslogId: d.farmaslogId })).body);
    expect(body).not.toMatch(/sharedPhone|contactVia|8000000231/);
  });
});
