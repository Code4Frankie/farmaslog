import request from 'supertest';
import { User } from '../../src/models/User.js';
import { Farmer } from '../../src/models/Farmer.js';
import { Farm } from '../../src/models/Farm.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, agent, other, nopatch, manager;
const consent = { given: true, wordingVersion: 'consent-v1-draft', language: 'en', method: 'agent_checkbox', partnerSharing: true };
let n = 0;
const reg = (over = {}) => ({
  name: `Agent Test ${++n}`, phone: `0800000${String(6000 + n)}`, state: 'Benue', lga: 'Vandeikya', consent, isSynthetic: true,
  farm: { crop: 'Maize', reportedAreaHa: 1 }, ...over,
});
const as = (token) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${token}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${token}`).send(b),
});
// A registered AND approved farmer, registered by `who`.
async function approved(who, over) {
  const r = await as(who).post('/v1/farmers', reg(over));
  expect(r.status).toBe(201);
  const ok = await as(manager).post(`/v1/farmers/${r.body.id}/review`, { decision: 'approve' });
  expect(ok.status).toBe(200);
  return r.body;
}

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('field_agent', 'a@a.test'); await makeUser('field_agent', 'o@a.test'); await makeUser('field_agent', 'n@a.test'); await makeUser('data_manager', 'dm@a.test');
  await User.updateOne({ email: 'a@a.test' }, { state: 'benue', lga: 'vandeikya' }); // typed loosely: matched to the national list
  await User.updateOne({ email: 'o@a.test' }, { state: 'Kogi', lga: 'Lokoja' });
  agent = await login(app, 'a@a.test'); other = await login(app, 'o@a.test'); nopatch = await login(app, 'n@a.test'); manager = await login(app, 'dm@a.test');
});
afterAll(() => env?.stop());
beforeEach(async () => { await Farmer.deleteMany({}); await Farm.deleteMany({}); });

describe('farms to visit', () => {
  test('own approved farmers and approved farmers in the patch (including ones registered by others) are listed; others are not', async () => {
    const mine = await approved(agent);
    const inPatch = await approved(manager); // registered by someone else, same patch
    await approved(manager, { state: 'Kogi', lga: 'Lokoja' }); // another patch
    await as(agent).post('/v1/farmers', reg()); // own but still pending review
    await as(manager).post('/v1/farmers', reg()); // someone else's, pending
    const r = await as(agent).get('/v1/agent/visits');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    const byId = Object.fromEntries(r.body.data.map((f) => [f.id, f.visitScope]));
    expect(byId).toEqual({ [mine.id]: 'mine', [inPatch.id]: 'area' });
  });
  test('scope filter, and an agent without a patch only sees their own', async () => {
    await approved(agent); await approved(manager);
    expect((await as(agent).get('/v1/agent/visits?scope=mine')).body.total).toBe(1);
    expect((await as(agent).get('/v1/agent/visits?scope=area')).body.total).toBe(1);
    expect((await as(nopatch).get('/v1/agent/visits')).body.total).toBe(0);
    await approved(nopatch);
    expect((await as(nopatch).get('/v1/agent/visits')).body.total).toBe(1);
    expect((await as(nopatch).get('/v1/agent/visits?scope=area')).body.total).toBe(0);
  });
  test('a farmer who withdrew consent is not offered for a visit', async () => {
    const f = await approved(agent);
    await as(agent).post(`/v1/farmers/${f.id}/consent-withdrawal`, {});
    expect((await as(agent).get('/v1/agent/visits')).body.total).toBe(0);
  });
  test('a confirmed visit takes the farmer off the list', async () => {
    const f = await approved(manager);
    const v = await as(agent).post(`/v1/farmers/${f.id}/field-verification`, { outcome: 'verified', method: 'site_visit', location: { lat: 7.3, lng: 9.0, accuracyMeters: 10 } });
    expect(v.status).toBe(200);
    expect(v.body.farm.evidence.status).toBe('field_verified');
    expect((await as(agent).get('/v1/agent/visits')).body.total).toBe(0);
    expect((await as(agent).get('/v1/agent/summary')).body.verifiedByMe).toBe(1);
  });
  test('only agents can use the console', async () => {
    expect((await as(manager).get('/v1/agent/summary')).status).toBe(403);
    expect((await request(app).get('/v1/agent/visits')).status).toBe(401);
  });
});

describe('what an agent may touch', () => {
  test('can open and verify a farmer in their patch, but not one in another patch', async () => {
    const inPatch = await approved(manager);
    const elsewhere = await approved(manager, { state: 'Kogi', lga: 'Lokoja' });
    expect((await as(agent).get(`/v1/farmers/${inPatch.id}`)).status).toBe(200);
    expect((await as(agent).get(`/v1/farmers/${elsewhere.id}`)).status).toBe(404);
    expect((await as(agent).post(`/v1/farmers/${elsewhere.id}/field-verification`, { outcome: 'verified', method: 'site_visit' })).status).toBe(404);
  });
  test('cannot change consent on a farmer someone else registered, even in their patch', async () => {
    const inPatch = await approved(manager);
    expect((await as(agent).post(`/v1/farmers/${inPatch.id}/consent-withdrawal`, {})).status).toBe(404);
    expect((await as(agent).post(`/v1/farmers/${inPatch.id}/reconsent`, { consent })).status).toBe(404);
    const mine = await approved(agent);
    expect((await as(agent).post(`/v1/farmers/${mine.id}/consent-withdrawal`, {})).status).toBe(200);
  });
  test('the Farmers list still shows only their own registrations', async () => {
    await approved(agent); await approved(manager);
    expect((await as(agent).get('/v1/farmers')).body.total).toBe(1);
  });
  test('a pending farmer in the patch is not reachable', async () => {
    const r = await as(manager).post('/v1/farmers', reg());
    expect((await as(agent).get(`/v1/farmers/${r.body.id}`)).status).toBe(404);
  });
});

describe('summary', () => {
  test('counts own registrations by status and the visits waiting', async () => {
    await approved(agent); await approved(agent);
    await as(agent).post('/v1/farmers', reg()); // pending
    await approved(manager);
    const s = (await as(agent).get('/v1/agent/summary')).body;
    expect(s).toMatchObject({ registered: 3, byStatus: { active: 2, pending_review: 1 }, visitsWaiting: { mine: 2, area: 1 }, verifiedByMe: 0, patch: { state: 'Benue', lga: 'Vandeikya' } });
    expect((await as(nopatch).get('/v1/agent/summary')).body.patch).toBeNull();
  });
});
