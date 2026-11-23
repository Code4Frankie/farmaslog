const cfg = window.FARMASLOG_CONFIG || {};
const API = String(cfg.apiUrl || '').replace(/\/+$/, '');
const DEMO = !API;
const DEMO_LOGIN = { email: 'demo@farmaslog.test', password: 'demo-password-123' };
const DEMO_USER = { name: 'Demo Lender', role: 'partner_verifier', organization: 'Demo Agri Bank' };
const ROLES = { super_admin: 'Administrator', data_manager: 'Data manager', field_agent: 'Field agent', partner_verifier: 'Partner', finance: 'Finance', auditor: 'Auditor' };
const TABS = {
  partner_verifier: ['console', 'keys', 'usage', 'password'], super_admin: ['approvals', 'farmers', 'register', 'team', 'consentinfo', 'keys', 'usage', 'password'],
  data_manager: ['farmers', 'register', 'consentinfo', 'password'], field_agent: ['register', 'farmers', 'password'], finance: ['usage', 'password'], auditor: ['usage', 'farmers', 'password'],
};
const TITLES = { console: 'Verify a farmer', keys: 'API keys', usage: 'Usage', approvals: 'Access requests', farmers: 'Farmers', register: 'Register a farmer', team: 'FarmasLog team', consentinfo: 'Consent details', password: 'Change your password' };
const TAB = { console: 'Verify', keys: 'API keys', usage: 'Usage', approvals: 'Requests', farmers: 'Farmers', register: 'Register', team: 'Team', consentinfo: 'Consent info', password: 'Password' };
const ORG_TYPES = { bank: 'Bank or lender', government: 'Government agency', ngo: 'NGO or grant funder', programme: 'Agricultural programme', insurer: 'Insurer', cooperative: 'Cooperative', extension: 'Extension service', other: 'Other' };
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
  if (path === '/v1/auth/agent-signup') {
    if (String(body.password).length < 12) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.', ['password must be at least 12 characters long']);
    return { message: 'Application received.' };
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

async function initArea() {
  try { AREAS = (await (await fetch('areas.json')).json()).states || {}; } catch { AREAS = {}; }
  $('#ag-states').replaceChildren(...options(Object.keys(AREAS)));
  $('#ag-state').addEventListener('input', () => $('#ag-lgas').replaceChildren(...options(AREAS[find(Object.keys(AREAS), $('#ag-state').value)] || [])));
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
  const msg = h('div', { 'aria-live': 'polite' }); const orgs = h('div'); const agents = h('div');
  const DONE = { approve: 'approved', reject: 'rejected' };
  const decide = async (path, label, act) => {
    try { await call(`${path}/${act}`, { method: 'POST' }); msg.replaceChildren(note(`${label}: ${DONE[act]}.`, 'ok')); await load(); } catch (e) { msg.replaceChildren(fail(e)); }
  };
  const buttons = (path, label) => h('div', { class: 'btns' }, [['approve', 'Approve', 'primary'], ['reject', 'Reject', 'secondary']].map(([act, text, cls]) => h('button', { type: 'button', class: cls, onclick: () => decide(path, label, act) }, text)));
  const load = async () => {
    const [p, a] = await Promise.all([call('/v1/partners?status=pending'), call('/v1/staff?status=pending')]);
    orgs.replaceChildren(p.data.length ? table(['Organisation', 'Type', 'Requested', ''], p.data.map((x) => [x.organization, ORG_TYPES[x.type] || x.type, date(x.createdAt), buttons(`/v1/partners/${x._id}`, x.organization)])) : note('No pending organisation requests.', 'info'));
    agents.replaceChildren(a.data.length ? table(['Name', 'Email', 'Phone', 'Area', 'Applied', ''], a.data.map((x) => [x.name, x.email, x.phone || '', [x.lga, x.state].filter(Boolean).join(', '), date(x.createdAt), buttons(`/v1/staff/${x.id}`, x.name)])) : note('No pending field agent applications.', 'info'));
  };
  el.append(msg, h('h3', {}, 'Organisations and agencies'), orgs, h('h3', {}, 'Field agent applications'), agents); await load();
};

// ---- consent: text comes from the API; the version and language shown are the ones submitted ----
const LANG_NAMES = { en: 'English', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo', tiv: 'Tiv', pcm: 'Nigerian Pidgin' };
const METHODS = [['agent_read_aloud', 'Agent read it aloud'], ['agent_checkbox', 'Farmer read it, agent ticked'], ['self_checkbox', 'Farmer ticked it themselves']];
const PLACEHOLDER_LABELS = { registeredAddress: 'registered address', email: 'contact email', phone: 'contact phone', whatsapp: 'WhatsApp number', retention: 'retention period', hosting: 'hosting provider/country' };
function consentWidget() {
  const wrap = h('div', { class: 'consent' });
  const lang = h('select', { id: 'c-lang' }, Object.entries(LANG_NAMES).map(([v, t]) => h('option', { value: v }, t)));
  const method = h('select', { id: 'c-method' }, METHODS.map(([v, t]) => h('option', { value: v }, t)));
  const core = h('input', { id: 'c-core', type: 'checkbox' });
  const share = h('input', { id: 'c-share', type: 'checkbox' });
  const media = h('input', { id: 'c-media', type: 'checkbox' });
  const body = h('div', { class: 'consent-text', 'aria-live': 'polite' });
  let data = null; let showScript = false;
  const render = () => {
    if (!data) return;
    const script = h('div', { class: 'consent-script' }, h('p', {}, h('strong', {}, 'Read aloud: '), data.readAloud), h('p', { class: 'help' }, data.agentNote));
    body.replaceChildren(
      data.needsTranslation ? note(`The ${LANG_NAMES[data.language]} text has not been reviewed yet, so the English text is shown. Read it out in ${LANG_NAMES[data.language]} only if you can do so faithfully.`, 'info') : null,
      data.incomplete ? note(`This consent text is incomplete: ${data.missingPlaceholders.map((k) => PLACEHOLDER_LABELS[k] || k).join(', ')} not set yet. Do not use it with real farmers until the operator fills these in.`) : null,
      h('h3', {}, data.title),
      ...data.sections.map((s) => h('p', {}, h('strong', {}, s.heading), ' ', s.body)),
      h('div', { class: 'btns' }, h('button', { type: 'button', class: 'secondary', onclick: () => { showScript = !showScript; render(); } }, showScript ? 'Hide read-aloud script' : 'Show read-aloud script')),
      showScript ? script : null,
      h('p', {}, h('strong', {}, data.agreementsIntro)));
  };
  const load = async () => {
    try { data = await call(`/v1/reference/consent?lang=${lang.value}`); render(); } catch (e) { body.replaceChildren(fail(e)); }
  };
  lang.addEventListener('change', load);
  wrap.append(field('Language the farmer will hear or read', lang), body,
    h('div', { class: 'check' }, core, h('label', { for: 'c-core' }, 'I have read, or had read to me, how FarmasLog will use my information, and I agree to it.')),
    h('div', { class: 'check' }, share, h('label', { for: 'c-share' }, 'I agree that approved partners can check whether my record exists and see the information described above.')),
    h('div', { class: 'check' }, media, h('label', { for: 'c-media' }, '(Optional) I agree that FarmasLog may keep photos or documents I give to support my record.')),
    field('How was consent given?', method));
  return {
    el: wrap, ready: load(),
    // The farmer-facing agreement labels come from the API when available (kept in sync with the displayed text).
    value: () => ({ given: core.checked, wordingVersion: data?.version, language: lang.value, method: method.value, partnerSharing: share.checked, mediaStorage: media.checked }),
    valid: () => !!data && core.checked,
    reset: () => { core.checked = share.checked = media.checked = false; },
  };
}

SCREENS.farmers = async (el) => {
  const canReview = ['super_admin', 'data_manager'].includes(user.role);
  const canVerify = ['super_admin', 'data_manager', 'field_agent'].includes(user.role);
  const status = h('select', { id: 'f-status' }, [['', 'All'], ['pending_review', 'Pending review'], ['duplicate_review', 'Possible duplicate'], ['active', 'Approved'], ['rejected', 'Rejected']].map(([v, t]) => h('option', { value: v }, t)));
  const consentFilter = h('select', { id: 'f-consent' }, [['', 'Any'], ['needs_reconsent', 'Needs re-consent'], ['withdrawn', 'Withdrawn']].map(([v, t]) => h('option', { value: v }, t)));
  const box = h('div'); const msg = h('div', { 'aria-live': 'polite' });
  const act = async (path, body, okText, method = 'POST') => {
    msg.replaceChildren();
    try { await call(path, { method, body }); msg.append(note(okText, 'ok')); await load(); } catch (e) { msg.append(fail(e)); }
  };
  const load = async () => {
    const r = await call(`/v1/farmers?limit=50${status.value ? `&status=${status.value}` : ''}${consentFilter.value ? `&consentStatus=${consentFilter.value}` : ''}`);
    box.replaceChildren(h('p', { class: 'help' }, `Showing ${r.data.length} of ${r.total}.`), r.data.length ? table(['Name', 'Phone', 'Area', 'Status', 'Consent', 'Evidence', ''], r.data.map((f) => [
      h('span', {}, f.name, f.isSynthetic ? ' (test)' : ''),
      h('span', {}, f.phone || (f.contactVia ? `Contact: ${f.contactVia.name || f.contactVia.type.replaceAll('_', ' ')}${f.contactVia.phone ? ` ${f.contactVia.phone}` : ''}` : 'No phone'), f.sharedPhone ? [' ', h('span', { class: 'badge warn' }, 'Shared phone')] : null),
      [f.community, f.lga, f.state].filter(Boolean).join(', '), STATUS[f.status] || f.status,
      f.consentStatus === 'withdrawn' ? h('span', { class: 'badge off' }, 'Withdrawn') : f.consentStatus === 'needs_reconsent' ? h('span', { class: 'badge warn' }, 'Needs re-consent') : 'OK',
      f.farm?.evidence ? f.farm.evidence.status.replace('_', ' ') : '',
      h('div', { class: 'btns' },
        canReview && f.phone ? h('button', { type: 'button', class: 'secondary', onclick: () => act(`/v1/farmers/${f.id}`, { sharedPhone: !f.sharedPhone }, f.sharedPhone ? `${f.name}: phone marked as not shared.` : `${f.name}: phone marked as shared.`, 'PATCH') }, f.sharedPhone ? 'Phone not shared' : 'Phone is shared') : null,
        canVerify ? h('button', { type: 'button', class: 'secondary', onclick: () => recordConsent(f) }, 'Record consent') : null,
        canVerify && f.consentStatus !== 'withdrawn' ? h('button', { type: 'button', class: 'secondary', onclick: async () => {
          if (!confirm(`Withdraw consent for ${f.name}? The record will stop appearing to partners straight away.`)) return;
          const reason = prompt('Reason (optional, do not include sensitive details):') ?? '';
          await act(`/v1/farmers/${f.id}/consent-withdrawal`, reason.trim() ? { reason: reason.trim() } : {}, `Consent withdrawn for ${f.name}.`);
        } }, 'Withdraw consent') : null,
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
  const recordConsent = async (f) => {
    const cw = consentWidget(); await cw.ready;
    const submit = h('button', { type: 'submit', class: 'primary' }, 'Save consent');
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!cw.valid()) return msg.replaceChildren(note('Tick the first agreement only after a clear yes from the farmer.'));
      await act(`/v1/farmers/${f.id}/reconsent`, { consent: cw.value() }, `Consent recorded for ${f.name}.`);
    } }, h('h3', {}, `Record consent: ${f.name}`), cw.el, h('div', { class: 'btns' }, submit, h('button', { type: 'button', class: 'secondary', onclick: () => msg.replaceChildren() }, 'Cancel')));
    msg.replaceChildren(form); form.scrollIntoView?.({ block: 'start' });
  };
  status.addEventListener('change', () => load().catch((e) => msg.replaceChildren(fail(e))));
  consentFilter.addEventListener('change', () => load().catch((e) => msg.replaceChildren(fail(e))));
  el.append(h('div', { class: 'toolbar' }, field('Show', status), field('Consent', consentFilter)), msg, box); await load();
};

SCREENS.register = (el) => {
  const i = (id, attrs = {}) => h('input', { id: `r-${id}`, ...attrs });
  const a = areaInputs('r');
  const name = i('name', { required: true }); const phone = i('phone', { type: 'tel', placeholder: '08012345678' });
  const ctype = h('select', { id: 'r-ctype' }, [['', 'No contact person'], ['relative', 'A relative'], ['cooperative_leader', 'Cooperative or group leader'], ['agent', 'Me (the agent)'], ['farmer', 'Another number for the farmer']].map(([v, t]) => h('option', { value: v }, t)));
  const cname = i('cname'); const cphone = i('cphone', { type: 'tel', placeholder: '08012345678' }); const crel = i('crel', { placeholder: 'For example: son, aunt, chairman' });
  const cbox = h('div', { class: 'grid', hidden: true }, field('Contact name', cname), field('Contact phone', cphone, 'Needed unless you are the contact.'), field('Relationship to the farmer', crel));
  ctype.addEventListener('change', () => { cbox.hidden = !ctype.value; });
  const sel = (id, opts) => h('select', { id }, [['', 'Not asked'], ...opts].map(([v, t]) => h('option', { value: v }, t)));
  const gender = sel('r-gender', [['female', 'Female'], ['male', 'Male'], ['other', 'Other'], ['prefer_not_to_say', 'Prefers not to say']]);
  const ageBand = sel('r-age', [['18_24', '18 to 24'], ['25_34', '25 to 34'], ['35_44', '35 to 44'], ['45_54', '45 to 54'], ['55_64', '55 to 64'], ['65_plus', '65 or older'], ['prefer_not_to_say', 'Prefers not to say']]);
  const disability = sel('r-dis', [['none', 'No'], ['yes', 'Yes'], ['prefer_not_to_say', 'Prefers not to say']]);
  const community = i('community'); const crop = i('crop', { required: true }); const area = i('area', { type: 'number', step: '0.01', min: '0.01' });
  const lat = i('lat', { type: 'number', step: 'any' }); const lng = i('lng', { type: 'number', step: 'any' }); const acc = i('acc', { type: 'number', min: '0' });
  const src = h('select', { id: 'r-src' }, [['farmer_reported', 'Typed in (not confirmed)'], ['gps_field_agent', 'GPS taken at the farm'], ['town_centre', 'Town or village centre']].map(([v, t]) => h('option', { value: v }, t)));
  const cw = consentWidget();
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
      if (!cw.valid()) return out.append(note('Tick the first agreement only after the farmer has clearly said yes. If the consent text did not load, check your connection.'));
      if (!phone.value.trim() && !ctype.value) return out.append(note('Enter the farmer\'s phone number, or choose a contact person who can reach them.'));
      if (ctype.value && ctype.value !== 'agent' && !cphone.value.trim()) return out.append(note('Enter the contact person\'s phone number.'));
      const body = {
        name: name.value.trim(), ...(phone.value.trim() ? { phone: phone.value.trim() } : {}),
        ...(ctype.value ? { contactVia: { type: ctype.value, name: cname.value.trim(), phone: cphone.value.trim(), relationship: crel.value.trim() } } : {}),
        ...(gender.value || ageBand.value || disability.value ? { inclusion: Object.fromEntries([['gender', gender.value], ['ageBand', ageBand.value], ['disability', disability.value]].filter(([, v]) => v)) } : {}),
        state: a.state.value.trim(), lga: a.lga.value.trim(), community: community.value.trim() || undefined,
        consent: cw.value(), source: user.role === 'field_agent' ? 'field_agent' : 'admin', isSynthetic: test.checked,
        farm: { crop: crop.value.trim(), ...(area.value ? { reportedAreaHa: Number(area.value) } : {}),
          ...(lat.value && lng.value ? { location: { lat: Number(lat.value), lng: Number(lng.value), source: src.value, ...(acc.value ? { accuracyMeters: Number(acc.value) } : {}) } } : {}) },
      };
      try {
        const r = await call('/v1/farmers', { method: 'POST', body });
        out.append(note(`${r.name}: ${r.message}${r.farmaslogId ? ` FarmasLog ID ${r.farmaslogId}.` : ''}${r.sharedPhone && !r.duplicateCandidate ? ' This phone number is shared with another farmer.' : ''}${(r.warnings || []).length ? ` Note: ${r.warnings.join(', ').replaceAll('_', ' ')}.` : ''}`, r.duplicateCandidate ? 'info' : 'ok'));
        form.reset(); cw.reset(); cbox.hidden = true;
      } catch (err) { out.append(fail(err)); }
    },
  },
  h('div', { class: 'grid' }, field('Full name', name), field('Phone number', phone, 'Leave empty if the farmer has no phone, and add a contact person below.'), field('State', a.state), field('Local government area', a.lga), ...a.lists,
    field('Community', community), field('Main crop', crop), field('Farm size (hectares)', area, 'What the farmer reports.')),
  h('h3', {}, 'Contact person (optional if the farmer has a phone)'),
  field('Who can reach the farmer?', ctype), cbox,
  h('h3', {}, 'About the farmer (optional)'),
  h('p', { class: 'hint' }, 'Ask kindly. Every answer is voluntary and "Prefers not to say" is fine. This only helps us report on who is being reached; it is never shown to partners.'),
  h('div', { class: 'grid' }, field('Gender', gender), field('Age group', ageBand), field('Lives with a disability', disability)),
  h('h3', {}, 'Farm location (optional)'),
  h('div', { class: 'grid' }, field('Latitude', lat), field('Longitude', lng), field('Accuracy (metres)', acc), field('Where did the coordinates come from?', src)),
  h('div', { class: 'btns' }, gpsBtn),
  h('h3', {}, 'Farmer consent'),
  cw.el,
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
      const locked = u.id === user.id || u.role === 'super_admin' || u.status === 'pending';
      return [u.name, u.email, ROLES[u.role] || u.role,
        h('span', {}, h('span', { class: `badge${u.status === 'disabled' ? ' off' : u.status === 'pending' ? ' warn' : ''}` }, { disabled: 'Disabled', pending: 'Awaiting approval' }[u.status] || 'Active'), u.mustChangePassword ? [' ', h('span', { class: 'badge warn' }, 'Has not set a password yet')] : null),
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

// ---- consent details: the contact details printed in the consent text. Only the administrator can edit them. ----
SCREENS.consentinfo = async (el) => {
  const msg = h('div', { 'aria-live': 'polite' }); const box = h('div');
  const canEdit = user.role === 'super_admin';
  const SOURCE = { saved: ['Saved by you', ''], default: ['Default', 'info'], missing: ['Not set yet', 'warn'] };
  const hints = { registeredAddress: 'Street, town, state.', retention: 'For example: 2 years after the last update.', hosting: 'For example: MongoDB Atlas (AWS, Ireland) and Render (Frankfurt).' };
  const show = (r) => {
    box.replaceChildren(
      r.incomplete ? note(`The consent text still has gaps: ${r.missingPlaceholders.join(', ')}. Agents will see them in [brackets].`, 'info') : note('The consent text is complete.', 'ok'),
      table(['Detail', 'Shown to farmers as', 'Source'], r.data.map((d) => [d.label[0].toUpperCase() + d.label.slice(1), d.value || h('em', {}, 'not set'), h('span', { class: `badge ${SOURCE[d.source][1]}` }, SOURCE[d.source][0])])),
      canEdit ? h('div', { class: 'btns' }, h('button', { type: 'button', class: 'primary', onclick: () => edit(r) }, 'Edit')) : h('p', { class: 'help' }, 'Only the administrator can edit these.'));
  };
  const edit = (r) => {
    const inputs = Object.fromEntries(r.data.map((d) => [d.key, h('input', { id: `cd-${d.key}`, value: d.value, maxlength: 300 })]));
    box.replaceChildren(h('form', {
      class: 'grid',
      onsubmit: async (e) => {
        e.preventDefault(); msg.replaceChildren();
        const body = Object.fromEntries(r.data.filter((d) => inputs[d.key].value.trim() !== d.value).map((d) => [d.key, inputs[d.key].value.trim()]));
        if (!Object.keys(body).length) return load();
        try {
          const out = await call('/v1/admin/consent-details', { method: 'PUT', body });
          msg.replaceChildren(note('Saved. New consents will show the updated text. Consents already recorded keep the text the farmer was shown.', 'ok')); show(out);
        } catch (err) { msg.replaceChildren(fail(err)); }
      },
    }, ...r.data.map((d) => field(d.label[0].toUpperCase() + d.label.slice(1), inputs[d.key], hints[d.key])),
    h('div', { class: 'wide btns' }, h('button', { class: 'primary', type: 'submit' }, 'Save'), h('button', { type: 'button', class: 'secondary', onclick: () => load() }, 'Cancel'))));
  };
  const load = async () => { try { show(await call('/v1/admin/consent-details')); } catch (e) { box.replaceChildren(fail(e)); } };
  el.append(h('p', { class: 'sub' }, 'These details are printed in the consent text farmers hear and agree to. Keep them correct: contact details, how long records are kept, and where data is hosted.'), msg, box);
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
let current = 'signin';
const ROUTES = { '#/signin': 'signin', '#/signup': 'signup', '#/agent': 'agent', '#/farmers': 'farmers' };
function show(name) {
  current = name;
  for (const e of document.querySelectorAll('[data-view]')) e.hidden = e.dataset.view !== name;
  $('.shell').classList.toggle('app', name === 'app');
  document.body.classList.toggle('in-app', name === 'app');
  document.querySelector(`[data-view="${name}"] h2`)?.focus({ preventScroll: true });
}
function route(scroll = false) {
  const next = user ? 'app' : ROUTES[location.hash] || (location.hash ? current : 'signin');
  show(next);
  if (scroll && next !== 'app') $('.shell').scrollIntoView({ block: 'start' });
}

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
for (const input of document.querySelectorAll('#form-signin input[type=password], #form-signup input[type=password], #form-agent input[type=password]')) eye(input);
bind($('#form-signin'), async ({ email, password }) => {
  const r = await api('/v1/auth/login', { method: 'POST', body: { email: email.trim(), password } });
  session.save(r.token); await enter(r.user); location.hash = '#/app';
});
bind($('#form-signup'), async (f) => {
  await api('/v1/auth/signup', { method: 'POST', body: { ...f, email: f.email.trim(), organization: f.organization.trim(), name: f.name.trim() } });
  $('#form-signup').hidden = true; $('#signup-done').hidden = false;
});
bind($('#form-agent'), async (f) => {
  await api('/v1/auth/agent-signup', { method: 'POST', body: { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), state: f.state.trim(), lga: f.lga.trim(), password: f.password } });
  $('#form-agent').hidden = true; $('#agent-done').hidden = false;
});
$('#signout').addEventListener('click', signOut);
// ---- site menu: hamburger on small screens ----
const menuBtn = $('#menu-btn'); const siteNav = $('#site-nav');
const setMenu = (open) => { siteNav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
siteNav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && siteNav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
document.addEventListener('click', (e) => { if (siteNav.classList.contains('open') && !e.target.closest('.site-header')) setMenu(false); });
const markNav = () => {
  for (const a of siteNav.querySelectorAll('a')) {
    const here = a.dataset.route === location.hash && a.dataset.route !== '#/signup-gov';
    if (here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
};
window.addEventListener('hashchange', () => { route(true); markNav(); });

(async function init() {
  if (DEMO) { $('#demo-banner').hidden = false; $('#demo-hint').hidden = false; }
  if (session.token) {
    try { await enter((await api('/v1/auth/me', { token: session.token })).user); return; } catch { session.save(null); }
  }
  route(); markNav();
})();
