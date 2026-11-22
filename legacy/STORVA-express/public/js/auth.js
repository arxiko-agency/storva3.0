/* STORVA authentication UI. Talks to /api/auth/*. No demo codes, no client-side "success".
   Loaded before app.js; uses $, toast, go, route from app.js only at call time. */
const API = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) { /* non-JSON */ }
  if (!r.ok) {
    const err = new Error((j && j.error && j.error.message) || 'Something went wrong. Please try again.');
    err.status = r.status; err.code = j && j.error && j.error.code; err.fields = j && j.error && j.error.fields; err.details = j && j.error && j.error.details;
    throw err;
  }
  return j;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ME = null, authTimer = null, authView = 'login', authCtx = {};
const AIN = 'w-full px-4 py-3 rounded-xl border-2 border-[#E3E5F0] bg-white outline-none focus:border-iris';
const fieldErr = (id) => `<p id="e_${id}" class="text-red-600 text-sm mt-1 hidden"></p>`;

async function initAuth() {
  try { ME = (await API('/auth/me')).user; authed = true; applyUser(); } catch (e) { ME = null; authed = false; }
}
function applyUser() {
  const av = document.getElementById('userAv'); if (av && ME) { av.textContent = (ME.name || '?').trim().charAt(0).toUpperCase(); av.title = ME.name; }
}
async function logout() {
  try { await API('/auth/logout', { method: 'POST' }); } catch (e) { /* cookie may already be gone */ }
  ME = null; authed = false; go('home'); toast('You have been logged out');
}

function showErrors(err, ids) {
  document.querySelectorAll('[id^="e_"]').forEach((p) => p.classList.add('hidden'));
  const f = err.fields || {};
  let shown = false;
  Object.keys(f).forEach((k) => { const p = document.getElementById('e_' + k); if (p) { p.textContent = f[k]; p.classList.remove('hidden'); shown = true; } });
  if (!shown) { const g = document.getElementById('e_form'); if (g) { g.textContent = err.message; g.classList.remove('hidden'); } else toast(err.message); }
}
function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? 'Please wait…' : label; btn.classList.toggle('opacity-60', on); }

function renderAuth(view, ctx) {
  clearInterval(authTimer); authView = view; authCtx = ctx || {};
  const box = document.getElementById('authBox');
  const views = { login: vLogin, register: vRegister, codeLogin: vCodeLogin, forgot: vForgot, otp: vOtp, reset: vReset };
  box.innerHTML = views[view](authCtx);
  const first = box.querySelector('input'); if (first) first.focus();
  if (view === 'otp' || view === 'reset') bindOtp();
}
const authLink = (txt, v, ctx) => `<button type="button" class="font-bold text-iris" data-nav="${v}" ${ctx ? `data-ctx='${esc(JSON.stringify(ctx))}'` : ''}>${txt}</button>`;

function vLogin() {
  return `<h1 class="text-3xl font-extrabold">Welcome back</h1><p class="mt-2 text-ink/60">Log in to manage your stores.</p>
  <form id="fLogin" class="mt-6 grid gap-4" novalidate>
   <label class="text-sm font-semibold">Email or mobile number<input name="identifier" autocomplete="username" class="mt-1 ${AIN} font-normal" placeholder="you@example.com or 98765 43210"></label>
   <label class="text-sm font-semibold">Password<input name="password" type="password" autocomplete="current-password" class="mt-1 ${AIN} font-normal"></label>
   <p id="e_form" class="text-red-600 text-sm hidden" role="alert"></p>
   <button class="btn btn-p w-full" id="bLogin">Log in</button>
  </form>
  <div class="mt-4 flex justify-between text-sm">${authLink('Forgot password?', 'forgot')}${authLink('Log in with a code', 'codeLogin')}</div>
  <p class="mt-6 text-sm text-ink/60 text-center">New to ${esc(CONFIG.brand)}? ${authLink('Create an account', 'register')}</p>
  <button type="button" data-action="go" data-arg="home" class="w-full mt-3 text-sm text-ink/60 font-semibold">← Back to home</button>`;
}
function vRegister() {
  return `<h1 class="text-3xl font-extrabold">Create your account</h1><p class="mt-2 text-ink/60">Start free. No card needed.</p>
  <form id="fReg" class="mt-6 grid gap-3" novalidate>
   <label class="text-sm font-semibold">Your name<input name="name" autocomplete="name" class="mt-1 ${AIN} font-normal">${fieldErr('name')}</label>
   <label class="text-sm font-semibold">Email<input name="email" type="email" autocomplete="email" class="mt-1 ${AIN} font-normal">${fieldErr('email')}</label>
   <label class="text-sm font-semibold">Mobile number (India)<div class="mt-1 flex gap-2"><span class="px-4 grid place-items-center rounded-xl border-2 border-[#E3E5F0] bg-white font-semibold">+91</span><input name="phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" class="flex-1 min-w-0 ${AIN} font-normal"></div>${fieldErr('phone')}</label>
   <label class="text-sm font-semibold">Password<input name="password" type="password" autocomplete="new-password" class="mt-1 ${AIN} font-normal"><span class="block text-xs font-normal text-ink/50 mt-1">8+ characters with a letter and a number.</span>${fieldErr('password')}</label>
   <fieldset class="text-sm"><legend class="font-semibold">Send my verification code to</legend>
    <div class="mt-1 flex gap-4"><label><input type="radio" name="verifyVia" value="email" checked class="accent-iris"> Email</label><label><input type="radio" name="verifyVia" value="phone" class="accent-iris"> SMS</label></div></fieldset>
   <p id="e_form" class="text-red-600 text-sm hidden" role="alert"></p>
   <button class="btn btn-p w-full" id="bReg">Create account</button>
   <p class="text-xs text-ink/50 text-center">By continuing you agree to our <a class="underline" href="/terms">Terms</a> and <a class="underline" href="/privacy">Privacy Policy</a>.</p>
  </form>
  <p class="mt-4 text-sm text-ink/60 text-center">Already have an account? ${authLink('Log in', 'login')}</p>`;
}
function vCodeLogin() {
  return `<h1 class="text-3xl font-extrabold">Log in with a code</h1><p class="mt-2 text-ink/60">We’ll send a 6-digit code to your email or mobile.</p>
  <form id="fCode" class="mt-6 grid gap-4" novalidate>
   <label class="text-sm font-semibold">Email or mobile number<input name="identifier" autocomplete="username" class="mt-1 ${AIN} font-normal">${fieldErr('identifier')}</label>
   <p id="e_form" class="text-red-600 text-sm hidden" role="alert"></p>
   <button class="btn btn-p w-full" id="bCode">Send code</button>
  </form><p class="mt-4 text-sm text-center">${authLink('← Back to password login', 'login')}</p>`;
}
function vForgot() {
  return `<h1 class="text-3xl font-extrabold">Reset your password</h1><p class="mt-2 text-ink/60">Enter your email or mobile number and we’ll send a code.</p>
  <form id="fForgot" class="mt-6 grid gap-4" novalidate>
   <label class="text-sm font-semibold">Email or mobile number<input name="identifier" autocomplete="username" class="mt-1 ${AIN} font-normal">${fieldErr('identifier')}</label>
   <p id="e_form" class="text-red-600 text-sm hidden" role="alert"></p>
   <button class="btn btn-p w-full" id="bForgot">Send code</button>
  </form><p class="mt-4 text-sm text-center">${authLink('← Back to login', 'login')}</p>`;
}
const otpBoxes = () => `<div class="mt-6 grid grid-cols-6 gap-2" id="otpRow">${Array.from({ length: 6 }, (_, i) => `<input class="otp" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" autocomplete="${i ? 'off' : 'one-time-code'}">`).join('')}</div>`;
const resendRow = () => `<p class="mt-4 text-sm text-ink/60 text-center"><span id="rsT"></span><button type="button" id="rsB" class="hidden font-bold text-iris">Resend code</button></p>`;
function vOtp(c) {
  const t = c.purpose === 'register' ? 'Verify your account' : 'Enter your code';
  return `<button type="button" class="text-sm font-semibold text-ink/60" data-nav="${c.purpose === 'register' ? 'register' : 'login'}">← Back</button>
  <h1 class="mt-4 text-3xl font-extrabold">${t}</h1><p class="mt-2 text-ink/60">We sent a 6-digit code to <b class="text-ink">${esc(c.display)}</b>. It expires in 10 minutes.</p>
  ${otpBoxes()}<p id="e_form" class="text-red-600 text-sm mt-3 hidden" role="alert"></p>
  <button class="btn btn-p w-full mt-5" id="bVerify">Verify and continue</button>${resendRow()}`;
}
function vReset(c) {
  return `<button type="button" class="text-sm font-semibold text-ink/60" data-nav="forgot">← Back</button>
  <h1 class="mt-4 text-3xl font-extrabold">Choose a new password</h1><p class="mt-2 text-ink/60">Enter the code sent to <b class="text-ink">${esc(c.display)}</b>.</p>
  ${otpBoxes()}
  <label class="block mt-5 text-sm font-semibold">New password<input id="newPw" type="password" autocomplete="new-password" class="mt-1 ${AIN} font-normal">${fieldErr('password')}</label>
  <p id="e_form" class="text-red-600 text-sm mt-3 hidden" role="alert"></p>
  <button class="btn btn-p w-full mt-5" id="bReset">Reset password</button>${resendRow()}`;
}

const maskId = (id) => id.includes('@') ? id.replace(/^(.).*(@.*)$/, '$1•••$2') : '+' + id.slice(0, 2) + ' •••••' + id.slice(-3);
const otpCode = () => [...document.querySelectorAll('#otpRow .otp')].map((b) => b.value).join('');
function startResend() {
  let s = 30; const t = document.getElementById('rsT'), b = document.getElementById('rsB');
  b.classList.add('hidden'); t.classList.remove('hidden'); t.textContent = 'Resend code in 30s';
  clearInterval(authTimer);
  authTimer = setInterval(() => { s--; t.textContent = 'Resend code in ' + s + 's'; if (s <= 0) { clearInterval(authTimer); t.classList.add('hidden'); b.classList.remove('hidden'); } }, 1000);
}
function bindOtp() {
  const boxes = [...document.querySelectorAll('#otpRow .otp')];
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => { b.value = b.value.replace(/\D/g, ''); if (b.value && i < 5) boxes[i + 1].focus(); if (authView === 'otp' && boxes.every((x) => x.value)) submitOtp(); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; } if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus(); if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus(); });
    b.addEventListener('paste', (e) => { e.preventDefault(); const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); d.split('').forEach((c, j) => { boxes[j].value = c; }); boxes[Math.min(d.length, 5)].focus(); if (authView === 'otp' && d.length === 6) submitOtp(); });
  });
  boxes[0].focus(); startResend();
  document.getElementById('rsB').onclick = async () => {
    try { await API('/auth/otp/send', { method: 'POST', body: { identifier: authCtx.identifier, purpose: authCtx.purpose } }); toast('A new code is on its way'); boxes.forEach((b) => { b.value = ''; }); boxes[0].focus(); startResend(); }
    catch (e) { toast(e.message); }
  };
}

async function submitOtp() {
  const btn = document.getElementById('bVerify'); const code = otpCode();
  if (code.length !== 6) return showErrors({ message: 'Enter all 6 digits.' });
  busy(btn, true, 'Verify and continue');
  try {
    const path = authCtx.purpose === 'register' ? '/auth/register/verify' : '/auth/otp/login';
    ME = (await API(path, { method: 'POST', body: { identifier: authCtx.identifier, code } })).user;
    authed = true; applyUser(); go('app'); toast('Welcome, ' + ME.name.split(' ')[0] + '!');
  } catch (e) { showErrors(e); document.getElementById('otpRow').classList.add('shake'); setTimeout(() => document.getElementById('otpRow').classList.remove('shake'), 300); }
  busy(btn, false, 'Verify and continue');
}

// One delegated handler for every auth form and link (no inline handlers needed).
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav && nav.closest('#authBox')) { let ctx = {}; try { ctx = nav.dataset.ctx ? JSON.parse(nav.dataset.ctx) : {}; } catch (x) { /* ignore */ } renderAuth(nav.dataset.nav, ctx); }
  if (e.target.id === 'bVerify') submitOtp();
  if (e.target.id === 'bReset') submitReset();
});
document.addEventListener('submit', async (e) => {
  const f = e.target; if (!f.closest || !f.closest('#authBox')) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'fLogin') {
      const b = document.getElementById('bLogin'); busy(b, true, 'Log in');
      try { ME = (await API('/auth/login', { method: 'POST', body: { identifier: v.identifier, password: v.password } })).user; authed = true; applyUser(); go('app'); }
      catch (err) {
        if (err.code === 'not_verified') { await API('/auth/otp/send', { method: 'POST', body: { identifier: err.details.identifier, purpose: 'register' } }); renderAuth('otp', { purpose: 'register', identifier: err.details.identifier, display: maskId(err.details.identifier) }); toast('Verify your account to continue'); }
        else throw err;
      } finally { busy(b, false, 'Log in'); }
    } else if (f.id === 'fReg') {
      const b = document.getElementById('bReg'); busy(b, true, 'Create account');
      try { const r = await API('/auth/register', { method: 'POST', body: v }); renderAuth('otp', { purpose: 'register', identifier: r.identifier, display: maskId(r.identifier) }); }
      finally { busy(b, false, 'Create account'); }
    } else if (f.id === 'fCode' || f.id === 'fForgot') {
      const purpose = f.id === 'fCode' ? 'login' : 'reset', b = f.querySelector('button.btn'), lbl = b.textContent; busy(b, true, lbl);
      try {
        const norm = await API(purpose === 'login' ? '/auth/otp/send' : '/auth/password/forgot', { method: 'POST', body: { identifier: v.identifier, purpose } });
        const id = normalizeClient(v.identifier); toast(norm.message);
        renderAuth(purpose === 'login' ? 'otp' : 'reset', { purpose, identifier: id, display: maskId(id) });
      } finally { busy(b, false, lbl); }
    }
  } catch (err) { showErrors(err); }
});
// Mirrors the server's normalisation so the OTP screen targets the same identifier.
function normalizeClient(raw) {
  const s = String(raw || '').trim();
  if (s.includes('@')) return s.toLowerCase();
  let d = s.replace(/[\s\-()+]/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); else if (d.length === 11 && d[0] === '0') d = d.slice(1);
  return '91' + d;
}
async function submitReset() {
  const btn = document.getElementById('bReset'); busy(btn, true, 'Reset password');
  try {
    await API('/auth/password/reset', { method: 'POST', body: { identifier: authCtx.identifier, code: otpCode(), password: document.getElementById('newPw').value } });
    toast('Password updated. Please log in.'); renderAuth('login');
  } catch (e) { showErrors(e); }
  busy(btn, false, 'Reset password');
}
