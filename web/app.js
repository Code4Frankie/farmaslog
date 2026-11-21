const cfg = window.FARMASLOG_CONFIG || {};
const API = String(cfg.apiUrl || '').replace(/\/+$/, '');
const DEMO = !API;
const DEMO_LOGIN = { email: 'demo@farmaslog.test', password: 'demo-password-123' };
const DEMO_USER = { name: 'Demo Lender', role: 'partner_verifier', organization: 'Demo Agri Bank' };
const ROLES = { super_admin: 'Administrator', data_manager: 'Data manager', field_agent: 'Field agent', partner_verifier: 'Partner', finance: 'Finance', auditor: 'Auditor' };
const TABS = {
  partner_verifier: ['console', 'keys', 'usage', 'password'], super_admin: ['approvals', 'farmers', 'register', 'team', 'keys', 'usage', 'password'],
  data_manager: ['farmers', 'register', 'password'], field_agent: ['register', 'farmers', 'password'], finance: ['usage', 'password'], auditor: ['usage', 'farmers', 'password'],
};
const TITLES = { console: 'Verify a farmer', keys: 'API keys', usage: 'Usage', approvals: 'Access requests', farmers: 'Farmers', register: 'Register a farmer', team: 'FarmasLog team', password: 'Change your password' };
const TAB = { console: 'Verify', keys: 'API keys', usage: 'Usage', approvals: 'Requests', farmers: 'Farmers', register: 'Register', team: 'Team', password: 'Password' };
const ONBOARD = [['field_agent', 'Field agent'], ['data_manager', 'Data manager'], ['finance', 'Finance'], ['auditor', 'Auditor']];

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
};
const session = {
  get token() { try { return sessionStorage.getItem('fl_token'); } catch { return null; } },
  save(t) { try { if (t) sessionStorage.setItem('fl_token', t); else sessionStorage.removeItem('fl_token'); } catch { /* storage blocked */ } },
};
class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }

// ---- API client (real, or sample data for sign-in only in demo mode) ----
async function api(path, { method = 'GET', body, token, form } = {}) {
  if (DEMO) return demoApi(path, body, token);
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
  } catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.errorCode || 'ERROR', data?.message || 'Something went wrong. Try again.', data?.details);
  return data;
}
async function demoApi(path, body, token) {
  await new Promise((r) => setTimeout(r, 350));
  if (path === '/v1/auth/login') {
    if (body.email.trim().toLowerCase() === DEMO_LOGIN.email && body.password === DEMO_LOGIN.password) return { token: 'demo', user: DEMO_USER };
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  if (path === '/v1/auth/signup') {
    if (String(body.password).length < 12) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.', ['password must be at least 12 characters long']);
    return { message: 'Request received.' };
  }
  if (path === '/v1/auth/me' && token === 'demo') return { user: DEMO_USER };
  throw new ApiError(404, 'NOT_AVAILABLE', 'Demo mode has no server. Set FARMASLOG_API_URL to use this screen.');
}
// Signed-in calls: an expired session sends the person back to sign in.
async function call(path, opts = {}) {
  try { return await api(path, { token: session.token, ...opts }); }
  catch (e) {
    if (e.status === 401 && ['INVALID_TOKEN', 'UNAUTHENTICATED'].includes(e.code)) signOut();
    if (e.code === 'PASSWORD_CHANGE_REQUIRED' && user && !user.mustChangePassword) enter({ ...user, mustChangePassword: true });
    throw e;
  }
}

// ---- areas: suggestions for any state/LGA; anything else can still be typed ----
let AREAS = {};
const find = (list, v) => list.find((x) => x.toLowerCase() === String(v).trim().toLowerCase());
const options = (items) => items.map((v) => h('option', { value: v }));
function areaInputs(p) {
  const state = h('input', { id: `${p}-state`, list: `${p}-states`, autocomplete: 'off' });
  const lga = h('input', { id: `${p}-lga`, list: `${p}-lgas`, autocomplete: 'off' });
  const lgas = h('datalist', { id: `${p}-lgas` });
  state.addEventListener('input', () => lgas.replaceChildren(...options(AREAS[find(Object.keys(AREAS), state.value)] || [])));
  return { state, lga, lists: [h('datalist', { id: `${p}-states` }, options(Object.keys(AREAS))), lgas] };
}

// sample slip on the sign-in page, fillable for any area
const sample = { state: 'Nasarawa', lga: 'Awe', community: 'Agwatashi', crop: 'Rice' };
function renderSlip() {
  const state = find(Object.keys(AREAS), sample.state) || sample.state.trim();
  const lga = find(AREAS[state] || [], sample.lga) || sample.lga.trim();
  $('#slip-location').textContent = [sample.community.trim(), lga && `${lga} LGA`, state].filter(Boolean).join(', ') || 'Not entered';
  $('#slip-crop').textContent = sample.crop.trim() || 'Not entered';
}
function suggestLgas() { $('#lga-list').replaceChildren(...options(AREAS[find(Object.keys(AREAS), sample.state)] || [])); }
async function initArea() {
  try { AREAS = (await (await fetch('areas.json')).json()).states || {}; } catch { AREAS = {}; }
  $('#state-list').replaceChildren(...options(Object.keys(AREAS)));
  for (const [id, key] of [['#ar-state', 'state'], ['#ar-lga', 'lga'], ['#ar-community', 'community'], ['#ar-crop', 'crop']]) {
    const input = $(id); input.value = sample[key];
    input.addEventListener('input', () => { sample[key] = input.value; if (key === 'state') suggestLgas(); renderSlip(); });
  }
  suggestLgas(); renderSlip();
}
const areasReady = initArea();

// ---- small UI helpers ----
const note = (text, kind = 'error') => h('p', { class: `msg ${kind === 'ok' ? 'ok' : kind === 'info' ? 'info' : ''}`, role: kind === 'error' ? 'alert' : 'status' }, text);
// Show/hide control for a password input. Wraps the input in place and returns the wrapper (use it wherever the input would go).
const EYE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a19.9 19.9 0 0 1-3.17 4.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
function eye(input) {
  const wrap = h('span', { class: 'pw' });
  const btn = h('button', { type: 'button', class: 'eye', 'aria-label': 'Show password', 'aria-pressed': 'false' });
  btn.innerHTML = EYE;
  btn.addEventListener('click', () => {
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    btn.innerHTML = showing ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    btn.setAttribute('aria-pressed', String(showing));
  });
  input.parentNode?.insertBefore(wrap, input);
  wrap.append(input, btn);
  return wrap;
}
const field = (label, input, help) => h('div', { class: 'f' }, h('label', { for: input.id || input.querySelector('input')?.id }, label), input, help && h('p', { class: 'help' }, help));
const table = (head, rows) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
const fail = (e) => note(e.details?.length ? `${e.message} ${e.details.join('; ')}` : `${e.message}${e.code && e.code !== 'ERROR' ? ` (${e.code})` : ''}`);
const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracyMeters: Math.round(p.coords.accuracy) }), () => resolve(null), { enableHighAccuracy: true, timeout: 10000 });
});
const date = (d) => (d ? new Date(d).toLocaleDateString() : '');
const STATUS = { pending_review: 'Pending review', active: 'Approved', duplicate_review: 'Possible duplicate', rejected: 'Rejected' };
let user = null;
let lastKey = ''; // a just-created key, kept in memory only so the Verify screen can use it

// ---- screens ----
const SCREENS = {};

const VERDICT = { verified: 'Verified in the field', record_found: 'Record found', review_required: 'Needs review' };
const GPS = { confirmed_by_field_agent: 'Confirmed by a field agent', unconfirmed: 'Not yet confirmed by a field agent', not_provided: 'No location recorded' };
const CAVEAT = { location_not_confirmed_by_field_agent: 'location not confirmed', area_self_reported: 'area is self-reported' };
function resultCard(r) {
  const rows = [
    ['Result', VERDICT[r.verificationStatus] || r.verificationStatus], ['FarmasLog ID', r.farmaslogId],
    ['Location', [r.location.community, r.location.lga && `${r.location.lga} LGA`, r.location.state].filter(Boolean).join(', ')],
    ['Crop', r.crop || 'Not recorded'], ['Reported area', r.reportedArea ? `${r.reportedArea.value} ${r.reportedArea.unit}` : 'Not recorded'],
    ['Evidence', `${r.evidenceStatus.replace('_', ' ')}. ${r.evidenceMessage}`], ['Farm location', GPS[r.locationConfirmation] || ''],
    ['Caveats', (r.limitations || []).map((l) => CAVEAT[l] || l).join('; ') || 'None'], ['Request ID', r.requestId],
  ];
  return h('dl', { class: 'result' }, rows.map(([k, v]) => h('div', { class: 'row' }, h('dt', {}, k), h('dd', {}, String(v)))));
}

SCREENS.console = (el) => {
  const key = h('input', { id: 'c-key', type: 'password', autocomplete: 'off', value: lastKey, required: true });
  const id = h('input', { id: 'c-id', placeholder: 'Phone number or FL-XXXXXXXX', required: true });
  const a = areaInputs('c');
  const out = h('div', { 'aria-live': 'polite' });
  el.append(
    h('p', { class: 'sub' }, 'Runs a real lookup with your API key, exactly as your own system would. Each successful check counts as one billable use.'),
    h('form', {
      class: 'grid',
      onsubmit: async (e) => {
        e.preventDefault(); out.replaceChildren(); lastKey = key.value.trim();
        const v = id.value.trim(); const q = /^FL-/i.test(v) ? { farmaslogId: v } : { phone: v };
        if (a.state.value.trim()) q.state = a.state.value.trim();
        if (a.lga.value.trim()) q.lga = a.lga.value.trim();
        try { out.append(resultCard(await api(`/v1/verify?${new URLSearchParams(q)}`, { token: lastKey }))); } catch (err) { out.append(fail(err)); }
      },
    },
    field('API key', eye(key), 'A test key from the API keys tab. Kept in memory only.'), field('Phone or FarmasLog ID', id),
    field('State (optional)', a.state), field('LGA (optional)', a.lga), ...a.lists,
    h('div', { class: 'wide' }, h('button', { class: 'primary', type: 'submit' }, 'Check'))),
    out);
};

SCREENS.keys = async (el) => {
  const admin = user.role === 'super_admin';
  let base = '/v1/me/api-keys'; let revokePath = (id) => `/v1/me/api-keys/${id}/revoke`;
  const list = h('div'); const msg = h('div', { 'aria-live': 'polite' });
  const load = async () => {
    const r = await call(base);
    list.replaceChildren(r.data.length ? table(['Name', 'Key', 'Mode', 'Status', 'Last used', ''], r.data.map((k) => [
      k.name, h('code', {}, `${k.keyPrefix}…`), k.mode, k.status, date(k.lastUsedAt) || 'Never',
      k.status === 'active' ? h('button', { class: 'secondary', type: 'button', onclick: async () => {
        try { await call(revokePath(k.id), { method: 'POST' }); await load(); } catch (e) { msg.replaceChildren(fail(e)); }
      } }, 'Revoke') : '',
    ])) : note('No keys yet.', 'info'));
  };
  if (admin) {
    const partners = (await call('/v1/partners')).data.filter((p) => p.status === 'active');
    if (!partners.length) { el.append(note('No approved partners yet. Approve a request first.', 'info')); return; }
    const sel = h('select', { id: 'k-partner' }, partners.map((p) => h('option', { value: p._id }, p.organization)));
    const point = () => { base = `/v1/partners/${sel.value}/api-keys`; revokePath = (id) => `/v1/api-keys/${id}/revoke`; };
    sel.addEventListener('change', () => { point(); load().catch((e) => msg.replaceChildren(fail(e))); });
    point(); el.append(field('Partner', sel));
  } else el.append(h('p', { class: 'sub' }, 'Test-mode keys for your organisation (up to 5 active). Live keys are issued by FarmasLog.'));
  const name = h('input', { id: 'k-name', required: true, minlength: 2, maxlength: 80, placeholder: 'e.g. Loan desk sandbox' });
  el.append(
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); msg.replaceChildren();
        try {
          const r = await call(base, { method: 'POST', body: admin ? { name: name.value.trim(), mode: 'test' } : { name: name.value.trim() } });
          lastKey = r.apiKey; name.value = '';
          msg.append(h('div', { class: 'newkey', role: 'status' }, 'Copy this key now. It will not be shown again.', h('code', {}, r.apiKey),
            h('button', { class: 'secondary', type: 'button', onclick: () => navigator.clipboard?.writeText(r.apiKey) }, 'Copy')));
          await load();
        } catch (err) { msg.append(fail(err)); }
      },
    }, field('New key name', name), h('div', { class: 'btns' }, h('button', { class: 'primary', type: 'submit' }, 'Create key'))),
    msg, h('h3', {}, 'Your keys'), list);
  await load();
};

SCREENS.usage = async (el) => {
  const r = await call('/v1/usage?groupBy=month');
  el.append(h('p', { class: 'sub' }, 'Billable uses are successful lookups only. Errors and not-found results are not counted.'),
    r.data.length ? table(['Period', 'Organisation', 'Plan', 'Requests', 'Billable', 'Errors', 'Avg ms'], r.data.map((x) => [x.period, x.organization || '', x.plan || '', x.requests, x.billableUnits, x.errors, x.avgLatencyMs]))
      : note('No usage yet this month.', 'info'));
};

SCREENS.approvals = async (el) => {
  const box = h('div'); const msg = h('div', { 'aria-live': 'polite' });
  const load = async () => {
    const r = await call('/v1/partners?status=pending');
    box.replaceChildren(r.data.length ? table(['Organisation', 'Type', 'Requested', ''], r.data.map((p) => [
      p.organization, p.type, date(p.createdAt),
      h('div', { class: 'btns' }, ['approve', 'reject'].map((act) => h('button', { type: 'button', class: act === 'approve' ? 'primary' : 'secondary', onclick: async () => {
        try { await call(`/v1/partners/${p._id}/${act}`, { method: 'POST' }); msg.replaceChildren(note(`${p.organization}: ${act}d.`, 'ok')); await load(); } catch (e) { msg.replaceChildren(fail(e)); }
      } }, act === 'approve' ? 'Approve' : 'Reject'))),
    ])) : note('No pending requests.', 'info'));
  };
  el.append(msg, box); await load();
};

SCREENS.farmers = async (el) => {
  const canReview = ['super_admin', 'data_manager'].includes(user.role);
  const canVerify = ['super_admin', 'data_manager', 'field_agent'].includes(user.role);
  const status = h('select', { id: 'f-status' }, [['', 'All'], ['pending_review', 'Pending review'], ['duplicate_review', 'Possible duplicate'], ['active', 'Approved'], ['rejected', 'Rejected']].map(([v, t]) => h('option', { value: v }, t)));
  const box = h('div'); const msg = h('div', { 'aria-live': 'polite' });
  const act = async (path, body, okText) => {
    msg.replaceChildren();
    try { await call(path, { method: 'POST', body }); msg.append(note(okText, 'ok')); await load(); } catch (e) { msg.append(fail(e)); }
  };
  const load = async () => {
    const r = await call(`/v1/farmers?limit=50${status.value ? `&status=${status.value}` : ''}`);
    box.replaceChildren(h('p', { class: 'help' }, `Showing ${r.data.length} of ${r.total}.`), r.data.length ? table(['Name', 'Phone', 'Area', 'Status', 'Evidence', ''], r.data.map((f) => [
      h('span', {}, f.name, f.isSynthetic ? ' (test)' : ''), f.phone, [f.community, f.lga, f.state].filter(Boolean).join(', '), STATUS[f.status] || f.status,
      f.farm?.evidence ? f.farm.evidence.status.replace('_', ' ') : '',
      h('div', { class: 'btns' },
        canReview && ['pending_review', 'duplicate_review'].includes(f.status) ? [
          h('button', { type: 'button', class: 'primary', onclick: () => act(`/v1/farmers/${f.id}/review`, { decision: 'approve' }, `${f.name} approved.`) }, 'Approve'),
          h('button', { type: 'button', class: 'secondary', onclick: () => act(`/v1/farmers/${f.id}/review`, { decision: 'reject' }, `${f.name} rejected.`) }, 'Reject')] : null,
        canVerify && f.status !== 'rejected' ? [
          h('button', { type: 'button', class: 'secondary', onclick: async () => {
            msg.replaceChildren(note('Getting your location…', 'info')); const pos = await getPos();
            await act(`/v1/farmers/${f.id}/field-verification`, { outcome: 'verified', method: 'site_visit', ...(pos ? { location: pos } : {}) }, `${f.name}: verified on site${pos ? ` (GPS ±${pos.accuracyMeters} m)` : ' (no GPS captured)'}.`);
          } }, 'Verified on site'),
          h('button', { type: 'button', class: 'secondary', onclick: () => act(`/v1/farmers/${f.id}/field-verification`, { outcome: 'rejected', method: 'site_visit' }, `${f.name}: not confirmed.`) }, 'Not confirmed')] : null),
    ])) : note('No farmers match.', 'info'));
  };
  status.addEventListener('change', () => load().catch((e) => msg.replaceChildren(fail(e))));
  el.append(h('div', { class: 'toolbar' }, field('Show', status)), msg, box); await load();
};

SCREENS.register = (el) => {
  const i = (id, attrs = {}) => h('input', { id: `r-${id}`, ...attrs });
  const a = areaInputs('r');
  const name = i('name', { required: true }); const phone = i('phone', { type: 'tel', required: true, placeholder: '08012345678' });
  const community = i('community'); const crop = i('crop', { required: true }); const area = i('area', { type: 'number', step: '0.01', min: '0.01' });
  const lat = i('lat', { type: 'number', step: 'any' }); const lng = i('lng', { type: 'number', step: 'any' }); const acc = i('acc', { type: 'number', min: '0' });
  const src = h('select', { id: 'r-src' }, [['farmer_reported', 'Typed in (not confirmed)'], ['gps_field_agent', 'GPS taken at the farm'], ['town_centre', 'Town or village centre']].map(([v, t]) => h('option', { value: v }, t)));
  const consent = h('input', { id: 'r-consent', type: 'checkbox', required: true });
  const test = h('input', { id: 'r-test', type: 'checkbox' });
  const out = h('div', { 'aria-live': 'polite' });
  const gpsBtn = h('button', { class: 'secondary', type: 'button', onclick: async () => {
    out.replaceChildren(note('Getting your location…', 'info')); const p = await getPos(); out.replaceChildren();
    if (!p) return out.append(note('Could not get a location. Allow location access, or type the coordinates.'));
    lat.value = p.lat; lng.value = p.lng; acc.value = p.accuracyMeters; src.value = 'gps_field_agent';
  } }, 'Use my location');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); out.replaceChildren();
      const body = {
        name: name.value.trim(), phone: phone.value.trim(), state: a.state.value.trim(), lga: a.lga.value.trim(), community: community.value.trim() || undefined,
        consent: { given: consent.checked, wordingVersion: 'console-draft-v0' }, source: user.role === 'field_agent' ? 'field_agent' : 'admin', isSynthetic: test.checked,
        farm: { crop: crop.value.trim(), ...(area.value ? { reportedAreaHa: Number(area.value) } : {}),
          ...(lat.value && lng.value ? { location: { lat: Number(lat.value), lng: Number(lng.value), source: src.value, ...(acc.value ? { accuracyMeters: Number(acc.value) } : {}) } } : {}) },
      };
      try {
        const r = await call('/v1/farmers', { method: 'POST', body });
        out.append(note(`${r.name}: ${r.message}${r.farmaslogId ? ` FarmasLog ID ${r.farmaslogId}.` : ''}${(r.warnings || []).length ? ` Note: ${r.warnings.join(', ').replaceAll('_', ' ')}.` : ''}`, r.duplicateCandidate ? 'info' : 'ok'));
        form.reset();
      } catch (err) { out.append(fail(err)); }
    },
  },
  h('div', { class: 'grid' }, field('Full name', name), field('Phone number', phone), field('State', a.state), field('Local government area', a.lga), ...a.lists,
    field('Community', community), field('Main crop', crop), field('Farm size (hectares)', area, 'What the farmer reports.')),
  h('h3', {}, 'Farm location (optional)'),
  h('div', { class: 'grid' }, field('Latitude', lat), field('Longitude', lng), field('Accuracy (metres)', acc), field('Where did the coordinates come from?', src)),
  h('div', { class: 'btns' }, gpsBtn),
  h('div', { class: 'check' }, consent, h('label', { for: 'r-consent' }, 'The farmer has been told what data is collected and why, and agrees to it.')),
  h('div', { class: 'check' }, test, h('label', { for: 'r-test' }, 'This is a test record (for demos).')),
  h('div', { class: 'btns' }, h('button', { class: 'primary', type: 'submit' }, 'Register farmer')));
  el.append(form, out);
};

// ---- team: the administrator onboards FarmasLog staff (field agents and others) ----
const copy = (text) => navigator.clipboard?.writeText(text);
SCREENS.team = async (el) => {
  const msg = h('div', { 'aria-live': 'polite' }); const box = h('div');
  const name = h('input', { id: 't-name', required: true, minlength: 2, maxlength: 120, autocomplete: 'off' });
  const email = h('input', { id: 't-email', type: 'email', required: true, autocomplete: 'off' });
  const role = h('select', { id: 't-role' }, ONBOARD.map(([v, t]) => h('option', { value: v }, t)));
  const reveal = (r, heading) => {
    const details = `FarmasLog sign-in: ${location.origin}\nEmail: ${r.email}\nTemporary password: ${r.temporaryPassword}\nYou will be asked to choose your own password the first time you sign in.`;
    msg.replaceChildren(h('div', { class: 'newkey', role: 'status' }, heading,
      h('dl', { class: 'cred' }, h('dt', {}, 'Email'), h('dd', {}, r.email), h('dt', {}, 'Temporary password'), h('dd', {}, h('code', {}, r.temporaryPassword))),
      h('p', { class: 'help' }, 'Share this privately. It is shown once. They must choose their own password at first sign-in.'),
      h('div', { class: 'btns' }, h('button', { class: 'secondary', type: 'button', onclick: () => copy(details) }, 'Copy sign-in details'))));
  };
  const act = async (path, body, after) => {
    try { const r = await call(path, { method: 'POST', body }); after?.(r); await load(); } catch (e) { msg.replaceChildren(fail(e)); }
  };
  const load = async () => {
    const r = await call('/v1/staff');
    box.replaceChildren(r.data.length ? table(['Name', 'Email', 'Role', 'Status', ''], r.data.map((u) => {
      const own = u.id === user.id; const locked = own || u.role === 'super_admin';
      return [u.name, u.email, ROLES[u.role] || u.role,
        h('span', {}, h('span', { class: `badge${u.status === 'disabled' ? ' off' : ''}` }, u.status === 'disabled' ? 'Disabled' : 'Active'), u.mustChangePassword ? [' ', h('span', { class: 'badge warn' }, 'Has not set a password yet')] : null),
        locked ? '' : h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'secondary', onclick: () => { if (confirm(`Issue a new temporary password for ${u.name}? Their current password will stop working.`)) act(`/v1/staff/${u.id}/reset-password`, undefined, (x) => reveal(x, `New temporary password for ${u.name}.`)); } }, 'Reset password'),
          u.status === 'disabled'
            ? h('button', { type: 'button', class: 'secondary', onclick: () => act(`/v1/staff/${u.id}/status`, { status: 'active' }, () => msg.replaceChildren(note(`${u.name} can sign in again.`, 'ok'))) }, 'Enable')
            : h('button', { type: 'button', class: 'secondary', onclick: () => { if (confirm(`Disable ${u.name}? They will not be able to sign in.`)) act(`/v1/staff/${u.id}/status`, { status: 'disabled' }, () => msg.replaceChildren(note(`${u.name} is disabled.`, 'ok'))); } }, 'Disable')),
      ];
    })) : note('No team members yet.', 'info'));
  };
  el.append(
    h('p', { class: 'sub' }, 'Add field agents and other FarmasLog staff. Each person gets a one-time temporary password and must choose their own before doing anything else.'),
    h('form', {
      class: 'grid',
      onsubmit: async (e) => {
        e.preventDefault(); msg.replaceChildren();
        try {
          const r = await call('/v1/staff', { method: 'POST', body: { name: name.value.trim(), email: email.value.trim(), role: role.value } });
          reveal(r, `${r.name} has been added as ${ROLES[r.role] || r.role}.`); name.value = ''; email.value = ''; await load();
        } catch (err) { msg.replaceChildren(fail(err)); }
      },
    }, field('Full name', name), field('Email', email), field('Role', role),
    h('div', { class: 'wide' }, h('button', { class: 'primary', type: 'submit' }, 'Add team member'))),
    msg, h('h3', {}, 'Your team'), box);
  await load();
};

// ---- password: everyone can change their own; a new team member is sent here first ----
SCREENS.password = (el) => {
  const forced = Boolean(user.mustChangePassword);
  const cur = h('input', { id: 'p-cur', type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { id: 'p-new', type: 'password', autocomplete: 'new-password', minlength: 12, required: true });
  const again = h('input', { id: 'p-again', type: 'password', autocomplete: 'new-password', minlength: 12, required: true });
  const out = h('div', { 'aria-live': 'polite' });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); out.replaceChildren();
      if (next.value !== again.value) return out.append(note('The two new passwords do not match.'));
      try {
        const r = await call('/v1/auth/change-password', { method: 'POST', body: { currentPassword: cur.value, newPassword: next.value } });
        if (forced) return await enter(r.user);
        user.mustChangePassword = false; form.reset(); out.append(note('Password updated.', 'ok'));
      } catch (err) { out.append(fail(err)); }
    },
  }, field(forced ? 'Temporary password' : 'Current password', eye(cur), forced ? 'The one your administrator gave you.' : null),
  field('New password', eye(next), 'At least 12 characters.'), field('Repeat new password', eye(again)),
  h('div', { class: 'btns' }, h('button', { class: 'primary', type: 'submit' }, 'Update password')));
  if (forced) el.append(note(`Welcome, ${user.name}. Choose your own password to continue.`, 'info'));
  el.append(form, out);
};

// ---- shell: sign in / sign up / signed-in app ----
function show(name) {
  for (const e of document.querySelectorAll('[data-view]')) e.hidden = e.dataset.view !== name;
  $('.shell').classList.toggle('app', name === 'app');
  document.body.classList.toggle('in-app', name === 'app');
  document.querySelector(`[data-view="${name}"] h2`)?.focus({ preventScroll: true });
}
function route() { show(user ? 'app' : location.hash === '#/signup' ? 'signup' : 'signin'); }

async function openScreen(name) {
  await areasReady;
  const el = $('#screen'); el.replaceChildren();
  $('#screen-title').textContent = TITLES[name];
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-current', String(b.dataset.tab === name));
  try { await SCREENS[name](el); } catch (e) { el.append(fail(e)); }
}

async function enter(u) {
  user = u;
  $('#org').textContent = `${u.name}${u.organization ? `, ${u.organization}` : ''}`;
  $('#role').textContent = ROLES[u.role] || u.role;
  const tabs = u.mustChangePassword ? ['password'] : TABS[u.role] || [];
  $('#tabs').replaceChildren(...tabs.map((t) => h('button', { type: 'button', 'data-tab': t, onclick: () => openScreen(t) }, TAB[t])));
  show('app');
  if (tabs.length) await openScreen(tabs[0]);
}
function signOut() { session.save(null); user = null; lastKey = ''; location.hash = '#/signin'; route(); }

function message(form, err) {
  const box = form.querySelector('.msg');
  box.replaceChildren(); box.classList.toggle('info', err.code === 'ACCOUNT_PENDING'); box.append(err.message);
  if (Array.isArray(err.details) && err.details.length) box.append(h('ul', {}, err.details.map((d) => h('li', {}, d))));
  box.hidden = false;
}
function bind(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); form.querySelector('.msg').hidden = true;
    const button = form.querySelector('button[type=submit]'); const label = button.textContent;
    button.disabled = true; button.textContent = 'Please wait';
    try { await handler(Object.fromEntries(new FormData(form))); }
    catch (err) { message(form, err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong. Try again.')); }
    finally { button.disabled = false; button.textContent = label; }
  });
}
for (const input of document.querySelectorAll('#form-signin input[type=password], #form-signup input[type=password]')) eye(input);
bind($('#form-signin'), async ({ email, password }) => {
  const r = await api('/v1/auth/login', { method: 'POST', body: { email: email.trim(), password } });
  session.save(r.token); await enter(r.user); location.hash = '#/app';
});
bind($('#form-signup'), async (f) => {
  await api('/v1/auth/signup', { method: 'POST', body: { ...f, email: f.email.trim(), organization: f.organization.trim(), name: f.name.trim() } });
  $('#form-signup').hidden = true; $('#signup-done').hidden = false;
});
$('#signout').addEventListener('click', signOut);
window.addEventListener('hashchange', route);

(async function init() {
  if (DEMO) { $('#demo-banner').hidden = false; $('#demo-hint').hidden = false; }
  if (session.token) {
    try { await enter((await api('/v1/auth/me', { token: session.token })).user); return; } catch { session.save(null); }
  }
  route();
})();
