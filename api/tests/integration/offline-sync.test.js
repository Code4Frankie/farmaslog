import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { Farm } from '../../src/models/Farm.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, agent, other, manager;
const consent = { given: true, wordingVersion: 'consent-v1-draft', language: 'en', method: 'agent_read_aloud', partnerSharing: true };
let n = 0;
const rec = (over = {}) => ({
  clientId: `c-${String(++n).padStart(6, '0')}-aaaaaaaa`, capturedAt: new Date(Date.now() - 3600_000).toISOString(),
  name: `Offline Farmer ${n}`, phone: `0800000${String(7000 + n)}`, state: 'Benue', lga: 'Vandeikya', consent, isSynthetic: true,
  farm: { crop: 'Yam', reportedAreaHa: 1 }, ...over,
});
const sync = (token, records) => request(app).post('/v1/farmers/sync').set('Authorization', `Bearer ${token}`).send({ records });

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('field_agent', 'a@o.test'); await makeUser('field_agent', 'b@o.test'); await makeUser('data_manager', 'dm@o.test');
  agent = await login(app, 'a@o.test'); other = await login(app, 'b@o.test'); manager = await login(app, 'dm@o.test');
});
afterAll(() => env?.stop());
beforeEach(async () => { await Farmer.deleteMany({}); await Farm.deleteMany({}); });

test('records saved offline are created like any registration: pending review, by this agent, from the app', async () => {
  const r = rec();
  const res = await sync(agent, [r]);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ created: 1, error: 0, results: [{ clientId: r.clientId, status: 'created' }] });
  const f = await Farmer.findOne({ name: r.name }).lean();
  expect(f).toMatchObject({ status: 'pending_review', source: 'field_agent', sourceChannel: 'field_app', consentStatus: 'valid' });
  expect(f.farmaslogId).toMatch(/^FL-/);
  expect(String(f.registeredBy)).toBeTruthy();
  expect(f.sourceRef).toMatch(/^app:[0-9a-f]{24}:c-/);
});

test('the farmer\'s consent is dated when they agreed, and stamped with the time it reached the server', async () => {
  const r = rec({ capturedAt: new Date(Date.now() - 2 * 24 * 3600_000).toISOString() });
  await sync(agent, [r]);
  const f = await Farmer.findOne({ name: r.name }).lean();
  expect(f.submittedAt.toISOString()).toBe(r.capturedAt);
  expect(f.consent.capturedAt.toISOString()).toBe(r.capturedAt);
  expect(f.consent.recordedAt.getTime()).toBeGreaterThan(new Date(r.capturedAt).getTime() + 24 * 3600_000);
});

test('uploading the same batch again creates nothing new', async () => {
  const batch = [rec(), rec()];
  await sync(agent, batch);
  const again = await sync(agent, batch);
  expect(again.body).toMatchObject({ created: 0, already_synced: 2, error: 0 });
  expect(await Farmer.countDocuments()).toBe(2);
});

test('two agents cannot collide on a clientId', async () => {
  const r = rec();
  await sync(agent, [r]);
  const b = await sync(other, [{ ...r, name: 'Different Person', phone: '08000009999' }]);
  expect(b.body.created).toBe(1);
  expect(await Farmer.countDocuments()).toBe(2);
});

test('one bad record does not block the others, and says what is wrong', async () => {
  const good = rec(); const noConsent = rec({ consent: { ...consent, given: false } }); const badPhone = rec({ phone: '12345' });
  const res = await sync(agent, [good, noConsent, badPhone]);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ created: 1, error: 2 });
  const by = Object.fromEntries(res.body.results.map((x) => [x.clientId, x]));
  expect(by[good.clientId].status).toBe('created');
  expect(by[noConsent.clientId]).toMatchObject({ status: 'error', errorCode: 'VALIDATION_ERROR' });
  expect(by[badPhone.clientId]).toMatchObject({ status: 'error', errorCode: 'INVALID_PHONE' });
  expect(await Farmer.countDocuments()).toBe(1);
});

test('a person already on record goes to duplicate review, without an ID', async () => {
  const first = rec({ name: 'Same Person', phone: '08000008001' });
  await sync(agent, [first]);
  const res = await sync(other, [rec({ name: 'Same Person', phone: '08000008001' })]);
  expect(res.body.duplicate_review).toBe(1);
  const dup = res.body.results[0];
  expect(dup.farmaslogId).toBeNull();
});

test('the phone\'s clock: a future capture time and a very old one are refused', async () => {
  const future = rec({ capturedAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
  const old = rec({ capturedAt: new Date(Date.now() - 200 * 24 * 3600_000).toISOString() });
  const res = await sync(agent, [future, old]);
  expect(res.body.results.map((x) => x.errorCode)).toEqual(['BAD_CAPTURE_TIME', 'TOO_OLD']);
  expect(await Farmer.countDocuments()).toBe(0);
});

test('the phone cannot choose source, channel or reference', async () => {
  const res = await sync(agent, [rec({ source: 'admin' }), rec({ sourceRef: 'webform:FB-1' }), rec({ sourceChannel: 'csv_import' })]);
  expect(res.body.error).toBe(3);
  expect(await Farmer.countDocuments()).toBe(0);
});

test('only staff who register farmers can sync; empty and oversized batches are refused', async () => {
  expect((await request(app).post('/v1/farmers/sync').send({ records: [rec()] })).status).toBe(401);
  expect((await sync(agent, [])).status).toBe(400);
  expect((await sync(agent, Array.from({ length: 26 }, () => rec()))).status).toBe(400);
  expect((await sync(manager, [rec()])).status).toBe(200);
});

test('audit: each farmer is audited as usual and the batch is summarised without personal details', async () => {
  const r = rec();
  await sync(agent, [r, rec({ phone: '123' })]);
  expect(await AuditLog.countDocuments({ action: 'farmer.registered' })).toBe(1);
  const batch = await AuditLog.findOne({ action: 'farmer.offline_sync' }).lean();
  expect(batch.changes).toEqual({ created: 1, already_synced: 0, duplicate_review: 0, error: 1 });
});

describe('registering online with the app reference', () => {
  const post = (token, body) => request(app).post('/v1/farmers').set('Authorization', `Bearer ${token}`).send(body);
  test('an agent\'s own reference makes a retry safe, and the same record uploaded later is recognised', async () => {
    const me = (await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${agent}`)).body.user;
    const clientId = 'retry-0001-aaaaaaaa';
    const body = { ...rec({ clientId: undefined, capturedAt: undefined }), sourceRef: `app:${me.id}:${clientId}`, sourceChannel: 'field_app' };
    delete body.clientId; delete body.capturedAt;
    const first = await post(agent, body);
    expect(first.status).toBe(201);
    const again = await post(agent, body); // the first answer was lost, the phone tries again
    expect(again.status).toBe(200);
    expect(again.body.alreadyImported).toBe(true);
    const viaSync = await sync(agent, [{ ...rec({ name: body.name, phone: body.phone }), clientId }]);
    expect(viaSync.body.already_synced).toBe(1);
    expect(await Farmer.countDocuments()).toBe(1);
  });
  test('an agent cannot use another agent\'s reference namespace or an import reference', async () => {
    const base = rec(); delete base.clientId; delete base.capturedAt;
    expect((await post(agent, { ...base, sourceRef: 'webform:FB-1' })).status).toBe(400);
    expect((await post(agent, { ...base, sourceRef: 'app:aaaaaaaaaaaaaaaaaaaaaaaa:xxxxxxxx' })).status).toBe(400);
  });
});
