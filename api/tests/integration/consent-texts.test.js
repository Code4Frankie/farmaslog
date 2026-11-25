import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, admin, manager, agent;
const auth = (r, t) => r.set('Authorization', `Bearer ${t}`);
const api = {
  list: (t) => auth(request(app).get('/v1/admin/consent-texts'), t),
  create: (t, body = {}) => auth(request(app).post('/v1/admin/consent-texts'), t).send(body),
  get: (t, v, q = '') => auth(request(app).get(`/v1/admin/consent-texts/${v}${q}`), t),
  save: (t, v, lang, body) => auth(request(app).put(`/v1/admin/consent-texts/${v}/${lang}`), t).send(body),
  drop: (t, v) => auth(request(app).delete(`/v1/admin/consent-texts/${v}`), t),
  publish: (t, v, body) => auth(request(app).post(`/v1/admin/consent-texts/${v}/publish`), t).send(body),
  details: (t, body) => auth(request(app).put('/v1/admin/consent-details'), t).send(body),
};
const reg = (phone, version) => ({
  name: `Text Test ${phone}`, phone, state: 'Benue', lga: 'Vandeikya', isSynthetic: true, farm: { crop: 'Maize', reportedAreaHa: 1 },
  consent: { given: true, wordingVersion: version, language: 'en', method: 'agent_read_aloud', partnerSharing: true },
});
const postFarmer = (t, body) => auth(request(app).post('/v1/farmers'), t).send(body);
const edited = (t) => ({ title: t.title, sections: t.sections, agreementsIntro: t.agreementsIntro, agreements: t.agreements, readAloud: t.readAloud, agentNote: t.agentNote });

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('super_admin', 'admin@t.test'); await makeUser('data_manager', 'dm@t.test'); await makeUser('field_agent', 'ag@t.test');
  admin = await login(app, 'admin@t.test'); manager = await login(app, 'dm@t.test'); agent = await login(app, 'ag@t.test');
});
afterAll(() => env?.stop());

test('the built-in wording is the current version to start with', async () => {
  const r = await api.list(admin);
  expect(r.status).toBe(200);
  expect(r.body.current).toBe('consent-v1-draft');
  expect(r.body.data.find((v) => v.builtIn)).toMatchObject({ version: 'consent-v1-draft', current: true, status: 'published' });
});

test('roles: data manager can read, only the administrator can change, agents see nothing', async () => {
  expect((await api.list(manager)).status).toBe(200);
  expect((await api.list(agent)).status).toBe(403);
  expect((await api.create(manager)).status).toBe(403);
  expect((await api.create(agent)).status).toBe(403);
});

test('a draft starts as a copy of the current English text; only one draft at a time', async () => {
  const r = await api.create(admin, { notes: 'Plain-language rewrite' });
  expect(r.status).toBe(201);
  expect(r.body.data).toMatchObject({ version: 'consent-v2', status: 'draft', current: false });
  expect(r.body.data.texts.en.title).toBe('FarmasLog: Farmer consent');
  expect((await api.create(admin)).status).toBe(409);
});

test('editing validates the text, including unknown placeholders', async () => {
  const draft = (await api.get(admin, 'consent-v2')).body.data;
  const body = edited(draft.texts.en);
  const bad = await api.save(admin, 'consent-v2', 'en', { ...body, readAloud: 'Call us on {{faxNumber}}.' });
  expect(bad.status).toBe(400);
  expect(JSON.stringify(bad.body)).toMatch(/faxNumber/);
  expect((await api.save(admin, 'consent-v2', 'en', { ...body, sections: [] })).status).toBe(400);
  expect((await api.save(manager, 'consent-v2', 'en', body)).status).toBe(403);
  const ok = await api.save(admin, 'consent-v2', 'en', { ...body, title: 'FarmasLog: Farmer consent (v2)' });
  expect(ok.status).toBe(200);
  expect(ok.body.data.preview.title).toBe('FarmasLog: Farmer consent (v2)');
});

test('a reviewed translation needs a reviewer name; an unreviewed one is still served in English', async () => {
  const body = edited((await api.get(admin, 'consent-v2')).body.data.texts.en);
  expect((await api.save(admin, 'consent-v2', 'ha', { ...body, reviewed: true })).status).toBe(400);
  const r = await api.save(admin, 'consent-v2', 'ha', { ...body, title: 'Yarjejeniyar manomi', reviewed: false });
  expect(r.status).toBe(200);
  expect(r.body.data.preview.textLanguage).toBe('en');
  expect(r.body.data.preview.needsTranslation).toBe(true);
  expect(r.body.data.languages.find((l) => l.language === 'ha')).toMatchObject({ reviewed: false });
});

test('publishing is blocked while contact details are missing, and needs an explicit re-consent choice', async () => {
  expect((await api.publish(admin, 'consent-v2', {})).status).toBe(400);
  const r = await api.publish(admin, 'consent-v2', { reconsent: 'none' });
  expect(r.status).toBe(422);
  expect(r.body.errorCode).toBe('INCOMPLETE_DETAILS');
  expect(JSON.stringify(r.body)).toMatch(/retention/);
});

test('publishing with re-consent flags valid records on the old wording; new consents must use the new version', async () => {
  const older = await postFarmer(agent, reg('08000000201', 'consent-v1-draft'));
  expect(older.status).toBe(201);
  expect((await api.details(admin, { registeredAddress: '12 Test Road, Makurdi', retention: '2 years', hosting: 'MongoDB Atlas' })).status).toBe(200);

  const pub = await api.publish(admin, 'consent-v2', { reconsent: 'flag' });
  expect(pub.status).toBe(200);
  expect(pub.body.data).toMatchObject({ version: 'consent-v2', status: 'published', current: true, flaggedCount: 1 });
  expect((await Farmer.findById(older.body.id)).consentStatus).toBe('needs_reconsent');

  const listed = await api.list(admin);
  expect(listed.body.current).toBe('consent-v2');
  expect((await postFarmer(agent, reg('08000000202', 'consent-v1-draft'))).status).toBe(400);
  const fresh = await postFarmer(agent, reg('08000000203', 'consent-v2'));
  expect(fresh.status).toBe(201);
  expect(fresh.body.consent.wordingVersion).toBe('consent-v2');
  expect(fresh.body.consentStatus).toBe('valid');
  expect(fresh.body.consent.textHash).toMatch(/^[0-9a-f]{64}$/);
});

test('the public consent endpoint serves the new wording; old versions can still be read', async () => {
  const now = await request(app).get('/v1/reference/consent');
  expect(now.body).toMatchObject({ version: 'consent-v2', incomplete: false });
  expect(now.body.title).toBe('FarmasLog: Farmer consent (v2)');
  const old = await request(app).get('/v1/reference/consent').query({ version: 'consent-v1-draft' });
  expect(old.body.title).toBe('FarmasLog: Farmer consent');
});

test('a published version cannot be edited or discarded', async () => {
  const body = edited((await api.get(admin, 'consent-v2')).body.data.texts.en);
  const r = await api.save(admin, 'consent-v2', 'en', { ...body, title: 'Sneaky change' });
  expect(r.status).toBe(409);
  expect((await api.drop(admin, 'consent-v2')).status).toBe(409);
  expect((await api.get(admin, 'consent-v2')).body.data.texts.en.title).toBe('FarmasLog: Farmer consent (v2)');
});

test('a draft can be discarded, and the next draft is named consent-v3', async () => {
  const c = await api.create(admin);
  expect(c.body.data.version).toBe('consent-v3');
  expect((await api.drop(admin, 'consent-v3')).status).toBe(204);
  expect((await api.get(admin, 'consent-v3')).status).toBe(404);
});

test('every change is audited without copying the text itself', async () => {
  const logs = await AuditLog.find({ action: /^consent_text\./ }).lean();
  const actions = logs.map((l) => l.action);
  expect(actions).toEqual(expect.arrayContaining(['consent_text.draft_created', 'consent_text.draft_updated', 'consent_text.published', 'consent_text.draft_discarded']));
  expect(JSON.stringify(logs)).not.toMatch(/Plain-language|Yarjejeniyar|Sneaky|FarmasLog: Farmer consent/);
  expect(logs.find((l) => l.action === 'consent_text.published').changes).toMatchObject({ version: 'consent-v2', reconsent: 'flag', flaggedCount: 1 });
});
