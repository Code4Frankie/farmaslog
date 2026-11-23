import request from 'supertest';
import { env } from '../../src/config/env.js';
import { Otp } from '../../src/models/Otp.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { outbox } from '../../src/services/sms.service.js';
import { requirePhoneProof } from '../../src/services/otp.service.js';
import { startTestEnv } from '../helpers/setup.js';

let testEnv, app;
const PHONE = '08000000401';
const reqOtp = (body = {}) => request(app).post('/v1/public/otp/request').send({ phone: PHONE, purpose: 'register', ...body });
const check = (code, body = {}) => request(app).post('/v1/public/otp/verify').send({ phone: PHONE, purpose: 'register', code, ...body });
const lastCode = () => outbox.at(-1).text.match(/\b(\d{6})\b/)[1];
const resetCooldown = () => Otp.updateMany({}, { $set: { lastSentAt: new Date(Date.now() - 3600_000) } });

beforeAll(async () => { testEnv = await startTestEnv(); app = testEnv.app; });
afterAll(() => testEnv?.stop());
beforeEach(async () => { outbox.length = 0; await Otp.deleteMany({}); });

describe('POST /v1/public/otp/request', () => {
  test('sends a 6-digit code to the number and answers 202 without echoing anything about the number', async () => {
    const r = await reqOtp();
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'sent_if_valid', resendAfterSeconds: env.otp.resendSeconds });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe('+2348000000401');
    expect(outbox[0].text).toMatch(/FarmasLog code: \d{6}/);
  });
  test('the stored row holds no phone number and no plain code', async () => {
    await reqOtp();
    const row = await Otp.findOne().lean();
    expect(JSON.stringify(row)).not.toContain('8000000401');
    expect(Object.values(row).map(String)).not.toContain(lastCode()); // hashes only, never the code itself
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });
  test('a malformed or non-Nigerian number is refused', async () => {
    expect((await reqOtp({ phone: '12345' })).status).toBe(400);
    expect((await reqOtp({ phone: '+14155550123' })).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });
  test('an unknown purpose is refused', async () => {
    expect((await reqOtp({ purpose: 'admin' })).status).toBe(400);
  });
  test('cooldown and hourly limit are silent: same 202, no extra SMS', async () => {
    expect((await reqOtp()).status).toBe(202);
    expect((await reqOtp()).status).toBe(202); // inside the cooldown
    expect(outbox).toHaveLength(1);
    for (let i = 0; i < 4; i++) { await resetCooldown(); expect((await reqOtp()).status).toBe(202); }
    expect(outbox).toHaveLength(env.otp.maxSendsPerHour); // 3 sends this hour, the rest were swallowed
    const limited = await AuditLog.countDocuments({ action: 'otp.request_limited' });
    expect(limited).toBeGreaterThan(0);
  });
  test('the same answer whether or not the number is on FarmasLog', async () => {
    const a = await reqOtp({ phone: '08000000402' });
    const b = await reqOtp({ phone: '08000000403' });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });
  test('when the SMS provider is down, nothing is recorded and the person can retry at once', async () => {
    const saved = env.sms.provider;
    env.sms.provider = 'none';
    const r = await reqOtp();
    env.sms.provider = saved;
    expect(r.status).toBe(503);
    expect(r.body.errorCode).toBe('SMS_UNAVAILABLE');
    expect(await Otp.countDocuments()).toBe(0);
    expect((await reqOtp()).status).toBe(202);
  });
});

describe('POST /v1/public/otp/verify', () => {
  test('the right code returns a proof; the proof works for that phone and purpose only', async () => {
    await reqOtp();
    const r = await check(lastCode());
    expect(r.status).toBe(200);
    expect(r.body.phoneProof).toEqual(expect.any(String));
    expect(requirePhoneProof(r.body.phoneProof, PHONE, 'register')).toBe('+2348000000401');
    expect(requirePhoneProof(r.body.phoneProof, '0800 000 0401', 'register')).toBe('+2348000000401'); // same number, other format
    expect(() => requirePhoneProof(r.body.phoneProof, '08000000999', 'register')).toThrow(/Verify your phone/);
    expect(() => requirePhoneProof(r.body.phoneProof, PHONE, 'access')).toThrow(/Verify your phone/);
    expect(() => requirePhoneProof('nonsense', PHONE, 'register')).toThrow();
    expect(() => requirePhoneProof(undefined, PHONE, 'register')).toThrow();
  });
  test('a code works once', async () => {
    await reqOtp();
    const code = lastCode();
    expect((await check(code)).status).toBe(200);
    expect((await check(code)).status).toBe(400);
  });
  test('a code for one purpose does not work for another', async () => {
    await reqOtp();
    expect((await check(lastCode(), { purpose: 'access' })).status).toBe(400);
  });
  test('wrong, expired, never-requested and badly-formed codes all fail the same way', async () => {
    const never = await check('123456', { phone: '08000000488' });
    await reqOtp();
    const code = lastCode();
    const wrong = await check(code === '000000' ? '000001' : '000000');
    await Otp.updateMany({}, { $set: { codeExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await check(code);
    for (const r of [never, wrong, expired]) { expect(r.status).toBe(400); expect(r.body.errorCode).toBe('INVALID_CODE'); }
    expect(never.body.message).toBe(wrong.body.message);
    expect((await check('12ab56')).status).toBe(400);
  });
  test('after too many wrong tries even the right code is refused, until a new one is sent', async () => {
    await reqOtp();
    const code = lastCode();
    const bad = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < env.otp.maxAttempts; i++) expect((await check(bad)).status).toBe(400);
    expect((await check(code)).status).toBe(400);
    expect(await AuditLog.countDocuments({ action: 'otp.locked' })).toBe(1);
    await resetCooldown();
    await reqOtp();
    expect((await check(lastCode())).status).toBe(200);
  });
  test('a new code replaces the old one', async () => {
    await reqOtp();
    const first = lastCode();
    await resetCooldown();
    await reqOtp();
    const second = lastCode();
    if (first !== second) expect((await check(first)).status).toBe(400);
    expect((await check(second)).status).toBe(200);
  });
});

describe('privacy', () => {
  test('audit entries and responses never contain the phone number or the code', async () => {
    await reqOtp();
    const code = lastCode();
    const r = await check(code);
    const logs = await AuditLog.find({ entityType: 'Otp' }).lean();
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['otp.requested', 'otp.verified']));
    for (const l of logs) expect(Object.keys(l.changes).sort()).toEqual(['phoneRef', 'purpose']);
    expect(JSON.stringify(logs)).not.toContain('8000000401');
    expect(logs.map((l) => l.changes.phoneRef)).not.toContain(code);
    expect(JSON.stringify(r.body)).not.toContain('8000000401');
  });
  test('responses are not cacheable', async () => {
    expect((await reqOtp()).headers['cache-control']).toBe('no-store');
  });
});

describe('captcha on the request endpoint', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; env.captcha.required = false; });
  test('when required, no SMS is sent without a valid token', async () => {
    Object.assign(env.captcha, { required: true, turnstileSecret: 's' });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: false }) });
    const r = await reqOtp({ captchaToken: 'bad' });
    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe('CAPTCHA_FAILED');
    expect(outbox).toHaveLength(0);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
    expect((await reqOtp({ captchaToken: 'good' })).status).toBe(202);
    expect(outbox).toHaveLength(1);
  });
});
