// End-to-end smoke test against a RUNNING API (local, Docker or Render staging). Uses only synthetic data.
//   BASE_URL=http://localhost:3000 SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... node scripts/smoke.js
// Needs a super_admin login. It creates its own partner, API key and staff users, so nothing else is required.
import crypto from 'node:crypto';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const { SMOKE_ADMIN_EMAIL: adminEmail, SMOKE_ADMIN_PASSWORD: adminPassword } = process.env;
if (!adminEmail || !adminPassword) { console.error('Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD (a super_admin account).'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`); return ok; };
async function call(method, path, { token, key, body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch(`${BASE}${path}${qs}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token || key ? { Authorization: `Bearer ${token || key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, body: json };
}
const stop = (msg) => { console.error(`\nStopping: ${msg}`); process.exit(1); };

const tag = Date.now().toString(36);
const pw = () => crypto.randomBytes(12).toString('base64url');
const phone = `0800${String(crypto.randomInt(0, 10_000_000)).padStart(7, '0')}`; // synthetic test number
console.log(`Smoke test against ${BASE}\n`);

check('health endpoint', (await call('GET', '/health')).status === 200);
const login = await call('POST', '/v1/auth/login', { body: { email: adminEmail, password: adminPassword } });
if (!check('admin login', login.status === 200 && login.body?.token, JSON.stringify(login.body))) stop('cannot sign in');
const admin = login.body.token;

const partner = await call('POST', '/v1/partners', { token: admin, body: { organization: `Smoke Partner ${tag}`, type: 'programme', plan: 'growth' } });
check('create partner', partner.status === 201, JSON.stringify(partner.body));
const key = await call('POST', `/v1/partners/${partner.body?._id}/api-keys`, { token: admin, body: { name: `smoke ${tag}`, mode: 'test', plan: 'growth' } });
if (!check('create test API key (shown once)', key.status === 201 && key.body?.apiKey?.startsWith('sk_test_'), JSON.stringify(key.body))) stop('no API key');
const apiKey = key.body.apiKey;

const mkUser = async (role) => {
  const password = pw();
  const r = await call('POST', '/v1/users', { token: admin, body: { email: `${role}.${tag}@smoke.test`, name: `Smoke ${role}`, password, role } });
  const l = r.status === 201 ? await call('POST', '/v1/auth/login', { body: { email: `${role}.${tag}@smoke.test`, password } }) : r;
  return l.body?.token;
};
const agent = await mkUser('field_agent'); const manager = await mkUser('data_manager');
if (!check('create + sign in field agent and data manager', agent && manager)) stop('cannot create staff users');

const reg = (name) => ({ name, phone, state: 'Benue', lga: 'Vandeikya', ward: 'Ihugh', community: 'Ihugh', consent: { given: true, wordingVersion: 'smoke-v1' }, isSynthetic: true, farm: { crop: 'White Yam', reportedAreaHa: 1.5, location: { lat: 7.05, lng: 9.0, source: 'farmer_pin', accuracyMeters: 25 } } });
const farmer = await call('POST', '/v1/farmers', { token: agent, body: reg(`Smoke Farmer ${tag}`) });
if (!check('register synthetic farmer (pending review, FarmasLog ID issued)', farmer.status === 201 && farmer.body?.status === 'pending_review' && /^FL-/.test(farmer.body?.farmaslogId || ''), `${farmer.status} ${JSON.stringify(farmer.body)}`)) stop('registration failed (is ALLOW_SYNTHETIC enabled on this deployment?)');
const { id, farmaslogId } = farmer.body;

const dup = await call('POST', '/v1/farmers', { token: agent, body: reg('Someone Else') });
check('same phone is held for duplicate review, no ID issued', dup.status === 201 && dup.body?.duplicateCandidate === true && dup.body?.farmaslogId === null, JSON.stringify(dup.body));

check('partner cannot see a pending record (404)', (await call('GET', '/v1/verify', { key: apiKey, query: { phone } })).status === 404);
check('field agent cannot approve (403)', (await call('POST', `/v1/farmers/${id}/review`, { token: agent, body: { decision: 'approve' } })).status === 403);
check('data manager approves', (await call('POST', `/v1/farmers/${id}/review`, { token: manager, body: { decision: 'approve' } })).status === 200);

const v1 = await call('GET', '/v1/verify', { key: apiKey, query: { phone, state: 'Benue', lga: 'Vandeikya' } });
check('verify by phone: record_found + self_reported evidence', v1.status === 200 && v1.body?.verificationStatus === 'record_found' && v1.body?.evidenceStatus === 'self_reported', JSON.stringify(v1.body));
check('response says the GPS is unconfirmed, but the record is still usable', v1.body?.locationConfirmation === 'unconfirmed' && v1.body?.limitations?.includes('location_not_confirmed_by_field_agent'), JSON.stringify(v1.body));
check('verify response hides phone and coordinates', !JSON.stringify(v1.body).includes(phone.slice(1)) && !v1.body?.location?.coordinates);
check('verify by FarmasLog ID', (await call('GET', '/v1/verify', { key: apiKey, query: { farmaslogId } })).status === 200);
check('wrong LGA is a 404', (await call('GET', '/v1/verify', { key: apiKey, query: { phone, lga: 'Gboko' } })).status === 404);

const fv = await call('POST', `/v1/farmers/${id}/field-verification`, { token: agent, body: { outcome: 'verified', method: 'site_visit', location: { lat: 7.05, lng: 9.0, accuracyMeters: 6 } } });
check('field verification recorded', fv.status === 200, JSON.stringify(fv.body));
const v2 = await call('GET', '/v1/verify', { key: apiKey, query: { farmaslogId } });
check('verify now returns verified / field_verified with GPS confirmed', v2.body?.verificationStatus === 'verified' && v2.body?.evidenceStatus === 'field_verified' && v2.body?.locationConfirmation === 'confirmed_by_field_agent', JSON.stringify(v2.body));

check('missing params -> 400', (await call('GET', '/v1/verify', { key: apiKey })).status === 400);
check('no key -> 401', (await call('GET', '/v1/verify', { query: { phone } })).status === 401);
check('bad key -> 401', (await call('GET', '/v1/verify', { key: `sk_test_00000000_${'a'.repeat(43)}`, query: { phone } })).status === 401);

if (process.env.SMOKE_SKIP_USAGE) console.log('SKIP  usage report (SMOKE_SKIP_USAGE set)');
else {
await new Promise((r) => setTimeout(r, 700)); // verification logs are written just after the response
const usage = await call('GET', '/v1/usage', { token: admin, query: { partnerId: partner.body?._id } });
const units = (usage.body?.data || []).reduce((n, r) => n + r.billableUnits, 0);
check('usage report shows 3 billable lookups (errors and 404s not billed)', usage.status === 200 && units === 3, `billable=${units} ${JSON.stringify(usage.body)}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
