/**
 * JISSR — state.js
 * Central state, DOM references, and core utility functions.
 */
'use strict';

const API = window.location.origin;

/* ── DOM REFS ─────────────────────────────────────────────────────────────── */
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

/* ── STATE ────────────────────────────────────────────────────────────────── */
const state = {
  currentPage:    'landing',
  theme:          'light',
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

/* ── AUTH HELPERS ─────────────────────────────────────────────────────────── */
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

/* ── CORE UTILITIES ───────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg,dur=2800){
  clearTimeout(toastTimer);TOAST.textContent=msg;TOAST.setAttribute('aria-hidden','false');TOAST.classList.add('show');
  toastTimer=setTimeout(()=>{TOAST.classList.remove('show');setTimeout(()=>TOAST.setAttribute('aria-hidden','true'),300);},dur);
}
function formatTime(s){return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function debounce(fn,delay){let t;return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),delay);};}
