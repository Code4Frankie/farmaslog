import request from 'supertest';
import { createApp } from '../../src/app.js';

// No database needed: these paths are rejected before any query runs.
const app = createApp();

test('health', async () => expect((await request(app).get('/health')).body).toEqual({ status: 'ok' }));
test('not ready without a DB connection', async () => expect((await request(app).get('/ready')).status).toBe(503));
test('verify without key -> 401 with the documented error shape', async () => {
  const r = await request(app).get('/v1/verify').query({ phone: '08000000001' });
  expect(r.status).toBe(401);
  expect(r.body).toMatchObject({ errorCode: 'MISSING_API_KEY', requestId: expect.stringMatching(/^req_/) });
});
test('malformed key -> 401', async () => expect((await request(app).get('/v1/verify').set('Authorization', 'Bearer nope')).body.errorCode).toBe('INVALID_API_KEY'));
test('staff routes require a token', async () => {
  for (const p of ['/v1/farmers', '/v1/partners', '/v1/usage', '/v1/audit-logs']) expect((await request(app).get(p)).status).toBe(401);
});
test('unknown route -> 404 JSON', async () => expect((await request(app).get('/v1/nope')).body.errorCode).toBe('ROUTE_NOT_FOUND'));
test('invalid JSON body -> 400', async () => {
  const r = await request(app).post('/v1/auth/login').set('Content-Type', 'application/json').send('{bad');
  expect(r.body.errorCode).toBe('INVALID_JSON');
});
test('webhook rejects unsigned requests', async () => expect((await request(app).post('/v1/webhooks/paystack').send({ event: 'x' })).status).toBe(401));
test('signup validates before touching the database', async () => {
  const r = await request(app).post('/v1/auth/signup').send({ organization: 'X', name: 'A', email: 'nope', password: 'short' });
  expect(r.status).toBe(400);
  expect(r.body.errorCode).toBe('VALIDATION_ERROR');
});
test('swagger docs are served', async () => expect((await request(app).get('/docs/')).status).toBe(200));
