/**
 * JISSR — auth.js
 * Handles credential validations, button loading states, database login pipelines, and Google Sign-in flow.
 */
'use strict';

/* ── FORM VALIDATIONS ──────────────────────────────────────────────────────── */
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

function setFieldState(inputEl, iconId, errorId, valid, message) {
  const icon  = document.getElementById(iconId);
  const error = document.getElementById(errorId);
  inputEl.classList.toggle('valid',   valid);
  inputEl.classList.toggle('invalid', !valid && message !== null);
  if (icon) { icon.className = 'input-icon ' + (valid ? 'valid' : (message ? 'invalid' : '')); }
  if (error) error.textContent = (valid || !message) ? '' : message;
}

function clearFieldState(inputEl, iconId, errorId) {
  if (!inputEl) return;
  inputEl.classList.remove('valid','invalid');
  const icon  = document.getElementById(iconId);
  const error = document.getElementById(errorId);
  if (icon)  icon.className = 'input-icon';
  if (error) error.textContent = '';
}

function validateEmailValue(email) {
  if (!email)                    return 'Email is required';
  if (!EMAIL_RE.test(email))     return 'Enter a valid email address (e.g. you@example.com)';
  return null;
}

function validateNameValue(name) {
  if (!name || name.length < 2)  return 'Name must be at least 2 characters';
  if (!/^[\p{L}\s'-]+$/u.test(name)) return 'Name can only contain letters, spaces, hyphens';
  return null;
}

function validatePasswordValue(password) {
  if (!password)                          return 'Password is required';
  if (password.length < 8)               return 'At least 8 characters required';
  if (!/[A-Z]/.test(password))           return 'Include at least one uppercase letter';
  if (!/[a-z]/.test(password))           return 'Include at least one lowercase letter';
  if (!/[0-9]/.test(password))           return 'Include at least one number';
  return null;
}

function validateConfirmValue(password, confirm) {
  if (!confirm)           return 'Please confirm your password';
  if (confirm !== password) return 'Passwords do not match';
  return null;
}

/* ── PASSWORD STRENGTH METER ────────────────────────────────────────────────── */
function calcPasswordStrength(password) {
  if (!password) return { level: 0, label: '', width: '0%', color: 'transparent' };
  let score = 0;
  if (password.length >= 8)               score++;
  if (password.length >= 12)              score++;
  if (/[A-Z]/.test(password))             score++;
  if (/[a-z]/.test(password))             score++;
  if (/[0-9]/.test(password))             score++;
  if (/[^A-Za-z0-9]/.test(password))      score++;

  const levels = [
    { level:1, label:'Very weak', width:'15%',  color:'#ff4571' },
    { level:2, label:'Weak',      width:'30%',  color:'#ff7043' },
    { level:3, label:'Fair',      width:'50%',  color:'#ffb930' },
    { level:4, label:'Good',      width:'70%',  color:'#60a5fa' },
    { level:5, label:'Strong',    width:'85%',  color:'#00ff9d' },
    { level:6, label:'Excellent', width:'100%', color:'#00ff9d' },
  ];
  const idx = Math.min(score, 6) - 1;
  return idx < 0 ? { level:0, label:'', width:'0%', color:'transparent' } : levels[idx];
}

function updateStrengthBar(password) {
  const wrap  = document.getElementById('pw-strength-wrap');
  const bar   = document.getElementById('pw-strength-bar');
  const label = document.getElementById('reg-pw-strength-label');
  if (!wrap || !bar || !label) return;

  if (!password) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const s = calcPasswordStrength(password);
  bar.style.width = s.width;
  bar.style.background = s.color;
  bar.setAttribute('data-level', s.level);
  label.textContent = s.label;
  label.style.color = s.color;
}

function setBtnLoading(btnEl, loading) {
  if (!btnEl) return;
  if (loading) btnEl.classList.add('loading');
  else         btnEl.classList.remove('loading');
  btnEl.disabled = loading;
}

/* ── APP INITIAL ENTRY ───────────────────────────────────────────────────────── */
function enterAppOffline(msg) {
  fetch(`${API}/auth/guest`, { method: 'POST' })
    .then(r => r.ok ? r.json() : { success: false })
    .then(d => { if (d.success) { saveAuthToken(d.token, d.user); } })
    .catch(() => {});
  enterApp(msg || '👋 Welcome!');
}

function enterApp(msg) {
  if (msg) showToast(msg);
  updateHeaderUser(state.user);
  navigateTo('s2s');
  loadELSettings();
  loadSettingsFromDB();
  initCamera();
  checkServer();
  if (!state.healthInterval) state.healthInterval = setInterval(checkServer, 30000);
}

async function doLogout() {
  if(state.authToken){
    try{await fetch(`${API}/auth/logout`,{method:'POST',headers:authHeader()});}catch(_){}
  }
  if(videoEl?.srcObject){
    videoEl.srcObject.getTracks().forEach(t=>t.stop());
    videoEl.srcObject=null;
  }
  state.cameraReady=false;
  if(state.healthInterval){clearInterval(state.healthInterval);state.healthInterval=null;}
  clearAuth();
  showToast('👋 Signed out');
  setTimeout(()=>navigateTo('landing'), 200);
}

/* ── AUTH HANDLERS ──────────────────────────────────────────────────────────── */
function wireAuthListeners() {
  LOGIN_FORM?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateLoginForm()) return;
    const email = document.getElementById('email-input').value.trim();
    const pass  = PASSWORD_INPUT.value;
    setBtnLoading(LOGIN_BTN, true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, password: pass }),
      });
      const d = await r.json();
      if (d.success) {
        saveAuthToken(d.token, d.user);
        enterApp(`✅ Welcome back, ${d.user.name}!`);
      } else {
        showToast('⚠️ ' + (d.error || 'Login failed'));
        const pwEl = document.getElementById('password-input');
        if (pwEl) setFieldState(pwEl, null, 'login-pw-error', false, d.error || 'Invalid credentials');
      }
    } catch { showToast('⚠️ Connection error'); }
    setBtnLoading(LOGIN_BTN, false);
  });

  REGISTER_FORM?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateRegisterForm()) return;
    const name  = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass  = document.getElementById('reg-password').value;
    setBtnLoading(REGISTER_BTN, true);
    try {
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, email, password: pass }),
      });
      const d = await r.json();
      if (d.success) {
        saveAuthToken(d.token, d.user);
        enterApp(`🎉 Welcome, ${d.user.name}!`);
      } else {
        showToast('⚠️ ' + (d.error || 'Registration failed'));
        const emailEl = document.getElementById('reg-email');
        if (emailEl) setFieldState(emailEl, 'reg-email-icon', 'reg-email-error', false, d.error || 'Registration failed');
      }
    } catch { showToast('⚠️ Connection error'); }
    setBtnLoading(REGISTER_BTN, false);
  });

  GUEST_BTN?.addEventListener('click', async () => {
    GUEST_BTN.disabled = true;
    try {
      const r = await fetch(`${API}/auth/guest`, { method: 'POST' });
      const d = await r.json();
      if (d.success) { saveAuthToken(d.token, d.user); enterApp('👋 Welcome, Guest!'); }
      else enterAppOffline();
    } catch { enterAppOffline(); }
    GUEST_BTN.disabled = false;
  });

  LOGOUT_BTN?.addEventListener('click', doLogout);
  document.getElementById('header-logout-btn')?.addEventListener('click', doLogout);
}

/* ── FORM VALIDATORS PASS ───────────────────────────────────────────────────── */
function validateRegisterForm() {
  const nameEl    = document.getElementById('reg-name');
  const emailEl   = document.getElementById('reg-email');
  const pwEl      = document.getElementById('reg-password');
  const confirmEl = document.getElementById('reg-confirm-password');

  const nameErr    = validateNameValue(nameEl?.value.trim() || '');
  const emailErr   = validateEmailValue(emailEl?.value.trim() || '');
  const pwErr      = validatePasswordValue(pwEl?.value || '');
  const confirmErr = validateConfirmValue(pwEl?.value || '', confirmEl?.value || '');

  if (nameEl)    setFieldState(nameEl,    'reg-name-icon',    'reg-name-error',    !nameErr,    nameErr);
  if (emailEl)   setFieldState(emailEl,   'reg-email-icon',   'reg-email-error',   !emailErr,   emailErr);
  if (pwEl)      setFieldState(pwEl,      null,               'reg-pw-error',      !pwErr,      pwErr);
  if (confirmEl) setFieldState(confirmEl, 'reg-confirm-icon', 'reg-confirm-error', !confirmErr, confirmErr);

  const firstInvalid = [nameEl, emailEl, pwEl, confirmEl].find(el => el?.classList.contains('invalid'));
  firstInvalid?.focus();

  return !nameErr && !emailErr && !pwErr && !confirmErr;
}

function validateLoginForm() {
  const emailEl = document.getElementById('email-input');
  const pwEl    = document.getElementById('password-input');

  const emailErr = validateEmailValue(emailEl?.value.trim() || '');
  const pwErr    = !pwEl?.value ? 'Password is required' : null;

  if (emailEl) setFieldState(emailEl, 'email-icon', 'email-error', !emailErr, emailErr);
  if (pwEl)    setFieldState(pwEl,    null,          'login-pw-error', !pwErr,   pwErr);

  if (emailErr) emailEl?.focus();
  else if (pwErr) pwEl?.focus();

  return !emailErr && !pwErr;
}

/* ── GOOGLE SIGN-IN pipeline ─────────────────────────────────────────────────── */
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

window.onGoogleLibraryLoad = function () {
  if (typeof google === 'undefined') return;
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback:  handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
    });
    console.log('[Google] Identity Services ready');
  } catch (e) {
    console.warn('[Google] GIS init failed:', e.message);
  }
};

function decodeJwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  } catch { return null; }
}

async function handleGoogleCredentialResponse(response) {
  const idToken = response.credential;
  const payload = decodeJwtPayload(idToken);
  if (!payload) { showToast('⚠️ Could not decode Google token'); return; }

  const name    = payload.name    || 'Google User';
  const email   = payload.email   || '';
  const picture = payload.picture || '';

  showToast(`🔄 Signing in as ${name}…`);

  try {
    const r = await fetch(`${API}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken, name, email, picture }),
    });
    const d = await r.json();
    if (d.success) {
      saveAuthToken(d.token, d.user);
      if (picture) {
        const av = document.getElementById('header-avatar');
        if (av) {
          const img = document.createElement('img');
          img.src = picture; img.alt = name;
          img.style.cssText = 'width:24px;height:24px;border-radius:50%;object-fit:cover;';
          av.replaceWith(img);
        }
      }
      enterApp(`✅ Welcome, ${d.user.name}!`);
    } else {
      showToast(`✅ Signed in as ${name} (guest session)`);
      saveAuthToken(null, { id: 0, name, email, is_guest: 0 });
      enterApp(null);
    }
  } catch (err) {
    console.error('[Google auth]', err);
    showToast('⚠️ Google sign-in failed — continuing as guest');
    GUEST_BTN?.click();
  }
}

function triggerGoogleSignIn() {
  const configured = (typeof google !== 'undefined')
    && GOOGLE_CLIENT_ID
    && GOOGLE_CLIENT_ID !== 'YOUR_CLIENT_ID.apps.googleusercontent.com'
    && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

  if (configured) {
    try {
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          google.accounts.id.renderButton(
            document.getElementById('google-btn'),
            { theme: 'outline', size: 'large', text: 'continue_with', width: 300 }
          );
          showToast('ℹ️ Click the Google button to sign in');
        }
      });
    } catch (e) {
      showToast('⚠️ Google popup blocked — falling back to guest session');
      GUEST_BTN?.click();
    }
    return;
  }
  console.info('[JISSR] Google Client ID not configured — using guest session as fallback.');
  showToast('🔄 Google sign-in not configured — starting guest session…');
  GUEST_BTN?.click();
}
