import request from 'supertest';
import { AuditLog } from '../../src/models/AuditLog.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, admin, manager, agent;
const get = (t) => request(app).get('/v1/admin/consent-details').set('Authorization', `Bearer ${t}`);
const put = (t, body) => request(app).put('/v1/admin/consent-details').set('Authorization', `Bearer ${t}`).send(body);
const row = (r, k) => r.body.data.find((d) => d.key === k);

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('super_admin', 'admin@c.test'); await makeUser('data_manager', 'dm@c.test'); await makeUser('field_agent', 'ag@c.test');
  admin = await login(app, 'admin@c.test'); manager = await login(app, 'dm@c.test'); agent = await login(app, 'ag@c.test');
});
afterAll(() => env?.stop());

test('defaults are FarmasLog\'s published contact details; address, retention and hosting are still missing', async () => {
  const r = await get(admin);
  expect(r.status).toBe(200);
  expect(row(r, 'phone')).toMatchObject({ value: '0802 863 8349', source: 'default' });
  expect(row(r, 'email').value).toBe('info@frankiecode.org.ng');
  expect(row(r, 'whatsapp').value).toBe('0706 758 4686');
  expect(row(r, 'registeredAddress').source).toBe('missing');
  expect(r.body.incomplete).toBe(true);
  expect(r.body.missingPlaceholders).toEqual(expect.arrayContaining(['registeredAddress', 'retention', 'hosting']));
});

test('only the administrator can edit; data managers can read; field agents cannot', async () => {
  expect((await get(manager)).status).toBe(200);
  expect((await get(agent)).status).toBe(403);
  expect((await put(manager, { retention: '2 years' })).status).toBe(403);
  expect((await put(agent, { retention: '2 years' })).status).toBe(403);
});

test('validation: empty body, bad email and bad phone are refused', async () => {
  expect((await put(admin, {})).status).toBe(400);
  expect((await put(admin, { email: 'not-an-email' })).status).toBe(400);
  expect((await put(admin, { phone: 'call me' })).status).toBe(400);
});

test('saving changes the consent text new farmers see, and is audited', async () => {
  const r = await put(admin, { registeredAddress: '12 Test Road, Makurdi, Benue', retention: '2 years after the last update', hosting: 'MongoDB Atlas (Ireland)' });
  expect(r.status).toBe(200);
  expect(r.body.changed.sort()).toEqual(['hosting', 'registeredAddress', 'retention']);
  expect(row(r, 'registeredAddress')).toMatchObject({ value: '12 Test Road, Makurdi, Benue', source: 'saved' });
  expect(r.body.incomplete).toBe(false);
  const c = await request(app).get('/v1/reference/consent?lang=en');
  expect(c.body.text).toContain('12 Test Road, Makurdi, Benue');
  expect(c.body.incomplete).toBe(false);
  const log = await AuditLog.findOne({ action: 'settings.consent_details_updated' }).lean();
  expect(Object.keys(log.changes).sort()).toEqual(['hosting', 'registeredAddress', 'retention']);
});

test('an empty value removes the saved value and falls back to the default', async () => {
  const r = await put(admin, { phone: '' });
  expect(row(r, 'phone')).toMatchObject({ value: '0802 863 8349', source: 'default' });
  expect(r.body.changed).toEqual([]);
});
