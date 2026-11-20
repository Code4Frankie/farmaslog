import request from 'supertest';
import { Partner } from '../../src/models/Partner.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, admin, nancy, other;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('super_admin', 'admin@me.test');
  const p1 = await Partner.create({ organization: 'Bank One' }); const p2 = await Partner.create({ organization: 'Bank Two' });
  await makeUser('partner_verifier', 'nancy@me.test', p1._id); await makeUser('partner_verifier', 'other@me.test', p2._id);
  await makeUser('field_agent', 'agent@me.test');
  [admin, nancy, other] = [await login(app, 'admin@me.test'), await login(app, 'nancy@me.test'), await login(app, 'other@me.test')];
});
afterAll(() => env?.stop());

test('a partner creates, lists and revokes their own keys; the secret is shown once and the key works', async () => {
  const c = await request(app).post('/v1/me/api-keys').set(auth(nancy)).send({ name: 'sandbox' });
  expect(c.status).toBe(201);
  expect(c.body.apiKey).toMatch(/^sk_test_/);
  expect(c.body.mode).toBe('test');
  const list = await request(app).get('/v1/me/api-keys').set(auth(nancy));
  expect(list.body.data).toHaveLength(1);
  expect(JSON.stringify(list.body)).not.toContain(c.body.apiKey);
  expect((await request(app).get('/v1/verify').query({ phone: '08000000099' }).set(auth(c.body.apiKey))).status).toBe(404); // key accepted, no such farmer
  expect((await request(app).post(`/v1/me/api-keys/${c.body.id}/revoke`).set(auth(other))).status).toBe(404); // not their key
  expect((await request(app).post(`/v1/me/api-keys/${c.body.id}/revoke`).set(auth(nancy))).status).toBe(200);
  expect((await request(app).get('/v1/verify').query({ phone: '08000000099' }).set(auth(c.body.apiKey))).body.errorCode).toBe('API_KEY_REVOKED');
});

test('limit of 5 active keys; other roles are refused; an unapproved partner cannot create keys', async () => {
  for (let i = 0; i < 5; i++) expect((await request(app).post('/v1/me/api-keys').set(auth(other)).send({ name: `k${i}` })).status).toBe(201);
  expect((await request(app).post('/v1/me/api-keys').set(auth(other)).send({ name: 'sixth' })).body.errorCode).toBe('KEY_LIMIT');
  expect((await request(app).get('/v1/me/api-keys').set(auth(admin))).status).toBe(403);
  expect((await request(app).get('/v1/me/api-keys').set(auth(await login(app, 'agent@me.test')))).status).toBe(403);
  const p = await Partner.create({ organization: 'Pending Co', status: 'pending' });
  await makeUser('partner_verifier', 'pend@me.test', p._id);
  expect((await request(app).post('/v1/me/api-keys').set(auth(await login(app, 'pend@me.test'))).send({ name: 'xx' })).body.errorCode).toBe('PARTNER_NOT_ACTIVE');
});

test('an admin can reject an access request: the user can never sign in', async () => {
  await request(app).post('/v1/auth/signup').send({ organization: 'Spam Ltd', name: 'Spam', email: 'spam@me.test', password: 'a-long-passphrase-1' });
  const p = await Partner.findOne({ organization: 'Spam Ltd' });
  expect((await request(app).post(`/v1/partners/${p._id}/reject`).set(auth(admin))).status).toBe(200);
  expect((await request(app).post(`/v1/partners/${p._id}/reject`).set(auth(admin))).status).toBe(409);
  expect((await request(app).post('/v1/auth/login').send({ email: 'spam@me.test', password: 'a-long-passphrase-1' })).status).toBe(401);
});
