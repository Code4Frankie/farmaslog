import { jest } from '@jest/globals';
import { env } from '../../src/config/env.js';
import { sendSms, outbox } from '../../src/services/sms.service.js';
import { verifyCaptcha } from '../../src/services/captcha.service.js';

const realFetch = globalThis.fetch;
const realSms = { ...env.sms };
const realCaptcha = { ...env.captcha };
afterEach(() => { globalThis.fetch = realFetch; Object.assign(env.sms, realSms); Object.assign(env.captcha, realCaptcha); outbox.length = 0; });

describe('sms', () => {
  test('memory provider keeps messages in the outbox', async () => {
    await sendSms('+2348000000001', 'hello');
    expect(outbox).toHaveLength(1);
  });
  test('termii: posts the number without the plus sign and the api key in the body', async () => {
    Object.assign(env.sms, { provider: 'termii', termiiApiKey: 'k', termiiBaseUrl: 'https://sms.example', senderId: 'FarmasLog', channel: 'dnd' });
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    await sendSms('+2348000000001', 'code 123456');
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://sms.example/api/sms/send');
    expect(JSON.parse(init.body)).toMatchObject({ to: '2348000000001', from: 'FarmasLog', sms: 'code 123456', channel: 'dnd', api_key: 'k' });
  });
  test('termii failure becomes a 503 that carries no number or code', async () => {
    Object.assign(env.sms, { provider: 'termii', termiiApiKey: 'k' });
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(sendSms('+2348000000001', 'code 123456')).rejects.toMatchObject({ status: 503, errorCode: 'SMS_UNAVAILABLE' });
  });
  test('no provider configured is a 503', async () => {
    env.sms.provider = 'none';
    await expect(sendSms('+2348000000001', 'x')).rejects.toMatchObject({ status: 503 });
  });
});

describe('captcha', () => {
  test('does nothing when not required', async () => {
    env.captcha.required = false;
    await expect(verifyCaptcha(undefined, '1.1.1.1')).resolves.toBeUndefined();
  });
  test('required but no secret: fails closed', async () => {
    Object.assign(env.captcha, { required: true, turnstileSecret: '' });
    await expect(verifyCaptcha('t', '1.1.1.1')).rejects.toMatchObject({ status: 503, errorCode: 'CAPTCHA_UNAVAILABLE' });
  });
  test('required: missing token, bad token and good token', async () => {
    Object.assign(env.captcha, { required: true, turnstileSecret: 's', verifyUrl: 'https://cf.example/verify' });
    await expect(verifyCaptcha('', '1.1.1.1')).rejects.toMatchObject({ status: 400, errorCode: 'CAPTCHA_FAILED' });
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: false }) }));
    await expect(verifyCaptcha('bad', '1.1.1.1')).rejects.toMatchObject({ errorCode: 'CAPTCHA_FAILED' });
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    await expect(verifyCaptcha('good', '1.1.1.1')).resolves.toBeUndefined();
    const body = globalThis.fetch.mock.calls[0][1].body;
    expect(body.get('secret')).toBe('s'); expect(body.get('response')).toBe('good'); expect(body.get('remoteip')).toBe('1.1.1.1');
  });
  test('network error to Cloudflare is a 503, not a pass', async () => {
    Object.assign(env.captcha, { required: true, turnstileSecret: 's' });
    globalThis.fetch = jest.fn(async () => { throw new Error('down'); });
    await expect(verifyCaptcha('t', 'ip')).rejects.toMatchObject({ status: 503 });
  });
});
