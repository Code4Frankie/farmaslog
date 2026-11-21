import request from 'supertest';
import { User } from '../../src/models/User.js';
import { startTestEnv, makeUser, login, PASSWORD } from '../helpers/setup.js';

let env, app, admin, adminUser;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const fresh = { name: 'Ada Agent', email: 'Ada.Agent@Farmaslog.test', role: 'field_agent' };
let temp, agentId, resetTemp;

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  adminUser = await makeUser('super_admin', 'admin@staff.test');
  admin = await login(app, 'admin@staff.test');
});
afterAll(() => env?.stop());

test('only a super admin can onboard staff, and only for staff roles', async () => {
  expect((await request(app).post('/v1/staff').send(fresh)).status).toBe(401);
  await makeUser('data_manager', 'dm@staff.test');
  const dm = await login(app, 'dm@staff.test');
  expect((await request(app).post('/v1/staff').set(auth(dm)).send(fresh)).status).toBe(403);
  expect((await request(app).post('/v1/staff').set(auth(admin)).send({ ...fresh, role: 'super_admin' })).status).toBe(400);
  expect((await request(app).post('/v1/staff').set(auth(admin)).send({ ...fresh, role: 'partner_verifier' })).status).toBe(400);
});

test('creating a team member returns a one-time temporary password and flags the account', async () => {
  const r = await request(app).post('/v1/staff').set(auth(admin)).send(fresh);
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ email: 'ada.agent@farmaslog.test', role: 'field_agent', mustChangePassword: true });
  expect(r.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
  temp = r.body.temporaryPassword; agentId = r.body.id;
  const list = await request(app).get('/v1/staff').set(auth(admin));
  expect(list.body.data.map((u) => u.email)).toContain('ada.agent@farmaslog.test');
  expect(JSON.stringify(list.body)).not.toContain(temp);
  expect((await request(app).post('/v1/staff').set(auth(admin)).send(fresh)).status).toBe(409);
});

test('a temporary password only opens the change-password door', async () => {
  const l = await request(app).post('/v1/auth/login').send({ email: 'ada.agent@farmaslog.test', password: temp });
  expect(l.status).toBe(200);
  expect(l.body.user.mustChangePassword).toBe(true);
  const t = l.body.token;
  expect((await request(app).get('/v1/auth/me').set(auth(t))).body.user.mustChangePassword).toBe(true);
  const blocked = await request(app).get('/v1/farmers').set(auth(t));
  expect(blocked.status).toBe(403);
  expect(blocked.body.errorCode).toBe('PASSWORD_CHANGE_REQUIRED');

  const bad = { currentPassword: temp };
  expect((await request(app).post('/v1/auth/change-password').set(auth(t)).send({ ...bad, newPassword: 'short' })).status).toBe(400);
  expect((await request(app).post('/v1/auth/change-password').set(auth(t)).send({ currentPassword: 'wrong-password-123', newPassword: 'a-brand-new-passphrase' })).body.errorCode).toBe('CURRENT_PASSWORD_WRONG');
  expect((await request(app).post('/v1/auth/change-password').set(auth(t)).send({ ...bad, newPassword: temp })).body.errorCode).toBe('PASSWORD_UNCHANGED');

  const ok = await request(app).post('/v1/auth/change-password').set(auth(t)).send({ ...bad, newPassword: 'a-brand-new-passphrase' });
  expect(ok.status).toBe(200);
  expect(ok.body.user.mustChangePassword).toBe(false);
  expect((await request(app).get('/v1/farmers').set(auth(t))).status).toBe(200);
  expect((await request(app).post('/v1/auth/login').send({ email: 'ada.agent@farmaslog.test', password: temp })).status).toBe(401);
  expect((await request(app).post('/v1/auth/login').send({ email: 'ada.agent@farmaslog.test', password: 'a-brand-new-passphrase' })).status).toBe(200);
});

test('reset issues a new temporary password; the old one stops working', async () => {
  const r = await request(app).post(`/v1/staff/${agentId}/reset-password`).set(auth(admin));
  expect(r.status).toBe(200);
  expect(r.body.mustChangePassword).toBe(true);
  expect((await request(app).post('/v1/auth/login').send({ email: 'ada.agent@farmaslog.test', password: 'a-brand-new-passphrase' })).status).toBe(401);
  resetTemp = r.body.temporaryPassword;
  expect((await request(app).post('/v1/auth/login').send({ email: 'ada.agent@farmaslog.test', password: resetTemp })).body.user.mustChangePassword).toBe(true);
});

test('disable blocks sign-in and live sessions; enable restores it', async () => {
  const before = await request(app).post('/v1/auth/login').send({ email: 'dm@staff.test', password: PASSWORD });
  expect((await request(app).post(`/v1/staff/${agentId}/status`).set(auth(admin)).send({ status: 'disabled' })).body.status).toBe('disabled');
  expect((await request(app).get('/v1/farmers').set(auth(before.body.token))).status).toBe(200); // other users unaffected
  const agentDoc = await User.findById(agentId);
  expect(agentDoc.status).toBe('disabled');
  expect((await request(app).post('/v1/auth/login').send({ email: 'ada.agent@farmaslog.test', password: resetTemp })).status).toBe(401);
  expect((await request(app).post(`/v1/staff/${agentId}/status`).set(auth(admin)).send({ status: 'active' })).body.status).toBe('active');
});

test('an administrator cannot disable or reset themselves or another administrator', async () => {
  expect((await request(app).post(`/v1/staff/${adminUser._id}/status`).set(auth(admin)).send({ status: 'disabled' })).status).toBe(400);
  expect((await request(app).post(`/v1/staff/${adminUser._id}/reset-password`).set(auth(admin))).status).toBe(400);
  const other = await makeUser('super_admin', 'admin2@staff.test');
  expect((await request(app).post(`/v1/staff/${other._id}/status`).set(auth(admin)).send({ status: 'disabled' })).status).toBe(403);
  expect((await request(app).post('/v1/staff/not-an-id/reset-password').set(auth(admin))).status).toBe(404);
});

test('anyone can change their own password with the current one', async () => {
  const t = await login(app, 'dm@staff.test');
  expect((await request(app).post('/v1/auth/change-password').set(auth(t)).send({ currentPassword: PASSWORD, newPassword: 'another-long-passphrase' })).status).toBe(200);
});
