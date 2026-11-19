import request from 'supertest';
import { env as appEnv } from '../../src/config/env.js';
import { ensureBootstrapAdmin } from '../../src/bootstrap.js';
import { User } from '../../src/models/User.js';
import { startTestEnv } from '../helpers/setup.js';

let env, app;
beforeAll(async () => { env = await startTestEnv(); app = env.app; });
afterAll(() => env?.stop());
const configure = (email, password) => Object.assign(appEnv, { bootstrapAdminEmail: email, bootstrapAdminPassword: password });

test('does nothing when not configured', async () => {
  configure('', '');
  expect(await ensureBootstrapAdmin()).toEqual({ created: false, reason: 'not_configured' });
  expect(await User.countDocuments()).toBe(0);
});
test('refuses a short password', async () => {
  configure('boot@farm.test', 'short');
  expect((await ensureBootstrapAdmin()).reason).toBe('password_too_short');
  expect(await User.countDocuments()).toBe(0);
});
test('creates the first super admin, who can sign in', async () => {
  configure('Boot@Farm.test', 'a-long-bootstrap-pass');
  expect((await ensureBootstrapAdmin()).created).toBe(true);
  const r = await request(app).post('/v1/auth/login').send({ email: 'boot@farm.test', password: 'a-long-bootstrap-pass' });
  expect(r.status).toBe(200);
  expect(r.body.user.role).toBe('super_admin');
});
test('never creates a second admin or touches the existing one', async () => {
  configure('other@farm.test', 'another-long-password');
  expect((await ensureBootstrapAdmin()).reason).toBe('admin_exists');
  expect(await User.countDocuments({ role: 'super_admin' })).toBe(1);
});
