/**
 * JISSR - script.js  (v3.0 - Glassmorphism + SQLite Edition)
 * Auth (register/login/guest), history persistence, settings sync to DB.
 */
'use strict';

const API = window.location.origin;

/* ─────────────────────────────────────────────────────────
   DOM REFS
───────────────────────────────────────────────────────── */
const HTML           = document.documentElement;
const APP_HEADER     = document.getElementById('app-header');
const BOTTOM_NAV     = document.getElementById('bottom-nav');
const PAGE_HEADING   = document.getElementById('page-heading');
const TOAST          = document.getElementById('toast');

const PAGES = {
  landing:  document.getElementById('landing-page'),
  login:    document.getElementById('login-page'),
  s2s:      document.getElementById('sign-to-speech-page'),
  sp2s:     document.getElementById('speech-to-sign-page'),
  settings: document.getElementById('settings-page'),
  history:  document.getElementById('history-page'),
};
const PUBLIC_PAGES   = new Set(['landing','login']);
const APP_NAV        = document.getElementById('app-nav');
const APP_NAV_LINKS  = document.querySelectorAll('.app-nav-link');
const HEADER_USER    = document.getElementById('header-user');
const HEADER_PUBLIC  = document.getElementById('header-public');
const HEADER_LOGOUT  = document.getElementById('header-logout-btn');
const VOICE_BTN      = document.getElementById('voice-settings-btn');
const SRV_STATUS     = document.getElementById('srvStatus');
const MENU_TOGGLE    = document.getElementById('menu-toggle');
const MOBILE_DRAWER  = document.getElementById('mobile-nav-drawer');

const NAV_ITEMS      = document.querySelectorAll('.nav-item');
const LOGIN_FORM     = document.getElementById('login-form');
const REGISTER_FORM  = document.getElementById('register-form');
const LOGIN_BTN      = document.getElementById('login-btn');
const REGISTER_BTN   = document.getElementById('register-btn');
const GUEST_BTN      = document.getElementById('guest-btn');
const GOOGLE_BTN     = document.getElementById('google-btn');
const APPLE_BTN      = document.getElementById('apple-btn');
const TOGGLE_PWD_BTN = document.getElementById('toggle-password');
const TOGGLE_REG_PWD = document.getElementById('toggle-reg-password');
const PASSWORD_INPUT = document.getElementById('password-input');
const HEADER_THEME_BTN = document.getElementById('header-theme-btn');

const RECORD_BTN    = document.getElementById('record-btn');
const RECORD_LABEL  = document.getElementById('record-label');
const REC_BADGE     = document.getElementById('rec-badge');
const REC_TIMER     = document.getElementById('rec-timer');
const VIEWFINDER    = document.getElementById('viewfinder');
const TL_TEXT       = document.getElementById('tl-text');
const PLAY_BTN      = document.getElementById('play-btn');
const PLAY_ICON     = document.getElementById('play-icon');
const PLAY_LABEL    = document.getElementById('play-label');
const PLAY_WAVEFORM = document.getElementById('play-waveform');
const AUTO_SPEAK    = document.getElementById('auto-speak');
const LIVE_IND      = document.getElementById('live-indicator');
const FLIP_BTN      = document.getElementById('flip-btn');
const videoEl       = document.getElementById('videoEl');
const canvasEl      = document.getElementById('canvasEl');

const TAB_MIC       = document.getElementById('tab-mic');
const TAB_KBD       = document.getElementById('tab-kbd');
const PANEL_MIC     = document.getElementById('tabpanel-mic');
const PANEL_KBD     = document.getElementById('tabpanel-kbd');
const MIC_BTN       = document.getElementById('mic-btn');
const MIC_STATUS    = document.getElementById('mic-status');
const WAVEFORM      = document.getElementById('waveform');
const HEARD_TEXT    = document.getElementById('heard-text');
const AVATAR_FIG    = document.getElementById('avatar-figure');
const AV_STATUS     = document.getElementById('avatar-status');
const AV_STATUS_TXT = document.getElementById('av-status-text');
const AV_HEAD       = document.getElementById('av-head');
const SPEED_PILLS   = document.querySelectorAll('.speed-pill');

const THEME_SEG     = document.getElementById('theme-seg');
const ACCENT_PICKER = document.getElementById('accent-picker');
const TEXT_SIZE_SL  = document.getElementById('text-size-sl');
const TS_OUT        = document.getElementById('ts-out');
const HAPTIC_TOG    = document.getElementById('haptic-tog');
const CUES_TOG      = document.getElementById('cues-tog');
const CONTRAST_TOG  = document.getElementById('contrast-tog');
const CAM_QUAL_SEL  = document.getElementById('cam-qual-sel');
const LOGOUT_BTN    = document.getElementById('logout-btn');

/* ─────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────── */
const state = {
  currentPage:    'landing',
  theme:          'light',
  elServer:       false,   // true when a server-side ElevenLabs key is configured
  accentColor:    '#C8102E',
  textSize:       18,
  hapticOn:       true,
  visualCuesOn:   true,
  highContrast:   false,

  // Auth
  user:           null,
  authToken:      null,

  // Camera / inference
  cameraReady:    false,
  isRecording:    false,
  recordSeconds:  0,
  recordInterval: null,
  rolling:        [],
  frameCount:     0,
  inferPending:   false,
  lastPredTime:   0,
  currentResult:  null,
  liveHistory:    [],
  healthInterval: null,

  // Audio
  isPlaying:      false,
  isAutoSpeak:    false,

  // STT / Avatar
  mediaRec:       null,
  recChunks:      [],
  isMicRecording: false,
  sttText:        '',
  avPlaying:      false,
  avCurrentIdx:   0,
  avQueue:        [],
  playbackSpeed:  1,

  // History page
  histFilter:     'all',
};

// Skeleton connection tables
const HAND_CONN = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];
const BODY_CONN_133 = [[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
const LH_OFF_133=91, RH_OFF_133=112;
const BODY_CONN_543 = [[11,13],[13,15],[12,14],[14,16],[11,12],[23,24],[11,23],[12,24],[23,25],[24,26],[25,27],[26,28]];
const POSE_OFF_543=468, LH_OFF_543=501, RH_OFF_543=522;

const PAGE_TITLES = { s2s:'Sign to Speech', sp2s:'Speech to Sign', settings:'Settings', history:'History' };
const SAMPLE_TL = ['Hello, how are you?','My name is…','Can you help me?','Thank you so much.','Where is the exit?','I need a doctor.'];
let simIdx = 0;

/* ─────────────────────────────────────────────────────────
   AUTH HELPERS
───────────────────────────────────────────────────────── */
function authHeader() {
  return state.authToken ? { 'Authorization': 'Bearer ' + state.authToken } : {};
}

function saveAuthToken(token, user) {
  state.authToken = token;
  state.user = user;
  try { localStorage.setItem('jissr-token', token); localStorage.setItem('jissr-user', JSON.stringify(user)); } catch(_) {}
  updateHeaderUser(user);
}

function clearAuth() {
  state.authToken = null; state.user = null;
  try { localStorage.removeItem('jissr-token'); localStorage.removeItem('jissr-user'); } catch(_) {}
  updateHeaderUser(null);
}

function updateHeaderUser(user) {
  const el = document.getElementById('header-user');
  const av = document.getElementById('header-avatar');
  const nm = document.getElementById('header-username');
  if (!el) return;
  if (user) {
    el.hidden = false;
    const initial = (user.name || 'U').charAt(0).toUpperCase();
    if (av) av.textContent = initial;
    if (nm) nm.textContent = user.is_guest ? 'Guest' : (user.name || 'User');
  } else {
    el.hidden = true;
  }
}

function loadStoredAuth() {
  try {
    const token = localStorage.getItem('jissr-token');
    const user  = JSON.parse(localStorage.getItem('jissr-user') || 'null');
    if (token && user) { state.authToken = token; state.user = user; return true; }
  } catch(_) {}
  return false;
}

/* ─────────────────────────────────────────────────────────
   AUTH UI - login/register tabs
───────────────────────────────────────────────────────── */
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    const panel = document.getElementById('auth-panel-' + tab.dataset.auth);
    if (panel) panel.classList.add('active');
  });
});

TOGGLE_PWD_BTN?.addEventListener('click', () => {
  const show = PASSWORD_INPUT.type === 'password';
  PASSWORD_INPUT.type = show ? 'text' : 'password';
  TOGGLE_PWD_BTN.textContent = show ? '🙈' : '👁';
});
TOGGLE_REG_PWD?.addEventListener('click', () => {
  const p = document.getElementById('reg-password');
  if (!p) return;
  const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  TOGGLE_REG_PWD.textContent = show ? '🙈' : '👁';
});

/* ─────────────────────────────────────────────────────────
   SERVER HEALTH
───────────────────────────────────────────────────────── */
async function checkServer() {
  try {
    const d = await (await fetch(`${API}/health`)).json();
    const dot = document.getElementById('srvDot');
    const lbl = document.getElementById('srvLbl');
    const wc  = document.getElementById('avWordCount');
    if (dot) dot.style.cssText = 'background:#10b981;width:7px;height:7px;border-radius:50%;display:inline-block;box-shadow:0 0 6px rgba(16,185,129,.5);';
    if (lbl) lbl.textContent = `${d.num_classes} signs · ${d.device}`;
    if (wc)  wc.textContent  = String(d.avatar_signs);
  } catch {
    const dot = document.getElementById('srvDot');
    const lbl = document.getElementById('srvLbl');
    if (dot) dot.style.background = '#ff4060';
    if (lbl) lbl.textContent = 'Server offline';
  }
}

/* ─────────────────────────────────────────────────────────
   SPA NAVIGATION
───────────────────────────────────────────────────────── */
function navigateTo(key) {
  if (!PAGES[key]) return;
  // Strict auth gate: any non-public page requires a valid session token
  if (!PUBLIC_PAGES.has(key) && !state.authToken) {
    navigateTo('landing');
    return;
  }
  Object.values(PAGES).forEach(p => p && p.classList.remove('active'));
  PAGES[key].classList.add('active');
  state.currentPage = key;

  // Header state
  if (APP_HEADER) APP_HEADER.hidden = false;
  const onPublic = PUBLIC_PAGES.has(key);
  if (APP_NAV)       APP_NAV.hidden = onPublic;
  if (HEADER_USER)   HEADER_USER.hidden = onPublic || !state.user;
  if (HEADER_PUBLIC) HEADER_PUBLIC.style.display = onPublic ? 'flex' : 'none';
  if (HEADER_LOGOUT) HEADER_LOGOUT.hidden = onPublic || !state.user;
  if (VOICE_BTN)     VOICE_BTN.hidden     = onPublic || !state.user;
  if (SRV_STATUS)    SRV_STATUS.hidden = onPublic;
  if (BOTTOM_NAV)    BOTTOM_NAV.hidden = true; // bottom nav permanently retired
  if (PAGE_HEADING)  PAGE_HEADING.textContent = PAGE_TITLES[key] || 'JISSR';

  // Close mobile drawer on navigate
  if (MOBILE_DRAWER) MOBILE_DRAWER.classList.remove('open');
  if (MENU_TOGGLE)   MENU_TOGGLE.setAttribute('aria-expanded', 'false');

  updateNavActive(key);
  PAGES[key].scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (key !== 's2s'  && state.isRecording)   stopRecording();
  if (key !== 'sp2s' && state.isMicRecording) stopMicSTT();
  if (key === 'history') loadHistoryPage();
}

function updateNavActive(activeKey) {
  const map = { s2s:'sign-to-speech-page', sp2s:'speech-to-sign-page', settings:'settings-page', history:'history-page' };
  const targetId = map[activeKey];
  if (NAV_ITEMS) NAV_ITEMS.forEach(item => item.setAttribute('aria-current', item.dataset.target === targetId ? 'true' : 'false'));
  if (APP_NAV_LINKS) APP_NAV_LINKS.forEach(a => a.setAttribute('aria-current', a.dataset.target === targetId ? 'true' : 'false'));
}

// Legacy bottom-nav items (kept hidden but still functional if shown)
NAV_ITEMS.forEach(item => item.addEventListener('click', () => {
  const key = Object.keys(PAGES).find(k => PAGES[k]?.id === item.dataset.target);
  if (key) navigateTo(key);
}));

// New top-nav links
APP_NAV_LINKS.forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  const key = Object.keys(PAGES).find(k => PAGES[k]?.id === a.dataset.target);
  if (key) navigateTo(key);
}));

// Footer in-app links
document.querySelectorAll('.app-footer a[data-target]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const key = Object.keys(PAGES).find(k => PAGES[k]?.id === a.dataset.target);
    if (key) navigateTo(key);
  });
});

// Brand link → landing if public, sign-to-speech if authenticated
document.getElementById('brand-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  navigateTo(state.authToken ? 's2s' : 'landing');
});

// Mobile menu toggle - clones nav into drawer
MENU_TOGGLE?.addEventListener('click', () => {
  if (!MOBILE_DRAWER) return;
  const open = MOBILE_DRAWER.classList.toggle('open');
  MENU_TOGGLE.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && MOBILE_DRAWER.childElementCount === 0 && APP_NAV) {
    MOBILE_DRAWER.innerHTML = APP_NAV.innerHTML;
    MOBILE_DRAWER.querySelectorAll('.app-nav-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const key = Object.keys(PAGES).find(k => PAGES[k]?.id === a.dataset.target);
        if (key) navigateTo(key);
      });
    });
  }
});

// Landing / header public CTAs → open login page on the right tab
function openAuth(tab) {
  navigateTo('login');
  setTimeout(() => {
    const btn = document.getElementById('tab-' + tab);
    if (btn) btn.click();
    const focusId = tab === 'register' ? 'reg-name' : 'email-input';
    document.getElementById(focusId)?.focus();
  }, 50);
}
['landing-register-btn','cta-register-btn','header-register-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => openAuth('register')));
['landing-signin-btn','cta-signin-btn','header-signin-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => openAuth('login')));

// Boot to the public landing, or straight to the sign-in panel when the URL is
// /#login (used by the password pages' "Back to sign in" links).
function goPublicStart() {
  const h = (location.hash || '').toLowerCase();
  if (h === '#login' || h === '#signin') openAuth('login');
  else navigateTo('landing');
}

// Confirm-password eye toggle (new - wasn't wired before)
document.getElementById('toggle-reg-confirm')?.addEventListener('click', () => {
  const p = document.getElementById('reg-confirm-password');
  if (!p) return;
  p.type = p.type === 'password' ? 'text' : 'password';
});

// Logout button in header
HEADER_LOGOUT?.addEventListener('click', async () => {
  try { await fetch(`${API}/auth/logout`, { method: 'POST', headers: authHeader() }); } catch(_) {}
  clearAuth();
  showToast('👋 Signed out');
  navigateTo('landing');
});

HEADER_THEME_BTN?.addEventListener('click', toggleTheme);

/* ─────────────────────────────────────────────────────────
   LOGIN / REGISTER / GUEST
───────────────────────────────────────────────────────── */
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
      // Show error on password field
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

// Google & Apple sign-in handlers are wired in the Google Sign-In section below

function enterAppOffline(msg) {
  // Social logins fall back to guest session
  fetch(`${API}/auth/guest`, { method: 'POST' })
    .then(r => r.json())
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

/* ─────────────────────────────────────────────────────────
   SETTINGS from DB
───────────────────────────────────────────────────────── */
async function loadSettingsFromDB() {
  if (!state.authToken) return;
  try {
    const r = await fetch(`${API}/settings`, { headers: authHeader() });
    const d = await r.json();
    if (!d.success) return;
    const s = d.settings;
    if (s.theme)         applyTheme(s.theme);
    if (s.accent_color)  { applyAccentColor(s.accent_color); ACCENT_PICKER?.querySelectorAll('.accent-swatch').forEach(sw => { const on = sw.dataset.color === s.accent_color; sw.classList.toggle('active', on); sw.setAttribute('aria-pressed', on); }); }
    if (s.text_size && TEXT_SIZE_SL) { TEXT_SIZE_SL.value = s.text_size; if (TS_OUT) TS_OUT.textContent = s.text_size + 'px'; HTML.style.setProperty('--tl-font-size', s.text_size + 'px'); const pct=((s.text_size-14)/(28-14))*100; TEXT_SIZE_SL.style.backgroundSize = pct + '% 100%'; }
    if (HAPTIC_TOG)   HAPTIC_TOG.checked   = !!s.haptic_feedback;
    if (CUES_TOG)     CUES_TOG.checked     = !!s.visual_cues;
    if (CONTRAST_TOG) CONTRAST_TOG.checked = !!s.high_contrast;
    if (s.high_contrast) HTML.setAttribute('data-high-contrast', 'true');
    if (s.camera_quality && CAM_QUAL_SEL) CAM_QUAL_SEL.value = s.camera_quality;
    if (s.el_api_key) { const el = document.getElementById('elApiKey'); if (el) el.value = s.el_api_key; }
    if (s.el_voice_id) { const sel = document.getElementById('elVoiceId'); if (sel) sel.value = s.el_voice_id; }
    if (s.el_model)   { const el = document.getElementById('elModel'); if (el) el.value = s.el_model; }
  } catch(_) {}
}

async function saveSettingsToDB(updates) {
  if (!state.authToken) return;
  try {
    await fetch(`${API}/settings`, {
      method: 'POST', headers: {'Content-Type':'application/json', ...authHeader()},
      body: JSON.stringify(updates),
    });
  } catch(_) {}
}

/* ─────────────────────────────────────────────────────────
   HISTORY - save to DB + load history page
───────────────────────────────────────────────────────── */
async function saveTranslation(type, inputText, outputText, confidence) {
  if (!state.authToken) return;
  try {
    await fetch(`${API}/history`, {
      method: 'POST',
      headers: {'Content-Type':'application/json', ...authHeader()},
      body: JSON.stringify({ type, input_text: inputText, output_text: outputText, confidence }),
    });
  } catch(_) {}
}

async function loadHistoryPage() {
  if (!state.authToken) {
    showEmptyHistory('Sign in to see your history across sessions');
    return;
  }

  // Load analytics for stats
  try {
    const ar = await fetch(`${API}/analytics`, { headers: authHeader() });
    const ad = await ar.json();
    if (ad.success) {
      const a = ad.analytics;
      const total  = document.getElementById('hist-total');
      const s2s    = document.getElementById('hist-s2s-count');
      const sp2s   = document.getElementById('hist-sp2s-count');
      if (total) total.textContent = a.total;
      if (s2s)   s2s.textContent   = a.s2s_count;
      if (sp2s)  sp2s.textContent  = a.sp2s_count;
    }
  } catch(_) {}

  // Load list
  const filter = state.histFilter;
  try {
    const r = await fetch(`${API}/history?type=${filter}&limit=100`, { headers: authHeader() });
    const d = await r.json();
    if (d.success) renderHistoryList(d.history);
  } catch(_) { showEmptyHistory('Could not load history'); }
}

function renderHistoryList(items) {
  const list  = document.getElementById('hist-list');
  const empty = document.getElementById('hist-empty');
  if (!list) return;
  if (!items.length) { showEmptyHistory(); return; }
  if (empty) empty.style.display = 'none';
  const existing = list.querySelectorAll('.hist-item');
  existing.forEach(el => el.remove());

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'hist-item';
    el.dataset.id = item.id;

    const badge = document.createElement('div');
    badge.className = 'hist-type-badge ' + item.type;
    badge.textContent = item.type === 's2s' ? '🤟' : '🔊';

    const content = document.createElement('div');
    content.className = 'hist-content';
    const output = document.createElement('div'); output.className = 'hist-output'; output.textContent = item.output_text || '-';
    const input  = document.createElement('div'); input.className  = 'hist-input';  input.textContent  = item.input_text  ? 'Input: ' + item.input_text : '';
    content.append(output, input);

    const meta = document.createElement('div'); meta.className = 'hist-meta';
    const dt = new Date(item.created_at + ' UTC');
    const timeStr = isNaN(dt) ? item.created_at : dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const dateStr = isNaN(dt) ? '' : dt.toLocaleDateString([], {month:'short', day:'numeric'});
    const timeEl = document.createElement('span'); timeEl.className = 'hist-time'; timeEl.textContent = dateStr + ' ' + timeStr;
    meta.append(timeEl);

    const delBtn = document.createElement('button');
    delBtn.className = 'hist-del-btn'; delBtn.title = 'Delete'; delBtn.textContent = '×';
    delBtn.addEventListener('click', async ev => {
      ev.stopPropagation();
      try { await fetch(`${API}/history/${item.id}`, { method: 'DELETE', headers: authHeader() }); } catch(_) {}
      el.remove();
      loadHistoryPage();
    });

    el.append(badge, content, meta, delBtn);
    el.addEventListener('click', () => speak(item.output_text, /[؀-ۿ]/.test(item.output_text) ? 'ar' : 'en'));
    list.appendChild(el);
  });
}

function showEmptyHistory(msg) {
  const list  = document.getElementById('hist-list');
  const empty = document.getElementById('hist-empty');
  if (!list || !empty) return;
  list.querySelectorAll('.hist-item').forEach(el => el.remove());
  empty.style.display = 'flex';
  const p = empty.querySelectorAll('p');
  if (msg && p[0]) p[0].textContent = msg;
}

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.histFilter = btn.dataset.filter;
    loadHistoryPage();
  });
});

document.getElementById('hist-clear-btn')?.addEventListener('click', async () => {
  if (!state.authToken) { showToast('⚠️ Sign in to clear history'); return; }
  try { await fetch(`${API}/history/clear`, { method: 'DELETE', headers: authHeader() }); } catch(_) {}
  loadHistoryPage();
  showToast('🗑 History cleared');
});

/* ─────────────────────────────────────────────────────────
   PAGE 2: SIGN TO SPEECH
───────────────────────────────────────────────────────── */
function initCamera() {
  if (state.cameraReady || !videoEl) return;
  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then(stream => {
      videoEl.srcObject = stream;
      videoEl.removeAttribute('src');
      videoEl.load(); videoEl.play();
      VIEWFINDER.classList.add('camera-active');
      state.cameraReady = true;
      const badge = document.getElementById('camBadge');
      if (badge) badge.textContent = 'Live · RTMPose';
      startFrameCapture();
    })
    .catch(e => {
      const badge = document.getElementById('camBadge');
      if (badge) badge.textContent = 'Camera: ' + e.message;
      showToast('⚠️ Camera unavailable - simulation mode active');
    });
}

function startFrameCapture() {
  setInterval(() => {
    if (!state.cameraReady || !videoEl || videoEl.readyState < 2) return;
    const tmp = document.createElement('canvas');
    tmp.width  = videoEl.videoWidth  || 640;
    tmp.height = videoEl.videoHeight || 480;
    const captureCtx = tmp.getContext('2d');
    captureCtx.drawImage(videoEl, 0, 0);
    state.rolling.push(tmp.toDataURL('image/jpeg', 0.75));
    if (state.rolling.length > 30) state.rolling.shift();
    state.frameCount++;
    if (state.isRecording && state.rolling.length >= 30 && state.frameCount % 15 === 0 && !state.inferPending) {
      runLiveInfer([...state.rolling]);
    }
  }, 100);

  let prevW = 0, prevH = 0;
  setInterval(() => {
    if (!videoEl || !canvasEl) return;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (vw && vh && (vw !== prevW || vh !== prevH)) { canvasEl.width = vw; canvasEl.height = vh; prevW = vw; prevH = vh; }
  }, 500);
}

async function runLiveInfer(frames) {
  state.inferPending = true;
  flashRing();
  try {
    const r = await fetch(`${API}/predict`, {
      method: 'POST', headers: {'Content-Type':'application/json', ...authHeader()},
      body: JSON.stringify({ frames }),
    });
    const d = await r.json();
    if (d.success) showResult(d.predictions);
  } catch (e) { console.warn('[predict]', e.message); }
  state.inferPending = false;
}

function flashRing() {
  const r = document.getElementById('inferRing');
  if (!r) return;
  r.style.opacity = '1'; r.style.transform = 'scale(1.4)';
  setTimeout(() => { r.style.opacity = '0'; r.style.transform = 'scale(1)'; }, 500);
}

function showResult(preds) {
  if (!preds?.length) return;
  const top = preds[0];
  if (state.currentResult?.arabic === top.arabic && Date.now() - state.lastPredTime < 3000) return;
  state.currentResult = top; state.lastPredTime = Date.now();

  TL_TEXT.classList.add('updating');
  setTimeout(() => { TL_TEXT.textContent = top.arabic || top.english || '-'; TL_TEXT.classList.remove('updating'); }, 200);

  const nameEl = document.getElementById('op-top-name');
  const enEl   = document.getElementById('op-top-en');
  const dotEl  = document.getElementById('op-dot');
  if (nameEl) { nameEl.textContent = top.arabic || '-'; nameEl.classList.remove('pop'); void nameEl.offsetWidth; nameEl.classList.add('pop'); }
  if (enEl)   enEl.textContent = top.english || '';
  if (dotEl)  { dotEl.classList.add('live'); setTimeout(() => dotEl.classList.remove('live'), 3000); }

  LIVE_IND.classList.add('active');
  setTimeout(() => LIVE_IND.classList.remove('active'), 2000);

  renderTop5Panel(preds);

  state.liveHistory.unshift({ ...top, time: new Date() });
  if (state.liveHistory.length > 30) state.liveHistory.pop();
  renderHistPanel();

  // Save to DB
  saveTranslation('s2s', '', top.arabic || top.english || '', top.confidence || 0);

  if (state.isAutoSpeak) {
    autoSpeakNow(top.arabic || top.english, /[؀-ۿ]/.test(top.arabic || '') ? 'ar' : 'en');
  }
}

function renderTop5Panel(preds) {
  const container = document.getElementById('op-top5');
  if (!container) return;
  container.innerHTML = '';
  preds.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'op-t5-row' + (i === 0 ? ' best' : '');
    row.dataset.arabic  = p.arabic  || '';
    row.dataset.english = p.english || '';

    const rank = document.createElement('span');
    rank.className = 'op-t5-rank' + (i === 0 ? ' gold' : '');
    rank.textContent = '#' + (p.rank || i + 1);

    const words = document.createElement('div'); words.className = 'op-t5-words';
    const name  = document.createElement('div'); name.className  = 'op-t5-name'; name.textContent = p.arabic  || '-';
    const en    = document.createElement('div'); en.className    = 'op-t5-en';   en.textContent   = p.english || '';
    words.append(name, en);

    const spk = document.createElement('button');
    spk.className = 'op-t5-spk'; spk.textContent = '🔊';
    spk.setAttribute('aria-label', `Speak: ${p.arabic || p.english}`);
    spk.addEventListener('click', ev => { ev.stopPropagation(); speak(row.dataset.arabic || row.dataset.english, 'ar'); });
    row.append(rank, words, spk);
    row.addEventListener('click', () => speak(row.dataset.arabic || row.dataset.english, 'ar'));
    container.appendChild(row);
  });
}

function renderHistPanel() {
  const list  = document.getElementById('op-hist-list');
  const empty = document.getElementById('op-hist-empty');
  if (!list) return;
  if (!state.liveHistory.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  list.innerHTML = '';
  state.liveHistory.forEach(h => {
    const t  = h.time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const el = document.createElement('div');
    el.className = 'op-hi-row'; el.dataset.arabic = h.arabic || '';
    const words = document.createElement('div'); words.style.flex = '1'; words.style.minWidth = '0';
    const name  = document.createElement('div'); name.className = 'op-hi-name'; name.textContent = h.arabic || '-';
    const en    = document.createElement('div'); en.className   = 'op-hi-en';   en.textContent   = h.english || '';
    words.append(name, en);
    const meta = document.createElement('div'); meta.className = 'op-hi-meta';
    const tm   = document.createElement('div'); tm.textContent = t;
    meta.append(tm);
    el.append(words, meta);
    el.addEventListener('click', () => speak(el.dataset.arabic, 'ar'));
    list.appendChild(el);
  });
}

function clearOutputHistory() {
  state.liveHistory = [];
  const empty = document.getElementById('op-hist-empty');
  const list  = document.getElementById('op-hist-list');
  if (empty) { empty.style.display = ''; }
  if (list)  { list.innerHTML = ''; if (empty) list.appendChild(empty); }
  showToast('🗑 History cleared');
}

/* Auto-speak */
function setAutoSpeakStatus(msg, cls = '') {
  const el = document.getElementById('autospeak-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'op-autospeak-status' + (cls ? ' ' + cls : '');
}

async function autoSpeakNow(text, lang) {
  if (!text) return;
  const apiKey = document.getElementById('elApiKey')?.value.trim();
  if (apiKey) {
    setAutoSpeakStatus('🔊 Speaking via ElevenLabs…', 'speaking');
    try {
      const r = await fetch(`${API}/tts-elevenlabs`, {
        method:'POST', headers:{'Content-Type':'application/json', ...authHeader()},
        body: JSON.stringify({ text, api_key:apiKey, voice_id:getVoiceId(), model_id:document.getElementById('elModel')?.value||'eleven_multilingual_v2' }),
      });
      if (r.ok) { new Audio(URL.createObjectURL(await r.blob())).play(); setAutoSpeakStatus('✓ ElevenLabs','speaking'); setTimeout(()=>setAutoSpeakStatus(''),2500); return; }
      throw new Error('ElevenLabs ' + r.status);
    } catch { setAutoSpeakStatus('ElevenLabs failed - trying fallback…','error'); }
  } else {
    setAutoSpeakStatus('ℹ️ Add ElevenLabs API Key for natural voice','');
  }
  try {
    const r = await fetch(`${API}/tts`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text,lang})});
    if (r.ok) { new Audio(URL.createObjectURL(await r.blob())).play(); setAutoSpeakStatus('✓ gTTS fallback',''); setTimeout(()=>setAutoSpeakStatus(''),2000); return; }
  } catch(_) {}
  speakWebSpeech(text,lang); setAutoSpeakStatus('✓ Browser TTS',''); setTimeout(()=>setAutoSpeakStatus(''),2000);
}

const renderTop5 = renderTop5Panel;
const renderHist = renderHistPanel;
const clearHist  = clearOutputHistory;

RECORD_BTN.addEventListener('click', () => { if (state.isRecording) stopRecording(); else startRecording(); });

function startRecording() {
  state.isRecording=true; state.recordSeconds=0;
  RECORD_BTN.setAttribute('aria-pressed','true'); RECORD_BTN.setAttribute('aria-label','Stop recording');
  RECORD_LABEL.textContent='Stop'; REC_BADGE.hidden=false; REC_TIMER.textContent='00:00';
  VIEWFINDER.classList.add('recording'); LIVE_IND.classList.add('active');
  if (state.hapticOn && navigator.vibrate) navigator.vibrate([100]);
  state.recordInterval = setInterval(()=>{ state.recordSeconds++; REC_TIMER.textContent=formatTime(state.recordSeconds); },1000);
  if (document.getElementById('srvLbl')?.textContent.includes('offline')) {
    state.translationTimeout = setTimeout(runSimulation,1200);
    state.translationInterval = setInterval(()=>{ if(state.isRecording)runSimulation(); },4000);
  }
  showToast('🔴 Recording started');
}

function stopRecording() {
  state.isRecording=false;
  RECORD_BTN.setAttribute('aria-pressed','false'); RECORD_BTN.setAttribute('aria-label','Start recording');
  RECORD_LABEL.textContent='Record'; REC_BADGE.hidden=true;
  VIEWFINDER.classList.remove('recording'); LIVE_IND.classList.remove('active');
  if (state.hapticOn && navigator.vibrate) navigator.vibrate([50,30,50]);
  clearTimeout(state.translationTimeout); clearInterval(state.recordInterval); clearInterval(state.translationInterval);
  state.translationTimeout=state.recordInterval=state.translationInterval=null;
  showToast(`⏹ Stopped - ${formatTime(state.recordSeconds)}`);
}

function runSimulation() {
  const text=SAMPLE_TL[simIdx++%SAMPLE_TL.length];
  TL_TEXT.classList.add('updating');
  setTimeout(()=>{ TL_TEXT.textContent=text; TL_TEXT.classList.remove('updating'); },220);
  if (state.isAutoSpeak) autoSpeakNow(text,'en');
}

function handleFile(e) { const f=e.target.files[0]; if(f)uploadVideo(f); }

async function uploadVideo(file) {
  if (!file.type.startsWith('video/')) { showToast('⚠️ Please select a video file.'); return; }
  if (videoEl) {
    if (videoEl.srcObject) videoEl.srcObject.getTracks().forEach(t=>t.pause?.());
    videoEl.srcObject=null; videoEl.src=URL.createObjectURL(file); videoEl.loop=true; videoEl.play().catch(()=>{});
    VIEWFINDER.classList.add('camera-active');
    const badge=document.getElementById('camBadge'); if(badge)badge.textContent='Video · analysing…';
  }
  const prog=document.getElementById('upProg'); const fill=document.getElementById('upFill'); const lbl=document.getElementById('upLbl');
  if(prog)prog.style.display='block'; if(lbl)lbl.textContent=`Processing: ${file.name}`;
  let fake=0; const tick=setInterval(()=>{ fake=Math.min(fake+2,85); if(fill)fill.style.width=fake+'%'; },200);
  try {
    const fd=new FormData(); fd.append('video',file);
    const r=await fetch(`${API}/predict-video`,{method:'POST',headers:authHeader(),body:fd});
    const d=await r.json();
    clearInterval(tick); if(fill)fill.style.width='100%';
    if(d.success) {
      if(lbl)lbl.textContent=`Done - ${d.frames} frames`;
      showResult(d.predictions);
      setTimeout(()=>{ if(prog)prog.style.display='none'; if(fill)fill.style.width='0%'; if(videoEl){videoEl.src='';videoEl.loop=false;} state.cameraReady=false; initCamera(); },3000);
    } else { if(lbl)lbl.textContent='Error: '+d.error; setTimeout(()=>{ if(prog)prog.style.display='none'; },3000); }
  } catch { clearInterval(tick); if(lbl)lbl.textContent='Connection error'; setTimeout(()=>{ if(prog)prog.style.display='none'; },3000); }
}

PLAY_BTN.addEventListener('click', () => {
  const text=state.currentResult?.arabic||state.currentResult?.english||TL_TEXT.textContent;
  if (!text||text==='Waiting for sign input…') { showToast('ℹ️ No translation to speak yet.'); return; }
  if (state.isPlaying) {
    state.isPlaying=false; PLAY_BTN.classList.remove('playing');
    if(PLAY_ICON)PLAY_ICON.textContent='▶'; if(PLAY_WAVEFORM)PLAY_WAVEFORM.classList.remove('active');
    if('speechSynthesis' in window) window.speechSynthesis.cancel();
  } else {
    state.isPlaying=true; PLAY_BTN.classList.add('playing');
    if(PLAY_ICON)PLAY_ICON.textContent='■'; if(PLAY_WAVEFORM)PLAY_WAVEFORM.classList.add('active');
    speak(text, /[؀-ۿ]/.test(text)?'ar':'en').finally(()=>{
      state.isPlaying=false; PLAY_BTN.classList.remove('playing');
      if(PLAY_ICON)PLAY_ICON.textContent='▶'; if(PLAY_WAVEFORM)PLAY_WAVEFORM.classList.remove('active');
    });
  }
});

AUTO_SPEAK.addEventListener('change', () => {
  state.isAutoSpeak=AUTO_SPEAK.checked;
  AUTO_SPEAK.closest('.toggle-track').setAttribute('aria-checked',AUTO_SPEAK.checked);
  if(AUTO_SPEAK.checked){setAutoSpeakStatus('Ready - will speak each new sign');showToast('🔊 Auto-Speak on');}
  else{setAutoSpeakStatus('');showToast('🔇 Auto-Speak off');}
});

let isFrontCamera=true;
FLIP_BTN.addEventListener('click', () => {
  isFrontCamera=!isFrontCamera;
  if(videoEl?.srcObject){
    videoEl.srcObject.getTracks().forEach(t=>t.stop()); state.cameraReady=false;
    navigator.mediaDevices.getUserMedia({video:{facingMode:isFrontCamera?'user':'environment',width:640,height:480}})
      .then(s=>{videoEl.srcObject=s;videoEl.play();state.cameraReady=true;VIEWFINDER.classList.add('camera-active');})
      .catch(()=>{state.cameraReady=false;});
  }
  showToast(`📷 ${isFrontCamera?'Front':'Rear'} camera`);
});

/* ─────────────────────────────────────────────────────────
   PAGE 3: SPEECH TO SIGN
───────────────────────────────────────────────────────── */
TAB_MIC.addEventListener('click', () => switchInputTab('mic'));
TAB_KBD.addEventListener('click', () => switchInputTab('kbd'));

function switchInputTab(tab) {
  const isMic=tab==='mic';
  TAB_MIC.classList.toggle('active',isMic); TAB_KBD.classList.toggle('active',!isMic);
  TAB_MIC.setAttribute('aria-selected',isMic); TAB_KBD.setAttribute('aria-selected',!isMic);
  PANEL_MIC.classList.toggle('hidden',!isMic); PANEL_KBD.classList.toggle('hidden',isMic);
  if(!isMic&&state.isMicRecording)stopMicSTT();
}

MIC_BTN.addEventListener('click', () => { if(state.isMicRecording)stopMicSTT(); else startMicSTT(); });

async function startMicSTT() {
  if('webkitSpeechRecognition' in window||'SpeechRecognition' in window){ startBrowserSTT(); return; }
  try {
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mimes=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
    const mime=mimes.find(m=>MediaRecorder.isTypeSupported(m))||'';
    state.mediaRec=new MediaRecorder(stream,mime?{mimeType:mime}:{});
    state.recChunks=[];
    state.mediaRec.ondataavailable=e=>state.recChunks.push(e.data);
    state.mediaRec.onstop=sendToElevenLabsSTT;
    state.mediaRec.start(); state.isMicRecording=true; setMicUI(true);
  } catch(e){ if(MIC_STATUS)MIC_STATUS.textContent='Error: '+e.message; }
}

function stopMicSTT() {
  if(state.mediaRec&&state.isMicRecording){state.mediaRec.stop();state.mediaRec.stream.getTracks().forEach(t=>t.stop());}
  state.isMicRecording=false; setMicUI(false);
  if(MIC_STATUS)MIC_STATUS.textContent='Processing…';
}

function setMicUI(on) {
  MIC_BTN.setAttribute('aria-pressed',on);
  if(WAVEFORM){WAVEFORM.hidden=!on;WAVEFORM.setAttribute('aria-hidden',!on);}
  if(MIC_STATUS)MIC_STATUS.textContent=on?'Listening…':'Tap to listen';
}

function startBrowserSTT() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const rec=new SR();
  rec.lang=(document.getElementById('sttLang')?.value==='ara')?'ar-OM':'en-US';
  rec.continuous=false; rec.interimResults=true;
  setSttBox('Listening…');
  rec.onresult=e=>{ const t=[...e.results].map(r=>r[0].transcript).join(''); setSttBox(t); if(e.results[e.results.length-1].isFinal)state.sttText=t; };
  rec.onerror=e=>setSttBox('Error: '+e.error);
  rec.onend=()=>{ state.isMicRecording=false; setMicUI(false); if(MIC_STATUS)MIC_STATUS.textContent='Tap to listen'; const useBtn=document.getElementById('btnUseText'); if(useBtn)useBtn.disabled=!state.sttText; };
  rec.start(); state.isMicRecording=true; setMicUI(true);
  if(MIC_STATUS)MIC_STATUS.textContent='Listening… (speak now)';
}

async function sendToElevenLabsSTT() {
  const apiKey=document.getElementById('elApiKey')?.value.trim();
  const lang=document.getElementById('sttLang')?.value||'eng';
  if(!apiKey&&!state.elServer){setSttBox('Add an ElevenLabs API Key (🔊 Voice API in the header)');if(MIC_STATUS)MIC_STATUS.textContent='API Key required';return;}
  const mime=state.recChunks[0]?.type||'audio/webm';
  const blob=new Blob(state.recChunks,{type:mime});
  const ext=mime.includes('mp4')?'rec.mp4':mime.includes('ogg')?'rec.ogg':'rec.webm';
  const fd=new FormData();
  fd.append('audio',blob,ext); fd.append('api_key',apiKey); fd.append('lang',lang);
  try {
    const r=await fetch(`${API}/stt-elevenlabs`,{method:'POST',headers:authHeader(),body:fd});
    const d=await r.json();
    if(d.success){state.sttText=d.transcript;setSttBox(d.transcript);const useBtn=document.getElementById('btnUseText');if(useBtn)useBtn.disabled=false;}
    else setSttBox('Error: '+d.error);
  } catch{setSttBox('Connection error');}
  if(MIC_STATUS)MIC_STATUS.textContent='Tap to listen';
}

function setSttBox(text) { const b=document.getElementById('sttBox'); if(b)b.textContent=text; }

function useSTTText() {
  if(!state.sttText){showToast('⚠️ No recognised speech yet.');return;}
  const cleaned=state.sttText.replace(/[^؀-ۿa-zA-Z\s]/g,' ').replace(/\s+/g,' ').trim();
  if(!cleaned){showToast('⚠️ No usable text after cleaning.');return;}
  const avText=document.getElementById('avText'); if(avText)avText.value=cleaned;
  if(HEARD_TEXT)HEARD_TEXT.textContent=cleaned;
  switchInputTab('kbd'); startSigning();
}

const avCanvas=document.getElementById('avatarCanvas');
const avCtx=avCanvas?avCanvas.getContext('2d'):null;

async function startSigning() {
  const avText=document.getElementById('avText');
  const raw=avText?.value.trim();
  if(!raw){showToast('⚠️ Please type something first.');avText?.focus();return;}
  const text=raw.replace(/[^؀-ۿa-zA-Z\s]/g,' ').replace(/\s+/g,' ').trim();
  if(!text){showToast('⚠️ No usable text.');return;}
  if(avText)avText.value=text;

  const btnSign=document.getElementById('btnSign');
  if(btnSign)btnSign.disabled=true;
  const idleEl=document.getElementById('avatarIdle');
  if(idleEl)idleEl.style.display='none';
  if(AV_STATUS)AV_STATUS.classList.add('active');
  if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Resolving signs…';
  if(HEARD_TEXT)HEARD_TEXT.textContent=text;

  try {
    const r=await fetch(`${API}/avatar/resolve`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text})});
    const d=await r.json();
    if(!d.success){showToast('⚠️ Could not resolve text.');if(btnSign)btnSign.disabled=false;return;}
    const seq=d.sequence;
    renderWordQueue(seq,0);
    state.avQueue=[];
    for(const item of seq){
      if(item.has_anim&&item.sign_id){
        try{const fr=await fetch(`${API}/avatar/frames/${item.sign_id}`);const fd2=await fr.json();state.avQueue.push(fd2.success?{...item,frames:fd2.frames,fmt:fd2.format}:{...item,frames:null});}
        catch{state.avQueue.push({...item,frames:null});}
      } else state.avQueue.push({...item,frames:null});
    }
    state.avCurrentIdx=0; state.avPlaying=true;
    if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Signing…';
    playNextSign();
    saveTranslation('sp2s', text, text, 0);
  } catch {
    showToast('⚠️ Server unavailable - using CSS avatar');
    if(btnSign)btnSign.disabled=false;
    animateAvatarFallback(text);
  }
}

async function playNextSign() {
  if(state.avCurrentIdx>=state.avQueue.length){
    state.avPlaying=false;
    const btnSign=document.getElementById('btnSign');
    if(btnSign)btnSign.disabled=false;
    if(AV_STATUS)AV_STATUS.classList.remove('active');
    if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Done - ready for new input';
    return;
  }
  const item=state.avQueue[state.avCurrentIdx];
  renderWordQueue(state.avQueue,state.avCurrentIdx);
  if(!item.frames){drawPlaceholder(item.word);await sleep(700);state.avCurrentIdx++;playNextSign();return;}
  const msPerFrame=1000/(30*state.playbackSpeed);
  for(let f=0;f<item.frames.length;f++){if(!state.avPlaying)break;drawAvatarFrame(item.frames[f],item.fmt,item.word);await sleep(msPerFrame);}
  state.avCurrentIdx++;playNextSign();
}

function resizeAvCanvas(){const wrap=document.getElementById('avatarWrap');if(!avCanvas||!wrap)return;const w=wrap.clientWidth||600,h=wrap.clientHeight||340;if(avCanvas.width!==w||avCanvas.height!==h){avCanvas.width=w;avCanvas.height=h;}}

function drawAvatarFrame(frame,fmt,label){
  if(!avCtx||!avCanvas)return;resizeAvCanvas();
  const W=avCanvas.width,H=avCanvas.height;
  avCtx.clearRect(0,0,W,H);avCtx.fillStyle='#040810';avCtx.fillRect(0,0,W,H);
  const sc=Math.min(W,H)*0.16,cx=W*0.5,cy=H*0.36;
  const proj=pt=>[cx+(pt[0]||0)*sc,cy+(pt[1]||0)*sc];
  if(fmt==='543'){drawSkel543(frame.slice(POSE_OFF_543,POSE_OFF_543+33),frame.slice(LH_OFF_543,LH_OFF_543+21),frame.slice(RH_OFF_543,RH_OFF_543+21),proj);}
  else{drawSkel133(frame.slice(0,17),frame.slice(LH_OFF_133,LH_OFF_133+21),frame.slice(RH_OFF_133,RH_OFF_133+21),proj);}
  avCtx.fillStyle='rgba(13,255,140,0.9)';avCtx.font='bold 20px "Plus Jakarta Sans",sans-serif';avCtx.textAlign='center';
  avCtx.fillText(label,W/2,H-14);
}
const nz=arr=>arr.some(p=>(p[0]||0)!==0||(p[1]||0)!==0);
function drawSkel543(pose,lh,rh,proj){avCtx.lineCap='round';avCtx.strokeStyle='rgba(13,255,140,.75)';avCtx.lineWidth=2.5;BODY_CONN_543.forEach(([a,b])=>{if(!pose[a]||!pose[b])return;const[ax,ay]=proj(pose[a]);const[bx,by]=proj(pose[b]);avCtx.beginPath();avCtx.moveTo(ax,ay);avCtx.lineTo(bx,by);avCtx.stroke();});if(pose[0]){const[hx,hy]=proj(pose[0]);avCtx.beginPath();avCtx.arc(hx,hy,14,0,2*Math.PI);avCtx.strokeStyle='rgba(13,255,140,.65)';avCtx.lineWidth=2;avCtx.stroke();avCtx.fillStyle='rgba(13,255,140,.06)';avCtx.fill();}if(nz(lh))drawHandProj(lh,proj,'#0dff8c');if(nz(rh))drawHandProj(rh,proj,'#c084fc');}
function drawSkel133(body,lh,rh,proj){avCtx.lineCap='round';avCtx.strokeStyle='rgba(13,255,140,.75)';avCtx.lineWidth=2.5;BODY_CONN_133.forEach(([a,b])=>{if(!body[a]||!body[b])return;const[ax,ay]=proj(body[a]);const[bx,by]=proj(body[b]);avCtx.beginPath();avCtx.moveTo(ax,ay);avCtx.lineTo(bx,by);avCtx.stroke();});if(body[0]){const[hx,hy]=proj(body[0]);avCtx.beginPath();avCtx.arc(hx,hy,14,0,2*Math.PI);avCtx.strokeStyle='rgba(13,255,140,.65)';avCtx.lineWidth=2;avCtx.stroke();avCtx.fillStyle='rgba(13,255,140,.06)';avCtx.fill();}if(nz(lh))drawHandProj(lh,proj,'#0dff8c');if(nz(rh))drawHandProj(rh,proj,'#c084fc');}
function drawHandProj(hand,proj,color){if(!hand||hand.length<21)return;avCtx.strokeStyle=color+'88';avCtx.lineWidth=1.8;avCtx.lineCap='round';HAND_CONN.forEach(([a,b])=>{if(!hand[a]||!hand[b])return;const[ax,ay]=proj(hand[a]);const[bx,by]=proj(hand[b]);avCtx.beginPath();avCtx.moveTo(ax,ay);avCtx.lineTo(bx,by);avCtx.stroke();});avCtx.fillStyle=color;hand.forEach(pt=>{const[x,y]=proj(pt);avCtx.beginPath();avCtx.arc(x,y,3,0,2*Math.PI);avCtx.fill();});}
function drawPlaceholder(word){if(!avCtx||!avCanvas)return;resizeAvCanvas();const W=avCanvas.width,H=avCanvas.height;avCtx.clearRect(0,0,W,H);avCtx.fillStyle='#040810';avCtx.fillRect(0,0,W,H);avCtx.fillStyle='rgba(100,116,139,.5)';avCtx.font='bold 48px "Plus Jakarta Sans",sans-serif';avCtx.textAlign='center';avCtx.fillText(word,W/2,H/2);avCtx.font='14px "DM Sans",sans-serif';avCtx.fillStyle='rgba(100,116,139,.4)';avCtx.fillText('No sign available',W/2,H/2+40);}
function renderWordQueue(seq,activeIdx){const q=document.getElementById('wordQueue');if(!q)return;q.innerHTML='';seq.forEach((item,i)=>{const sp=document.createElement('span');const base='padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid;margin:2px;display:inline-block;transition:all .3s;';if(i===activeIdx)sp.style.cssText=base+'background:var(--color-accent-dim);border-color:var(--color-accent);color:var(--color-accent);transform:scale(1.05);';else if(i<activeIdx)sp.style.cssText=base+'opacity:.4;border-color:var(--glass-border);color:var(--text-muted);';else sp.style.cssText=base+'background:var(--glass-bg);border-color:var(--glass-border);color:var(--text-secondary);'+(item.has_anim?'':'border-style:dashed;');sp.textContent=item.word;if(!item.has_anim)sp.title='No sign available';q.appendChild(sp);});}

const avatarExpressions=['🙂','🤔','😊','🙂','😐','😊'];let avatarExpIdx=0;
function animateAvatarFallback(text){if(AV_STATUS)AV_STATUS.classList.add('active');if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Signing…';AVATAR_FIG.classList.add('signing');AV_HEAD.textContent=avatarExpressions[avatarExpIdx++%avatarExpressions.length];const dur=Math.min(Math.max(text.split(' ').length*500,2000),8000);setTimeout(()=>{AVATAR_FIG.classList.remove('signing');if(AV_STATUS)AV_STATUS.classList.remove('active');if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Done';AV_HEAD.textContent='🙂';},dur);}

SPEED_PILLS.forEach(pill=>pill.addEventListener('click',()=>{SPEED_PILLS.forEach(p=>{p.classList.remove('active');p.setAttribute('aria-pressed','false');});pill.classList.add('active');pill.setAttribute('aria-pressed','true');state.playbackSpeed=parseFloat(pill.dataset.speed);const el=document.getElementById('avSpeed');if(el)el.value=state.playbackSpeed;showToast(`⏱ Speed: ${pill.textContent}`);}));

/* ─────────────────────────────────────────────────────────
   SHARED: speak()
───────────────────────────────────────────────────────── */
async function speak(text,lang='en'){
  const apiKey=document.getElementById('elApiKey')?.value.trim();
  // 1. ElevenLabs - only if the user pasted their own key (optional premium).
  if(apiKey){try{const r=await fetch(`${API}/tts-elevenlabs`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text,api_key:apiKey,voice_id:getVoiceId(),model_id:document.getElementById('elModel')?.value||'eleven_multilingual_v2'})});if(r.ok){new Audio(URL.createObjectURL(await r.blob())).play();return;}}catch(_){}}
  // 2. Free neural edge-tts (default - natural Omani Arabic, no key).
  try{const r=await fetch(`${API}/tts-edge`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text,lang})});if(r.ok){new Audio(URL.createObjectURL(await r.blob())).play();return;}}catch(_){}
  // 3. gTTS fallback.
  try{const r=await fetch(`${API}/tts`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text,lang})});if(r.ok){new Audio(URL.createObjectURL(await r.blob())).play();return;}}catch(_){}
  // 4. Browser speech as last resort.
  speakWebSpeech(text,lang);
}
function speakWebSpeech(text,lang='en'){if(!('speechSynthesis' in window))return;const u=new SpeechSynthesisUtterance(text);u.lang=/[؀-ۿ]/.test(text)||lang==='ar'?'ar-OM':'en-US';u.rate=0.95;speechSynthesis.cancel();speechSynthesis.speak(u);}
function getVoiceId(){const sel=document.getElementById('elVoiceId');return sel?.value==='custom'?(document.getElementById('elVoiceCustom')?.value||''):(sel?.value||'21m00Tcm4TlvDq8ikWAM');}

/* ─────────────────────────────────────────────────────────
   ELEVENLABS SETTINGS
───────────────────────────────────────────────────────── */
function loadELSettings(){
  const api=document.getElementById('elApiKey'); if(api)api.value=localStorage.getItem('el_api_key')||'';
  const mod=document.getElementById('elModel');  if(mod)mod.value=localStorage.getItem('el_model')||'eleven_multilingual_v2';
  const v=localStorage.getItem('el_voice_id')||'21m00Tcm4TlvDq8ikWAM';
  const sel=document.getElementById('elVoiceId');
  if(sel){const opt=[...sel.options].find(o=>o.value===v);if(opt)sel.value=v;else{sel.value='custom';const cu=document.getElementById('elVoiceCustom');if(cu)cu.value=v;const row=document.getElementById('elVoiceCustomRow');if(row)row.style.display='block';}}
}

function saveELSettings(){
  const api=document.getElementById('elApiKey');if(api)localStorage.setItem('el_api_key',api.value);
  const mod=document.getElementById('elModel');if(mod)localStorage.setItem('el_model',mod.value);
  const sel=document.getElementById('elVoiceId');
  if(sel){if(sel.value==='custom'){const row=document.getElementById('elVoiceCustomRow');if(row)row.style.display='block';const cu=document.getElementById('elVoiceCustom');localStorage.setItem('el_voice_id',cu?.value||'');}else{const row=document.getElementById('elVoiceCustomRow');if(row)row.style.display='none';localStorage.setItem('el_voice_id',sel.value);}}
  // Persist to DB
  const dbData = {};
  const apiEl=document.getElementById('elApiKey'); if(apiEl) dbData.el_api_key=apiEl.value;
  const modEl=document.getElementById('elModel');  if(modEl) dbData.el_model=modEl.value;
  if(sel&&sel.value!=='custom') dbData.el_voice_id=sel.value;
  saveSettingsToDB(dbData);
}

/* ─────────────────────────────────────────────────────────
   SETTINGS PAGE
───────────────────────────────────────────────────────── */
// Theme switching disabled - site is light-only.
function toggleTheme(){ /* no-op */ }
function applyTheme(_theme){ HTML.setAttribute('data-theme','light'); state.theme='light'; }

if(ACCENT_PICKER)ACCENT_PICKER.querySelectorAll('.accent-swatch').forEach(sw=>sw.addEventListener('click',()=>{
  ACCENT_PICKER.querySelectorAll('.accent-swatch').forEach(s=>{s.classList.remove('active');s.setAttribute('aria-pressed','false');});
  sw.classList.add('active');sw.setAttribute('aria-pressed','true');
  applyAccentColor(sw.dataset.color);showToast('🎨 Accent color updated');
  saveSettingsToDB({ accent_color: sw.dataset.color });
}));

function applyAccentColor(hex){
  state.accentColor=hex; HTML.style.setProperty('--color-accent',hex);
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(m){const rgb=`${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}`;HTML.style.setProperty('--color-accent-dim',`rgba(${rgb},.10)`);HTML.style.setProperty('--color-accent-glow',`rgba(${rgb},.30)`);}
  try{localStorage.setItem('jissr-accent',hex);}catch(_){}
}

if(TEXT_SIZE_SL)TEXT_SIZE_SL.addEventListener('input',debounce(()=>{
  const sz=TEXT_SIZE_SL.value;state.textSize=parseInt(sz,10);
  if(TS_OUT)TS_OUT.textContent=`${sz}px`;TEXT_SIZE_SL.setAttribute('aria-valuenow',sz);
  HTML.style.setProperty('--tl-font-size',`${sz}px`);
  const pct=((sz-14)/(28-14))*100;TEXT_SIZE_SL.style.backgroundSize=`${pct}% 100%`;
  try{localStorage.setItem('jissr-textsize',sz);}catch(_){}
  saveSettingsToDB({ text_size: parseInt(sz, 10) });
},600));

[HAPTIC_TOG,CUES_TOG,CONTRAST_TOG].forEach(tog=>{
  if(!tog)return;
  tog.addEventListener('change',()=>{
    const track=tog.closest('.toggle-track');if(track)track.setAttribute('aria-checked',tog.checked);
    if(tog.id==='haptic-tog'){state.hapticOn=tog.checked;showToast(tog.checked?'📳 Haptic on':'📴 Haptic off');saveSettingsToDB({haptic_feedback:tog.checked?1:0});}
    if(tog.id==='cues-tog'){state.visualCuesOn=tog.checked;showToast(tog.checked?'👁 Visual cues on':'👁 Visual cues off');saveSettingsToDB({visual_cues:tog.checked?1:0});}
    if(tog.id==='contrast-tog'){state.highContrast=tog.checked;HTML.setAttribute('data-high-contrast',tog.checked);showToast(tog.checked?'⚡ High contrast on':'⚡ High contrast off');saveSettingsToDB({high_contrast:tog.checked?1:0});}
  });
});

if(CAM_QUAL_SEL)CAM_QUAL_SEL.addEventListener('change',()=>{showToast(`📷 Camera: ${CAM_QUAL_SEL.value.toUpperCase()}`);saveSettingsToDB({camera_quality:CAM_QUAL_SEL.value});});

async function doLogout() {
  if(state.authToken){
    try{await fetch(`${API}/auth/logout`,{method:'POST',headers:authHeader()});}catch(_){}
  }
  if(videoEl?.srcObject){videoEl.srcObject.getTracks().forEach(t=>t.stop());videoEl.srcObject=null;}
  state.cameraReady=false;
  if(state.healthInterval){clearInterval(state.healthInterval);state.healthInterval=null;}
  clearAuth();
  showToast('👋 Signed out');
  setTimeout(()=>navigateTo('landing'), 200);
}

LOGOUT_BTN?.addEventListener('click', doLogout);
document.getElementById('header-logout-btn')?.addEventListener('click', doLogout);

/* ── Voice API modal (replaces Settings page) ── */
(function () {
  const modal = document.getElementById('voice-modal');
  if (!modal) return;
  const openBtn  = document.getElementById('voice-settings-btn');
  const closeBtn = document.getElementById('voice-modal-close');
  function open() {
    if (typeof loadELSettings === 'function') loadELSettings();
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

/* ─────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg,dur=2800){
  clearTimeout(toastTimer);TOAST.textContent=msg;TOAST.setAttribute('aria-hidden','false');TOAST.classList.add('show');
  toastTimer=setTimeout(()=>{TOAST.classList.remove('show');setTimeout(()=>TOAST.setAttribute('aria-hidden','true'),300);},dur);
}
function formatTime(s){return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function debounce(fn,delay){let t;return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),delay);};}

/* ─────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────── */
function init(){
  // Restore visual preferences (theme, accent, text size)
  try{
    // Always start in bright/light theme - user explicitly asked for bright default.
    // The toggle in Settings still works during the session.
    localStorage.removeItem('jissr-theme');
    state.theme='light';
    HTML.setAttribute('data-theme','light');
    if(THEME_SEG)THEME_SEG.querySelectorAll('.seg-btn').forEach(btn=>{const on=btn.dataset.theme==='light';btn.classList.toggle('active',on);btn.setAttribute('aria-checked',on);});
    const accent=localStorage.getItem('jissr-accent');
    const tsz=localStorage.getItem('jissr-textsize');
    if(accent){applyAccentColor(accent);ACCENT_PICKER?.querySelectorAll('.accent-swatch').forEach(s=>{const on=s.dataset.color===accent;s.classList.toggle('active',on);s.setAttribute('aria-pressed',on);});}
    if(tsz&&TEXT_SIZE_SL){TEXT_SIZE_SL.value=tsz;if(TS_OUT)TS_OUT.textContent=`${tsz}px`;HTML.style.setProperty('--tl-font-size',`${tsz}px`);const pct=((tsz-14)/(28-14))*100;TEXT_SIZE_SL.style.backgroundSize=`${pct}% 100%`;}
  }catch(_){}

  document.querySelectorAll('.toggle-input').forEach(i=>{const t=i.closest('.toggle-track');if(t)t.setAttribute('aria-checked',i.checked);});
  if(TEXT_SIZE_SL){const pct=((TEXT_SIZE_SL.value-14)/(28-14))*100;TEXT_SIZE_SL.style.backgroundSize=`${pct}% 100%`;}
  window.addEventListener('resize',resizeAvCanvas);

  // Strict auth gate: try to restore a session; if missing/expired, drop to public landing
  if (loadStoredAuth()) {
    // Verify the stored token still works server-side before letting them into the app
    fetch(`${API}/auth/me`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : { success: false })
      .then(d => {
        if (d.success && d.user) {
          state.user = d.user;
          updateHeaderUser(d.user);
          enterApp(null);
        } else {
          clearAuth();
          goPublicStart();
        }
      })
      .catch(() => {
        // Backend unreachable - keep them on landing, they can retry signing in
        clearAuth();
        goPublicStart();
      });
  } else {
    goPublicStart();
  }

  console.log('✅ JISSR v4.0 initialised - strict auth gating active');
}

document.addEventListener('DOMContentLoaded', init);


/* ═══════════════════════════════════════════════════════════════
   GOOGLE SIGN-IN  (Google Identity Services - new 2022+ API)
   ──────────────────────────────────────────────────────────────
   SETUP INSTRUCTIONS:
   1. Go to https://console.cloud.google.com/
   2. Create a project → APIs & Services → Credentials
   3. Create OAuth 2.0 Client ID (Web application)
   4. Add your domain to "Authorised JavaScript origins"
      e.g.  http://localhost:5000  or  https://yourdomain.com
   5. Replace GOOGLE_CLIENT_ID below with your actual client_id
   6. The sign-in button will work automatically after that.
   ─────────────────────────────────────────────────────────── */

// Loaded dynamically from /config so the Client ID lives in config.json, not in JS.
let GOOGLE_CLIENT_ID = '';
let GOOGLE_READY     = false;

function isGoogleClientIdConfigured(id) {
  return !!id && !id.startsWith('YOUR_');
}

function initGoogleIdentity() {
  if (typeof google === 'undefined' || !isGoogleClientIdConfigured(GOOGLE_CLIENT_ID)) return;
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback:  handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
    });
    GOOGLE_READY = true;
    console.log('[Google] Identity Services ready');
  } catch (e) {
    console.warn('[Google] GIS init failed:', e.message);
  }
}

async function loadGoogleClientId() {
  try {
    const r = await fetch(`${API}/config`);
    const d = await r.json();
    GOOGLE_CLIENT_ID = d.google_client_id || '';
    state.elServer = !!d.elevenlabs_available;
  } catch (_) {}
  initGoogleIdentity();
}

/** Called automatically by the GIS script once it loads */
window.onGoogleLibraryLoad = function () { initGoogleIdentity(); };

// Kick off Client-ID fetch as soon as this script runs.
loadGoogleClientId();

/**
 * Decode a JWT payload without verification (client-side display only).
 * Server MUST verify the id_token independently via Google's tokeninfo endpoint.
 */
function decodeJwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  } catch { return null; }
}

/**
 * GIS callback - fired when user completes Google One-Tap or popup flow.
 * @param {google.accounts.id.CredentialResponse} response
 */
async function handleGoogleCredentialResponse(response) {
  const idToken = response.credential;
  const payload = decodeJwtPayload(idToken);
  if (!payload) { showToast('⚠️ Could not decode Google token'); return; }

  const name    = payload.name    || 'Google User';
  const email   = payload.email   || '';
  const picture = payload.picture || '';

  showToast(`🔄 Signing in as ${name}…`);

  try {
    // Send to backend - backend creates/finds user by email (no server-side Google validation needed for demo,
    // but in production you should verify id_token server-side with:
    //   POST https://oauth2.googleapis.com/tokeninfo?id_token=<token>
    const r = await fetch(`${API}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken, name, email, picture }),
    });
    const d = await r.json();
    if (d.success) {
      saveAuthToken(d.token, d.user);
      // Show Google profile picture in header if available
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
      // Backend unavailable - create a guest session locally
      showToast(`✅ Signed in as ${name} (guest session)`);
      saveAuthToken(null, { id: 0, name, email, is_guest: 0 });
      enterApp(null);
    }
  } catch (err) {
    console.error('[Google auth]', err);
    showToast('⚠️ Google sign-in failed. Please sign in with email or register.');
  }
}

/** Trigger Google sign-in popup when user clicks the Google button */
function triggerGoogleSignIn() {
  // Make sure GIS is initialised before prompting (handles the race where the
  // config fetch finishes after the GIS script has already loaded).
  if (!GOOGLE_READY) initGoogleIdentity();

  const configured = (typeof google !== 'undefined') && GOOGLE_READY
    && isGoogleClientIdConfigured(GOOGLE_CLIENT_ID);

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
      showToast('⚠️ Google popup blocked. Please allow popups or sign in with email.');
    }
    return;
  }

  console.info('[JISSR] Google Client ID not configured.');
  showToast('⚠️ Google sign-in is not configured. Please sign in with email or register.');
}

// Wire Google button click
GOOGLE_BTN?.addEventListener('click', triggerGoogleSignIn);
APPLE_BTN?.addEventListener('click', () => {
  showToast('🍎 Connecting to Apple…');
  setTimeout(() => enterAppOffline('✅ Signed in with Apple!'), 800);
});


/* ═══════════════════════════════════════════════════════════════
   FORM VALIDATION - real-time client-side validation
   Rules:
     name     : ≥2 chars, letters only
     email    : RFC-compliant regex
     password : ≥8 chars, 1 uppercase, 1 lowercase, 1 digit
     confirm  : must match password
══════════════════════════════════════════════════════════════ */

/** Mark a field as valid/invalid with icon + error message */
function setFieldState(inputEl, iconId, errorId, valid, message) {
  const icon  = document.getElementById(iconId);
  const error = document.getElementById(errorId);
  inputEl.classList.toggle('valid',   valid);
  inputEl.classList.toggle('invalid', !valid && message !== null);
  if (icon) { icon.className = 'input-icon ' + (valid ? 'valid' : (message ? 'invalid' : '')); }
  if (error) error.textContent = (valid || !message) ? '' : message;
}

/** Clear all validation state on a field */
function clearFieldState(inputEl, iconId, errorId) {
  if (!inputEl) return;
  inputEl.classList.remove('valid','invalid');
  const icon  = document.getElementById(iconId);
  const error = document.getElementById(errorId);
  if (icon)  icon.className = 'input-icon';
  if (error) error.textContent = '';
}

/* --- Validators --- */
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

function validateEmailValue(email) {
  if (!email)                    return 'Email is required';
  if (!EMAIL_RE.test(email))     return 'Enter a valid email address (e.g. you@example.com)';
  return null; // valid
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

/* --- Password Strength Calculator --- */
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

/* --- Real-time validation listeners --- */
function wireRegisterValidation() {
  const nameEl    = document.getElementById('reg-name');
  const emailEl   = document.getElementById('reg-email');
  const pwEl      = document.getElementById('reg-password');
  const confirmEl = document.getElementById('reg-confirm-password');

  nameEl?.addEventListener('input', () => {
    const err = validateNameValue(nameEl.value.trim());
    setFieldState(nameEl, 'reg-name-icon', 'reg-name-error', !err, err);
  });

  emailEl?.addEventListener('input', () => {
    const err = validateEmailValue(emailEl.value.trim());
    setFieldState(emailEl, 'reg-email-icon', 'reg-email-error', !err, err);
  });

  pwEl?.addEventListener('input', () => {
    updateStrengthBar(pwEl.value);
    const err = validatePasswordValue(pwEl.value);
    setFieldState(pwEl, null, 'reg-pw-error', !err, err);
    // Re-validate confirm if already touched
    if (confirmEl?.classList.contains('valid') || confirmEl?.classList.contains('invalid')) {
      const cErr = validateConfirmValue(pwEl.value, confirmEl.value);
      setFieldState(confirmEl, 'reg-confirm-icon', 'reg-confirm-error', !cErr, cErr);
    }
  });

  confirmEl?.addEventListener('input', () => {
    const cErr = validateConfirmValue(pwEl?.value || '', confirmEl.value);
    setFieldState(confirmEl, 'reg-confirm-icon', 'reg-confirm-error', !cErr, cErr);
  });

  // Login email real-time
  const loginEmail = document.getElementById('email-input');
  loginEmail?.addEventListener('blur', () => {
    if (!loginEmail.value) return;
    const err = validateEmailValue(loginEmail.value.trim());
    setFieldState(loginEmail, 'email-icon', 'email-error', !err, err);
  });
  loginEmail?.addEventListener('input', () => {
    if (loginEmail.classList.contains('invalid')) {
      const err = validateEmailValue(loginEmail.value.trim());
      if (!err) setFieldState(loginEmail, 'email-icon', 'email-error', true, null);
    }
  });
}

/** Full validation pass before register submit - returns true if all valid */
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

  // Focus the first invalid field
  const firstInvalid = [nameEl, emailEl, pwEl, confirmEl].find(el => el?.classList.contains('invalid'));
  firstInvalid?.focus();

  return !nameErr && !emailErr && !pwErr && !confirmErr;
}

/** Validate login form before submit */
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

/* Block native form submission when validation fails (capture phase) */
LOGIN_FORM?.addEventListener('submit', e => {
  if (!validateLoginForm()) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

REGISTER_FORM?.addEventListener('submit', e => {
  if (!validateRegisterForm()) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);


/* ═══════════════════════════════════════════════════════════════
   BUTTON LOADING STATE helpers
══════════════════════════════════════════════════════════════ */
function setBtnLoading(btnEl, loading) {
  if (!btnEl) return;
  if (loading) btnEl.classList.add('loading');
  else         btnEl.classList.remove('loading');
  btnEl.disabled = loading;
}


/* ═══════════════════════════════════════════════════════════════
   RIPPLE EFFECT - attach to all .btn--primary
══════════════════════════════════════════════════════════════ */
function attachRipple() {
  // Disabled: previous implementation appended <span class="btn-ripple"> elements
  // that relied on an animationend event to clean up, but there is no keyframe
  // animation defined for .btn-ripple in the new CSS, so the spans accumulated
  // on every click and made the button visibly grow. Hover/active CSS transitions
  // already provide the click feedback.
}

/* ═══════════════════════════════════════════════════════════════
   STAGGER animation delay for dynamic list items
══════════════════════════════════════════════════════════════ */
function applyStaggerDelay(containerSelector, delay = 0.05) {
  document.querySelectorAll(containerSelector).forEach((el, i) => {
    el.style.animationDelay = `${i * delay}s`;
  });
}

/* ═══════════════════════════════════════════════════════════════
   PATCH existing auth handlers to use loading state & validation
══════════════════════════════════════════════════════════════ */

/* Override LOGIN_FORM submit to add loading state */
LOGIN_FORM?.addEventListener('submit', async e => {
  if (!validateLoginForm()) return; // validation listener already called e.stopImmediatePropagation
  setBtnLoading(LOGIN_BTN, true);
});

/* Patch: after original submit completes, remove loading */
const _origEnterApp = enterApp;

/* Override REGISTER_FORM submit to add loading state */
REGISTER_FORM?.addEventListener('submit', async e => {
  // Only add loading if form is valid (capture listener already checked)
  if (!REGISTER_FORM.querySelector('.invalid')) {
    setBtnLoading(REGISTER_BTN, true);
  }
});

/* Remove loading from login btn after any auth response */
const _origLoginHandler = LOGIN_FORM?.onsubmit;

/* Patch enterApp to remove loading state and run post-login setup */
function patchEnterApp() {
  setTimeout(() => {
    setBtnLoading(LOGIN_BTN, false);
    setBtnLoading(REGISTER_BTN, false);
  }, 1200);
}

/* Hook into auth results */
const _originalSaveAuthToken = saveAuthToken;


/* ═══════════════════════════════════════════════════════════════
   INIT ADDITIONS - wire everything up
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  wireRegisterValidation();
  attachRipple();

  // Clear validation state when switching auth tabs.
  // NOTE: the previous implementation derived icon IDs via string-replace and
  // sometimes returned the input's own ID, causing clearFieldState to overwrite
  // the input's class to "input-icon" (which is display:none) - making the
  // register fields disappear. Use an explicit map and only touch the input's
  // valid/invalid classes; do not pass an iconId for these forms.
  const AUTH_INPUT_IDS = [
    'email-input','password-input',
    'reg-name','reg-email','reg-password','reg-confirm-password',
  ];
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      AUTH_INPUT_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('valid', 'invalid');
        const err = document.getElementById(id + '-error');
        if (err) err.textContent = '';
      });
      const wrap = document.getElementById('pw-strength-wrap');
      if (wrap) wrap.style.display = 'none';
    });
  });

  // Remove loading states after any navigation to login page
  const _origNavigateTo = navigateTo;
});

/* Show password strength bar only when reg-password has focus */
document.getElementById('reg-password')?.addEventListener('focus', () => {
  const pw   = document.getElementById('reg-password')?.value || '';
  const wrap = document.getElementById('pw-strength-wrap');
  if (wrap && pw) wrap.style.display = 'flex';
});

/* ─────────────────────────────────────────────────────────
   HELP CHAT WIDGET (Ollama-backed)
───────────────────────────────────────────────────────── */
(function () {
  const widget   = document.getElementById('chat-widget');
  const bubble   = document.getElementById('chat-bubble');
  const panel    = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const form     = document.getElementById('chat-form');
  const input    = document.getElementById('chat-input');
  const msgsBox  = document.getElementById('chat-messages');
  if (!widget || !bubble || !panel) return;

  const history = [];

  function refreshVisibility() {
    // Help is available on every page (including the public landing/login),
    // so the button is always shown.
    widget.hidden = false;
  }
  const _origNavigateTo = window.navigateTo;
  if (typeof _origNavigateTo === 'function') {
    window.navigateTo = function (k) { _origNavigateTo(k); refreshVisibility(); };
  }
  setInterval(refreshVisibility, 1500);
  refreshVisibility();

  function openPanel() {
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    bubble.setAttribute('aria-expanded', 'true');
    setTimeout(() => input.focus(), 50);
  }
  function closePanel() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    bubble.setAttribute('aria-expanded', 'false');
  }
  bubble.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
  closeBtn.addEventListener('click', closePanel);

  function appendMsg(role, text, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg--' + (role === 'user' ? 'user' : 'bot');
    const bub = document.createElement('div');
    bub.className = 'chat-msg-bubble';
    if (opts.typing) bub.classList.add('chat-typing');
    bub.textContent = text;
    wrap.appendChild(bub);
    msgsBox.appendChild(wrap);
    msgsBox.scrollTop = msgsBox.scrollHeight;
    return wrap;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    const typingEl = appendMsg('bot', '…', { typing: true });
    try {
      const r = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ messages: history }),
      });
      const d = await r.json().catch(() => ({}));
      typingEl.remove();
      if (r.status === 401) {
        appendMsg('bot', 'Please sign in to use Help.');
      } else if (r.status === 429) {
        appendMsg('bot', "You're sending messages too quickly. Please wait a minute and try again.");
      } else if (r.status === 503 || r.status === 504) {
        appendMsg('bot', d.error || 'Help assistant is offline right now.');
      } else if (r.ok && d.success) {
        appendMsg('bot', d.reply);
        history.push({ role: 'assistant', content: d.reply });
      } else {
        appendMsg('bot', d.error || 'Something went wrong. Please try again.');
      }
    } catch (_) {
      typingEl.remove();
      appendMsg('bot', 'Connection error. Please try again.');
    }
  });
})();
