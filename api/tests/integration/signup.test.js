import request from 'supertest';
import { Partner } from '../../src/models/Partner.js';
import { startTestEnv, makeUser, login } from '../helpers/setup.js';

let env, app, admin;
const body = { organization: 'Awe Agri Bank', type: 'bank', name: 'Nancy Test', email: 'nancy@awebank.test', password: 'a-long-passphrase-1' };

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('super_admin', 'admin@su.test');
  admin = await login(app, 'admin@su.test');
});
afterAll(() => env?.stop());

test('sign-up validation', async () => {
  expect((await request(app).post('/v1/auth/signup').send({ ...body, password: 'short' })).status).toBe(400);
  expect((await request(app).post('/v1/auth/signup').send({ ...body, email: 'not-an-email' })).status).toBe(400);
});

test('request access -> pending: cannot sign in, and a wrong password reveals nothing', async () => {
  const r = await request(app).post('/v1/auth/signup').send(body);
  expect(r.status).toBe(201);
  expect((await Partner.findOne({ organization: body.organization })).status).toBe('pending');
  const l = await request(app).post('/v1/auth/login').send({ email: body.email, password: body.password });
  expect(l.status).toBe(403);
  expect(l.body.errorCode).toBe('ACCOUNT_PENDING');
  expect((await request(app).post('/v1/auth/login').send({ email: body.email, password: 'wrong-password-123' })).body.errorCode).toBe('INVALID_CREDENTIALS');
});

test('same email cannot sign up twice', async () => {
  expect((await request(app).post('/v1/auth/signup').send(body)).status).toBe(409);
});

test('only a super admin can approve; then the user signs in and sees their organisation', async () => {
  const p = await Partner.findOne({ organization: body.organization });
  const list = await request(app).get('/v1/partners').query({ status: 'pending' }).set('Authorization', `Bearer ${admin}`);
  expect(list.body.data.map((x) => x.organization)).toContain(body.organization);

  expect((await request(app).post(`/v1/partners/${p._id}/approve`)).status).toBe(401);
  expect((await request(app).post(`/v1/partners/${p._id}/approve`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
  expect((await request(app).post(`/v1/partners/${p._id}/approve`).set('Authorization', `Bearer ${admin}`)).status).toBe(409);

  const l = await request(app).post('/v1/auth/login').send({ email: body.email, password: body.password });
  expect(l.status).toBe(200);
  expect(l.body.user).toMatchObject({ role: 'partner_verifier', organization: 'Awe Agri Bank' });
  const me = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${l.body.token}`);
  expect(me.body.user.organization).toBe('Awe Agri Bank');
});
