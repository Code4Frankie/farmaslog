const cfg = window.FARMASLOG_CONFIG || {};
const API = String(cfg.apiUrl || '').replace(/\/+$/, '');
const DEMO = !API;
const DEMO_LOGIN = { email: 'demo@farmaslog.test', password: 'demo-password-123' };
const DEMO_USER = { name: 'Demo Lender', role: 'partner_verifier', organization: 'Demo Agri Bank' };
const ROLES = {
  super_admin: 'Administrator', data_manager: 'Data manager', field_agent: 'Field agent',
  partner_verifier: 'Partner verifier', finance: 'Finance', auditor: 'Auditor',
};

const $ = (s) => document.querySelector(s);
const session = {
  get token() { try { return sessionStorage.getItem('fl_token'); } catch { return null; } },
  save(t) { try { if (t) sessionStorage.setItem('fl_token', t); else sessionStorage.removeItem('fl_token'); } catch { /* storage blocked */ } },
};

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

// ---- API client (real, or sample data in demo mode) ----
async function api(path, { method = 'GET', body, token } = {}) {
  if (DEMO) return demoApi(path, body, token);
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
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
  if (path.startsWith('/v1/usage')) return { data: [{ billableUnits: 12 }] };
  throw new ApiError(404, 'NOT_AVAILABLE', 'Not available in demo mode.');
}

// ---- views ----
let user = null;
function show(name) {
  for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== name;
  const heading = document.querySelector(`[data-view="${name}"] h2`);
  if (heading) heading.focus({ preventScroll: true });
}

function route() {
  const h = location.hash;
  if (user) return show('app');
  show(h === '#/signup' ? 'signup' : 'signin');
}

function message(form, err) {
  const box = form.querySelector('.msg');
  box.replaceChildren();
  box.classList.toggle('info', err.code === 'ACCOUNT_PENDING');
  box.append(err.message);
  if (Array.isArray(err.details) && err.details.length) {
    const ul = document.createElement('ul');
    for (const d of err.details) { const li = document.createElement('li'); li.textContent = d; ul.append(li); }
    box.append(ul);
  }
  box.hidden = false;
}

function bind(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelector('.msg').hidden = true;
    const button = form.querySelector('button[type=submit]');
    const label = button.textContent;
    button.disabled = true; button.textContent = 'Please wait';
    try { await handler(Object.fromEntries(new FormData(form))); }
    catch (err) { message(form, err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong. Try again.')); }
    finally { button.disabled = false; button.textContent = label; }
  });
}

async function enter(u) {
  user = u;
  $('#who').textContent = u.name;
  $('#org').textContent = u.organization || 'FarmasLog';
  $('#role').textContent = ROLES[u.role] || u.role;
  $('#usage-row').hidden = true;
  show('app');
  try {
    const r = await api('/v1/usage?groupBy=month', { token: session.token });
    const total = (r.data || []).reduce((n, x) => n + (x.billableUnits || 0), 0);
    $('#usage').textContent = DEMO ? `${total} (sample)` : String(total);
    $('#usage-row').hidden = false;
  } catch { /* this role cannot see usage: leave the row hidden */ }
}

function signOut() { session.save(null); user = null; location.hash = '#/signin'; route(); }

bind($('#form-signin'), async ({ email, password }) => {
  const r = await api('/v1/auth/login', { method: 'POST', body: { email: email.trim(), password } });
  session.save(r.token);
  await enter(r.user);
  location.hash = '#/app';
});

bind($('#form-signup'), async (f) => {
  await api('/v1/auth/signup', { method: 'POST', body: { ...f, email: f.email.trim(), organization: f.organization.trim(), name: f.name.trim() } });
  $('#form-signup').hidden = true;
  $('#signup-done').hidden = false;
});

$('#signout').addEventListener('click', signOut);
window.addEventListener('hashchange', route);

(async function init() {
  if (DEMO) { $('#demo-banner').hidden = false; $('#demo-hint').hidden = false; }
  if (session.token) {
    try { const r = await api('/v1/auth/me', { token: session.token }); await enter(r.user); return; }
    catch { session.save(null); }
  }
  route();
})();
