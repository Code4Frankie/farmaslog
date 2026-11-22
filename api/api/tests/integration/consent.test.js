import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { migrateConsent } from '../../src/migrations/consent.js';
import { startTestEnv, makeUser, login, makePartnerKey } from '../helpers/setup.js';

let env, app, agent, manager, key;
const consent = (over = {}) => ({ given: true, wordingVersion: 'consent-v1-draft', language: 'en', method: 'agent_read_aloud', partnerSharing: true, ...over });
const reg = (phone, over = {}) => ({
  name: `Consent Test ${phone}`, phone, state: 'Benue', lga: 'Vandeikya', consent: consent(), isSynthetic: true, farm: { crop: 'Maize', reportedAreaHa: 1 }, ...over,
});
const post = (token, body) => request(app).post('/v1/farmers').set('Authorization', `Bearer ${token}`).send(body);
const verify = (phone) => request(app).get('/v1/verify').set('Authorization', `Bearer ${key}`).query({ phone });
const approve = (id) => request(app).post(`/v1/farmers/${id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });

beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('field_agent', 'agent@c.test'); await makeUser('data_manager', 'dm@c.test');
  agent = await login(app, 'agent@c.test'); manager = await login(app, 'dm@c.test');
  ({ fullKey: key } = await makePartnerKey());
});
afterAll(() => env?.stop());

describe('public consent text', () => {
  test('GET /v1/reference/consent needs no auth and returns version, language, text, readAloud', async () => {
    const r = await request(app).get('/v1/reference/consent');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: 'consent-v1-draft', language: 'en', textLanguage: 'en' });
    expect(r.body.text).toMatch(/FarmasLog: Farmer consent/);
    expect(r.body.readAloud).toMatch(/Do you understand/);
  });
  test('an untranslated language is served in English and flagged', async () => {
    const r = await request(app).get('/v1/reference/consent').query({ lang: 'ha' });
    expect(r.body).toMatchObject({ language: 'ha', textLanguage: 'en', needsTranslation: true });
  });
  test('unknown language or version is a 400', async () => {
    expect((await request(app).get('/v1/reference/consent').query({ lang: 'fr' })).status).toBe(400);
    expect((await request(app).get('/v1/reference/consent').query({ version: 'zzz' })).status).toBe(400);
  });
});

describe('consent validation', () => {
  test('unknown wordingVersion is rejected', async () => {
    expect((await post(agent, reg('08000000101', { consent: consent({ wordingVersion: 'made-up' }) }))).status).toBe(400);
  });
  test('current version requires method and partnerSharing', async () => {
    expect((await post(agent, reg('08000000102', { consent: { given: true, wordingVersion: 'consent-v1-draft', partnerSharing: true } }))).status).toBe(400);
    expect((await post(agent, reg('08000000102', { consent: { given: true, wordingVersion: 'consent-v1-draft', method: 'agent_checkbox' } }))).status).toBe(400);
  });
  test('consent must be given', async () => {
    expect((await post(agent, reg('08000000103', { consent: consent({ given: false }) }))).status).toBe(400);
  });
  test('stored consent has server time, recorder, language, hash and status valid', async () => {
    const r = await post(agent, reg('08000000104'));
    expect(r.status).toBe(201);
    expect(r.body.consentStatus).toBe('valid');
    expect(r.body.consent).toMatchObject({ language: 'en', method: 'agent_read_aloud', partnerSharing: true, mediaStorage: false });
    expect(r.body.consent.recordedAt).toBeTruthy();
    expect(r.body.consent.recordedBy).toBeTruthy();
    expect(r.body.consent.textHash).toMatch(/^[0-9a-f]{64}$/);
  });
  test('a legacy wording is accepted (imports) but flagged needs_reconsent', async () => {
    const r = await post(manager, reg('08000000105', { consent: { given: true, wordingVersion: 'qservers-form-v1' } }));
    expect(r.status).toBe(201);
    expect(r.body.consentStatus).toBe('needs_reconsent');
  });
});

describe('migration', () => {
  test('flags console-draft-v0 records, is idempotent, hides nothing', async () => {
    const r = await post(manager, reg('08000000111', { consent: { given: true, wordingVersion: 'console-draft-v0' } }));
    await Farmer.updateOne({ _id: r.body.id }, { $unset: { consentStatus: 1 } }); // simulate a pre-migration record
    expect(await migrateConsent()).toBeGreaterThanOrEqual(1);
    expect((await Farmer.findById(r.body.id)).consentStatus).toBe('needs_reconsent');
    expect((await Farmer.findById(r.body.id)).status).toBe('pending_review');
    expect(await migrateConsent()).toBe(0);
  });
  test('Farmers list can be filtered by consentStatus', async () => {
    const r = await request(app).get('/v1/farmers').set('Authorization', `Bearer ${manager}`).query({ consentStatus: 'needs_reconsent' });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
    expect(r.body.data.every((f) => f.consentStatus === 'needs_reconsent')).toBe(true);
  });
});

describe('withdrawal', () => {
  let id;
  test('an active, verifiable record disappears from partner verification after withdrawal, and it is audited', async () => {
    const r = await post(agent, reg('08000000121'));
    id = r.body.id;
    expect((await approve(id)).status).toBe(200);
    expect((await verify('08000000121')).status).toBe(200);

    const w = await request(app).post(`/v1/farmers/${id}/consent-withdrawal`).set('Authorization', `Bearer ${manager}`).send({ reason: 'Farmer phoned the office' });
    expect(w.status).toBe(200);
    expect(w.body.consentStatus).toBe('withdrawn');
    expect((await verify('08000000121')).status).toBe(404);

    const log = await AuditLog.findOne({ action: 'farmer.consent.withdrawn', entityId: id });
    expect(log).toBeTruthy();
    expect(JSON.stringify(log.changes)).not.toMatch(/phoned/); // free text never enters the audit log
  });
  test('withdrawing twice is a 409', async () => {
    expect((await request(app).post(`/v1/farmers/${id}/consent-withdrawal`).set('Authorization', `Bearer ${manager}`).send({})).status).toBe(409);
  });
  test('a withdrawn record cannot be field-verified', async () => {
    const r = await request(app).post(`/v1/farmers/${id}/field-verification`).set('Authorization', `Bearer ${manager}`).send({ outcome: 'verified', method: 'site_visit' });
    expect(r.status).toBe(409);
    expect(r.body.errorCode).toBe('CONSENT_WITHDRAWN');
  });
  test('a withdrawn pending record cannot be approved', async () => {
    const r = await post(agent, reg('08000000122'));
    await request(app).post(`/v1/farmers/${r.body.id}/consent-withdrawal`).set('Authorization', `Bearer ${agent}`).send({});
    expect((await approve(r.body.id)).status).toBe(409);
  });
  test('auditors and partners cannot withdraw', async () => {
    await makeUser('auditor', 'aud@c.test');
    const aud = await login(app, 'aud@c.test');
    expect((await request(app).post(`/v1/farmers/${id}/consent-withdrawal`).set('Authorization', `Bearer ${aud}`).send({})).status).toBe(403);
  });
  test('fresh consent restores a withdrawn record', async () => {
    const re = await request(app).post(`/v1/farmers/${id}/reconsent`).set('Authorization', `Bearer ${manager}`).send({ consent: consent() });
    expect(re.status).toBe(200);
    expect(re.body.consentStatus).toBe('valid');
    expect((await verify('08000000121')).status).toBe(200);
  });
  test('re-consent must use the current version', async () => {
    const re = await request(app).post(`/v1/farmers/${id}/reconsent`).set('Authorization', `Bearer ${manager}`).send({ consent: { given: true, wordingVersion: 'console-draft-v0' } });
    expect(re.status).toBe(400);
  });
});

describe('partner sharing choice and the re-consent switch', () => {
  test('a farmer who declined partner sharing is never returned to partners', async () => {
    const r = await post(agent, reg('08000000131', { consent: consent({ partnerSharing: false }) }));
    await approve(r.body.id);
    expect((await verify('08000000131')).status).toBe(404);
  });
  test('needs_reconsent records stay visible unless HIDE_NEEDS_RECONSENT is on', async () => {
    const r = await post(manager, reg('08000000132', { consent: { given: true, wordingVersion: 'qservers-form-v1' } }));
    await approve(r.body.id);
    expect((await verify('08000000132')).status).toBe(200);
  });
});
