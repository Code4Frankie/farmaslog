import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { startTestEnv, makeUser, login, makePartnerKey } from '../helpers/setup.js';

let env, app, agent, manager, partner, key;
const consent = { given: true, wordingVersion: 'consent-v1-draft', language: 'en', method: 'agent_checkbox', partnerSharing: true };
let n = 0;
const reg = (over = {}) => ({
  name: `Incl Farmer ${++n}`, phone: `0800000${String(3000 + n)}`, state: 'Benue', lga: 'Vandeikya', consent, isSynthetic: true,
  farm: { crop: 'Maize', reportedAreaHa: 1 }, ...over,
});
const post = (token, body) => request(app).post('/v1/farmers').set('Authorization', `Bearer ${token}`).send(body);
const stats = (token, q = {}) => request(app).get('/v1/admin/inclusion-stats').set('Authorization', `Bearer ${token}`).query(q);
const get = (body, k) => body.breakdown[k].reduce((o, c) => ({ ...o, [c.value]: c }), {});

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('field_agent', 'agent@i.test'); await makeUser('data_manager', 'dm@i.test');
  agent = await login(app, 'agent@i.test'); manager = await login(app, 'dm@i.test');
  const p = await makePartnerKey(); key = p.fullKey;
  await makeUser('partner_verifier', 'pv@i.test', p.partner?._id ?? p.partnerId);
  partner = await login(app, 'pv@i.test');
});
afterAll(() => env?.stop());

describe('inclusion fields are optional and validated', () => {
  test('registers without them', async () => {
    const r = await post(agent, reg());
    expect(r.status).toBe(201);
    expect(r.body.inclusion).toEqual({ gender: null, ageBand: null, disability: null });
  });
  test('registers with them and echoes them to staff', async () => {
    const r = await post(agent, reg({ inclusion: { gender: 'female', ageBand: '25_34', disability: 'none' } }));
    expect(r.status).toBe(201);
    expect(r.body.inclusion).toEqual({ gender: 'female', ageBand: '25_34', disability: 'none' });
  });
  test('"prefer_not_to_say" is accepted; unknown values and date of birth are refused', async () => {
    expect((await post(agent, reg({ inclusion: { gender: 'prefer_not_to_say' } }))).status).toBe(201);
    expect((await post(agent, reg({ inclusion: { gender: 'robot' } }))).status).toBe(400);
    expect((await post(agent, reg({ inclusion: { dateOfBirth: '1990-01-01' } }))).status).toBe(400);
    expect((await post(agent, reg({ inclusion: {} }))).status).toBe(400);
  });
  test('a data manager can add or correct a field; only sent fields change; audited', async () => {
    const created = (await post(agent, reg({ inclusion: { gender: 'male', ageBand: '35_44' } }))).body;
    const r = await request(app).patch(`/v1/farmers/${created.id}`).set('Authorization', `Bearer ${manager}`).send({ inclusion: { disability: 'yes' } });
    expect(r.status).toBe(200);
    expect(r.body.inclusion).toEqual({ gender: 'male', ageBand: '35_44', disability: 'yes' });
    const log = await AuditLog.findOne({ action: 'farmer.updated', entityId: created.id }).sort({ createdAt: -1 }).lean();
    expect(Object.keys(log.changes)).toContain('inclusion.disability');
  });
});

describe('inclusion data never reaches partners', () => {
  test('/v1/verify does not return inclusion fields', async () => {
    const f = (await post(agent, reg({ phone: '08000009001', inclusion: { gender: 'female', ageBand: '25_34', disability: 'yes' } }))).body;
    await request(app).post(`/v1/farmers/${f.id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
    const r = await request(app).get('/v1/verify').set('Authorization', `Bearer ${key}`).query({ phone: '08000009001' });
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/gender|ageBand|disability|inclusion/);
  });
  test('partner users and field agents cannot read the stats', async () => {
    expect((await stats(partner)).status).toBe(403);
    expect((await stats(agent)).status).toBe(403);
    expect((await request(app).get('/v1/admin/inclusion-stats')).status).toBe(401);
  });
});

describe('GET /v1/admin/inclusion-stats', () => {
  beforeAll(async () => {
    await Farmer.deleteMany({});
    // Kogi: 6 female, 2 male (small group), 1 unanswered. Plateau: 3 farmers only.
    for (let i = 0; i < 6; i++) await post(agent, reg({ state: 'Kogi', lga: 'Lokoja', inclusion: { gender: 'female', ageBand: '25_34' } }));
    for (let i = 0; i < 2; i++) await post(agent, reg({ state: 'Kogi', lga: 'Lokoja', inclusion: { gender: 'male', ageBand: '25_34' } }));
    await post(agent, reg({ state: 'Kogi', lga: 'Lokoja' }));
    for (let i = 0; i < 3; i++) await post(agent, reg({ state: 'Plateau', lga: 'Jos North', inclusion: { gender: 'female' } }));
  });

  test('counts by category, with "not_recorded" for unanswered; small groups hidden', async () => {
    const r = await stats(manager, { state: 'Kogi' });
    expect(r.status).toBe(200);
    expect(r.body.total).toEqual({ count: 9, suppressed: false });
    const g = get(r.body, 'gender');
    expect(g.female).toEqual({ value: 'female', count: 6, suppressed: false });
    expect(g.male.suppressed).toBe(true);
    expect(g.male.count).toBeNull();
    expect(g.not_recorded.suppressed).toBe(true); // 1 farmer
    expect(g.other.count).toBe(0);
  });
  test('a lone hidden group cannot be worked out by subtraction', async () => {
    // Kogi ageBand: 8 in 25_34 and 1 not_recorded -> not_recorded is hidden, so 25_34 must be hidden too.
    const r = await stats(manager, { state: 'Kogi' });
    const a = get(r.body, 'ageBand');
    expect(a.not_recorded.suppressed).toBe(true);
    expect(a['25_34'].suppressed).toBe(true);
  });
  test('an area with fewer than 5 farmers is fully hidden when grouped', async () => {
    const r = await stats(manager, { groupBy: 'state' });
    const plateau = r.body.areas.find((x) => x.area === 'Plateau');
    expect(plateau).toEqual({ area: 'Plateau', total: null, suppressed: true });
    const kogi = r.body.areas.find((x) => x.area === 'Kogi');
    expect(kogi.total).toBe(9);
    expect(kogi.gender.female).toBe(6);
    expect(kogi.gender.male).toBeNull();
  });
  test('rejected and withdrawn farmers are not counted', async () => {
    await Farmer.updateMany({ state: 'Kogi', 'inclusion.gender': 'female' }, { $set: { consentStatus: 'withdrawn' } });
    const r = await stats(manager, { state: 'Kogi' });
    expect(get(r.body, 'gender').female.count).toBe(0);
  });
  test('rejects a bad groupBy', async () => {
    expect((await stats(manager, { groupBy: 'name' })).status).toBe(400);
  });
});
