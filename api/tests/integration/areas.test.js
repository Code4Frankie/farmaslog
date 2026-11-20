import request from 'supertest';
import { Farmer } from '../../src/models/Farmer.js';
import { AREAS } from '../../src/data/ng-geo.js';
import { startTestEnv, makeUser, login, makePartnerKey } from '../helpers/setup.js';

let env, app, agent, manager, key;
beforeAll(async () => {
  env = await startTestEnv(); app = env.app;
  await makeUser('field_agent', 'agent@ar.test'); await makeUser('data_manager', 'dm@ar.test');
  agent = await login(app, 'agent@ar.test'); manager = await login(app, 'dm@ar.test');
  ({ fullKey: key } = await makePartnerKey());
});
afterAll(() => env?.stop());

const enrol = async (phone, state, lga, community) => {
  const r = await request(app).post('/v1/farmers').set('Authorization', `Bearer ${agent}`).send({
    name: `Test ${phone}`, phone, state, lga, community, consent: { given: true, wordingVersion: 'v1' }, isSynthetic: true,
    farm: { crop: 'Maize', reportedAreaHa: 1 },
  });
  expect(r.status).toBe(201);
  expect((await request(app).post(`/v1/farmers/${r.body.id}/review`).set('Authorization', `Bearer ${manager}`).send({ decision: 'approve' })).status).toBe(200);
  return r.body;
};
const verify = (q) => request(app).get('/v1/verify').set('Authorization', `Bearer ${key}`).query(q);

test.each(['Kano', 'Lagos', 'Nasarawa', 'Cross River', 'FCT'])('works end to end for %s, typed in any case', async (state) => {
  const lga = AREAS[state][2];
  const phone = `0800000${String(70 + Object.keys(AREAS).indexOf(state)).padStart(4, '0')}`;
  const body = await enrol(phone, state.toLowerCase(), lga.toUpperCase(), 'Test Community');
  expect(body.warnings).toEqual([]);
  const stored = await Farmer.findById(body.id);
  expect({ state: stored.state, lga: stored.lga }).toEqual({ state, lga }); // tidied to the proper names
  const ok = await verify({ phone, state: state.toUpperCase(), lga: lga.toLowerCase() });
  expect(ok.status).toBe(200);
  expect(ok.body.location).toMatchObject({ state, lga, community: 'Test Community' });
  const other = AREAS[state].find((l) => l !== lga);
  expect((await verify({ phone, lga: other })).status).toBe(404);
});

test('an area that is not in the list is still accepted, as typed, with a warning', async () => {
  const body = await enrol('08000009991', 'Madeupstate', 'Nowhere LGA', 'Somewhere');
  expect(body.warnings).toEqual(['state_not_in_reference_list']);
  const ok = await verify({ phone: '08000009991', state: 'madeupstate' });
  expect(ok.status).toBe(200);
  expect(ok.body.location.state).toBe('Madeupstate');
});
