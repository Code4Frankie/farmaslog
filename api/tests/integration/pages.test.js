import request from 'supertest';
import { AuditLog } from '../../src/models/AuditLog.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, admin, manager, agent;
const auth = (r, t) => r.set('Authorization', `Bearer ${t}`);
const get = (t, slug) => auth(request(app).get(`/v1/admin/pages/${slug}`), t);
const put = (t, slug, body) => auth(request(app).put(`/v1/admin/pages/${slug}`), t).send(body);
const publish = (t, slug) => auth(request(app).post(`/v1/admin/pages/${slug}/publish`), t);
const body = { title: 'FarmasLog privacy notice', sections: [{ heading: 'Contact', body: 'Write to {{email}}.' }, { heading: 'Keeping data', body: 'We keep records for {{retention}}.' }] };

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('super_admin', 'admin@p.test'); await makeUser('data_manager', 'dm@p.test'); await makeUser('field_agent', 'ag@p.test');
  admin = await login(app, 'admin@p.test'); manager = await login(app, 'dm@p.test'); agent = await login(app, 'ag@p.test');
});
afterAll(() => env?.stop());

test('nothing is public until an administrator publishes it', async () => {
  expect((await request(app).get('/v1/reference/pages/privacy')).status).toBe(404);
  expect((await request(app).get('/v1/reference/pages/nonsense')).status).toBe(404);
});

test('the editor starts with starter wording, flagged as a starter', async () => {
  const r = await get(admin, 'privacy');
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ slug: 'privacy', isStarter: true, published: null });
  expect(r.body.data.sections.length).toBeGreaterThan(3);
  expect((await get(manager, 'terms')).status).toBe(200);
  expect((await get(agent, 'terms')).status).toBe(403);
  expect((await get(admin, 'cookies')).status).toBe(404);
});

test('only the administrator can save or publish; the starter cannot be published without saving', async () => {
  expect((await put(manager, 'privacy', body)).status).toBe(403);
  expect((await publish(manager, 'privacy')).status).toBe(403);
  expect((await publish(admin, 'privacy')).status).toBe(409);
  expect((await put(admin, 'privacy', { title: 'x', sections: [] })).status).toBe(400);
  expect((await put(admin, 'privacy', { ...body, sections: [{ heading: 'Hi', body: 'Fax {{fax}}' }] })).status).toBe(400);
});

test('publishing waits for the contact details the page uses', async () => {
  const saved = await put(admin, 'privacy', body);
  expect(saved.status).toBe(200);
  expect(saved.body.data.missingPlaceholders).toContain('retention');
  expect((await publish(admin, 'privacy')).status).toBe(422);
  expect((await request(app).get('/v1/reference/pages/privacy')).status).toBe(404);
});

test('published pages are public with details filled in, and each publish is a new version', async () => {
  await auth(request(app).put('/v1/admin/consent-details'), admin).send({ retention: '2 years' });
  const p1 = await publish(admin, 'privacy');
  expect(p1.status).toBe(200);
  expect(p1.body.data.published.version).toBe(1);
  const pub = await request(app).get('/v1/reference/pages/privacy');
  expect(pub.status).toBe(200);
  expect(pub.body).toMatchObject({ slug: 'privacy', version: 1, title: 'FarmasLog privacy notice' });
  expect(pub.body.sections[0].body).toBe('Write to info@frankiecode.org.ng.');
  expect(pub.body.sections[1].body).toBe('We keep records for 2 years.');

  await put(admin, 'privacy', { ...body, title: 'FarmasLog privacy notice (updated)' });
  expect((await request(app).get('/v1/reference/pages/privacy')).body.title).toBe('FarmasLog privacy notice');
  const p2 = await publish(admin, 'privacy');
  expect(p2.body.data.published.version).toBe(2);
  expect(p2.body.data.history.map((h) => h.version)).toEqual([1, 2]);
  expect((await request(app).get('/v1/reference/pages/privacy')).body.title).toBe('FarmasLog privacy notice (updated)');
});

test('page changes are audited without the text', async () => {
  const logs = await AuditLog.find({ action: /^page\./ }).lean();
  expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['page.draft_saved', 'page.published']));
  expect(JSON.stringify(logs)).not.toMatch(/We keep records|Write to/);
});
