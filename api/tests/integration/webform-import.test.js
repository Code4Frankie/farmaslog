import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { Farm } from '../../src/models/Farm.js';
import { parseCsv } from '../../src/utils/csv.js';
import { startTestEnv, makeUser, login, makePartnerKey } from '../helpers/setup.js';

const FIXTURE = path.resolve('tests/fixtures/webform_sample.csv');
const REJECTS = path.join(os.tmpdir(), `farmaslog-rejects-${process.pid}.csv`);
let env, app, manager, apiKey;

// Runs the real CLI against the same test database.
const runImport = (...args) => execFileSync('node', ['scripts/import-webform.js', FIXTURE, `--rejects=${REJECTS}`, ...args], {
  env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: env.uri }, encoding: 'utf8',
});

beforeAll(async () => {
  env = await startTestEnv();
  app = env.app;
  await makeUser('data_manager', 'dm@wf.test');
  manager = await login(app, 'dm@wf.test');
  ({ fullKey: apiKey } = await makePartnerKey());
});
afterAll(() => { fs.rmSync(REJECTS, { force: true }); return env?.stop(); });

test('dry run touches nothing', async () => {
  const out = runImport('--dry-run');
  expect(out).toMatch(/DRY RUN/);
  expect(await Farmer.countDocuments()).toBe(0);
});

test('first import: 10 records land for review, 5 rows rejected with reasons', async () => {
  const out = runImport();
  expect(out).toMatch(/imported\s*│\s*10/);
  expect(await Farmer.countDocuments()).toBe(10);
  expect(await Farmer.countDocuments({ status: 'pending_review' })).toBe(9);
  const dup = await Farmer.findOne({ status: 'duplicate_review' });
  expect(dup.farmaslogId ?? null).toBeNull(); // no ID until a human resolves the duplicate
  const rejects = parseCsv(fs.readFileSync(REJECTS, 'utf8'));
  expect(rejects).toHaveLength(6); // header + 5
  expect(rejects.slice(1).map((r) => r.at(-1)).sort()).toEqual(['CONSENT_NOT_GIVEN', 'INVALID_AREA', 'INVALID_PHONE', 'MISSING_firstName', 'UNKNOWN_LGA']);
});

test('re-importing the same cumulative export creates nothing new', async () => {
  const out = runImport();
  expect(out).toMatch(/alreadyImported\s*│\s*10/);
  expect(out).toMatch(/imported\s*│\s*0/);
  expect(await Farmer.countDocuments()).toBe(10);
});

test('stored data: hectares, weak typed coordinates, limited consent scope, web reference', async () => {
  const one = await Farmer.findOne({ sourceRef: /webform:FB-BE-20261020-101501/ });
  const farm = await Farm.findOne({ farmerId: one._id });
  expect(one).toMatchObject({ name: 'Test Farmer One', phoneNormalized: '+2348000000011', sourceChannel: 'web_form', source: 'self_registration', programmeRequested: 'Seed' });
  expect(one.consent.wordingVersion).toBe('qservers-form-v1');
  expect(one.consent.purpose).toMatch(/government agricultural programmes/);
  expect(farm.reportedArea.value).toBe(0.81);
  expect(farm.location.source).toBe('farmer_reported');
  expect(farm.evidence.status).toBe('self_reported');
});

test('same row posted through the API again is a no-op (200, alreadyImported)', async () => {
  const one = await Farmer.findOne({ sourceRef: /webform:FB-BE-20261020-101501/ });
  const r = await request(app).post('/v1/farmers').set('Authorization', `Bearer ${manager}`).send({
    name: 'Test Farmer One', phone: '08000000011', state: 'Benue', lga: 'Vandeikya', consent: { given: true, wordingVersion: 'qservers-form-v1' },
    sourceRef: one.sourceRef, farm: { crop: 'White Yam' },
  });
  expect(r.status).toBe(200);
  expect(r.body.alreadyImported).toBe(true);
  expect(await Farmer.countDocuments()).toBe(10);
});

test('review then verify: imported record is invisible until approved; internal fields never reach partners', async () => {
  const one = await Farmer.findOne({ sourceRef: /webform:FB-BE-20261020-101501/ });
  const q = () => request(app).get('/v1/verify').set('Authorization', `Bearer ${apiKey}`).query({ phone: '08000000011' });
  expect((await q()).status).toBe(404);
  const approved = await request(app).post(`/v1/farmers/${one._id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
  expect(approved.status).toBe(200);
  const v = await q();
  expect(v.status).toBe(200);
  expect(v.body).toMatchObject({ verificationStatus: 'record_found', evidenceStatus: 'self_reported', reportedArea: { value: 0.81, unit: 'hectares' }, crop: 'White Yam' });
  expect(JSON.stringify(v.body)).not.toMatch(/Seed|programme|webform|8000000011/i);
  const dup = await Farmer.findOne({ status: 'duplicate_review' });
  const blocked = await request(app).post(`/v1/farmers/${dup._id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' });
  expect(blocked.status).toBe(409);
});
