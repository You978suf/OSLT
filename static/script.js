/**
 * JISSR — script.js
 * JISSR SPA (navigation/login/settings/theme) merged with
 * real OSL backend API calls replacing all simulations.
 *
 * Real API routes:
 *   GET  /health                → server status + sign/avatar count
 *   POST /predict               → camera frames → sign recognition
 *   POST /predict-video         → uploaded video → sign recognition
 *   POST /tts-elevenlabs        → text → ElevenLabs audio stream
 *   POST /stt-elevenlabs        → audio → ElevenLabs Scribe transcript
 *   POST /tts                   → text → gTTS fallback audio
 *   POST /avatar/resolve        → text → [{word, sign_id, has_anim}]
 *   GET  /avatar/frames/<id>    → skeleton animation frames
 */

'use strict';

const API = window.location.origin;   // Flask runs on same origin

/* ─────────────────────────────────────────────────────────
   DOM REFS
───────────────────────────────────────────────────────── */
const HTML         = document.documentElement;
const APP_HEADER   = document.getElementById('app-header');
const BOTTOM_NAV   = document.getElementById('bottom-nav');
const PAGE_HEADING = document.getElementById('page-heading');
const TOAST        = document.getElementById('toast');

const PAGES = {
  login:    document.getElementById('login-page'),
  s2s:      document.getElementById('sign-to-speech-page'),
  sp2s:     document.getElementById('speech-to-sign-page'),
  settings: document.getElementById('settings-page'),
};

const NAV_ITEMS      = document.querySelectorAll('.nav-item');
const LOGIN_FORM     = document.getElementById('login-form');
const LOGIN_BTN      = document.getElementById('login-btn');
const GUEST_BTN      = document.getElementById('guest-btn');
const GOOGLE_BTN     = document.getElementById('google-btn');
const APPLE_BTN      = document.getElementById('apple-btn');
const TOGGLE_PWD_BTN = document.getElementById('toggle-password');
const PASSWORD_INPUT = document.getElementById('password-input');
const HEADER_THEME_BTN = document.getElementById('header-theme-btn');

// Page 2 – Sign to Speech
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
const videoEl       = document.getElementById('videoEl');     // real camera
const canvasEl      = document.getElementById('canvasEl');    // skeleton overlay

// Page 3 – Speech to Sign
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

// Settings
const THEME_SEG     = document.getElementById('theme-seg');
const ACCENT_PICKER = document.getElementById('accent-picker');
const TEXT_SIZE_SL  = document.getElementById('text-size-sl');
const TS_OUT        = document.getElementById('ts-out');
const HAPTIC_TOG    = document.getElementById('haptic-tog');
const CUES_TOG      = document.getElementById('cues-tog');
const CONTRAST_TOG  = document.getElementById('contrast-tog');
const DIALECT_SEL   = document.getElementById('dialect-sel');
const VOICE_SEL     = document.getElementById('voice-sel');
const CAM_QUAL_SEL  = document.getElementById('cam-qual-sel');
const LOGOUT_BTN    = document.getElementById('logout-btn');

/* ─────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────── */
const state = {
  currentPage:   'login',
  theme:         'dark',
  accentColor:   '#0dff8c',
  textSize:      18,
  hapticOn:      true,
  visualCuesOn:  true,
  highContrast:  false,

  // Camera / inference
  cameraReady:   false,
  isRecording:   false,
  recordSeconds: 0,
  recordInterval:null,
  rolling:       [],        // max 30 frames (was 150 in old — 3s latency not 15s)
  frameCount:    0,
  inferPending:  false,
  lastPredTime:  0,
  currentResult: null,
  liveHistory:   [],
  healthInterval:null,

  // Audio
  isPlaying:     false,
  isAutoSpeak:   false,

  // STT / Avatar
  mediaRec:      null,
  recChunks:     [],
  isMicRecording:false,
  sttText:       '',
  avPlaying:     false,
  avCurrentIdx:  0,
  avQueue:       [],
  playbackSpeed: 1,
};

// Skeleton connection tables (from working OSL code, unchanged)
const HAND_CONN = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];
const BODY_CONN_133 = [[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
const LH_OFF_133=91, RH_OFF_133=112;
const BODY_CONN_543 = [[11,13],[13,15],[12,14],[14,16],[11,12],[23,24],[11,23],[12,24],[23,25],[24,26],[25,27],[26,28]];
const POSE_OFF_543=468, LH_OFF_543=501, RH_OFF_543=522;

const PAGE_TITLES = { s2s:'Sign to Speech', sp2s:'Speech to Sign', settings:'Settings' };

// Fallback phrases (shown only when server is offline)
const SAMPLE_TL = ['Hello, how are you?','My name is…','Can you help me?','Thank you so much.','Where is the exit?','I need a doctor.'];
let simIdx = 0;

/* ─────────────────────────────────────────────────────────
   SERVER HEALTH
───────────────────────────────────────────────────────── */
async function checkServer() {
  try {
    const d = await (await fetch(`${API}/health`)).json();
    const dot = document.getElementById('srvDot');
    const lbl = document.getElementById('srvLbl');
    const wc  = document.getElementById('avWordCount');
    if (dot) dot.style.cssText = 'background:#10b981;width:7px;height:7px;border-radius:50%;display:inline-block;';
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
  Object.values(PAGES).forEach(p => p.classList.remove('active'));
  PAGES[key].classList.add('active');
  state.currentPage = key;
  if (key === 'login') {
    APP_HEADER.hidden = true;
    BOTTOM_NAV.hidden = true;
  } else {
    APP_HEADER.hidden = false;
    BOTTOM_NAV.hidden = false;
    PAGE_HEADING.textContent = PAGE_TITLES[key] || '';
  }
  updateNavActive(key);
  PAGES[key].scrollTop = 0;
  if (key !== 's2s'  && state.isRecording)   stopRecording();
  if (key !== 'sp2s' && state.isMicRecording) stopMicSTT();
}

function updateNavActive(activeKey) {
  const map = { s2s:'sign-to-speech-page', sp2s:'speech-to-sign-page', settings:'settings-page' };
  NAV_ITEMS.forEach(item => item.setAttribute('aria-current', item.dataset.target === map[activeKey] ? 'true' : 'false'));
}

NAV_ITEMS.forEach(item => item.addEventListener('click', () => {
  const key = Object.keys(PAGES).find(k => PAGES[k].id === item.dataset.target);
  if (key) navigateTo(key);
}));

HEADER_THEME_BTN.addEventListener('click', toggleTheme);

/* ─────────────────────────────────────────────────────────
   LOGIN
───────────────────────────────────────────────────────── */
LOGIN_FORM.addEventListener('submit', e => {
  e.preventDefault();
  const email = document.getElementById('email-input').value.trim();
  const pass  = PASSWORD_INPUT.value;
  if (!email || !pass) { showToast('⚠️ Please fill in all fields.'); return; }
  if (!email.includes('@')) { showToast('⚠️ Please enter a valid email.'); return; }
  LOGIN_BTN.textContent = 'Signing in…'; LOGIN_BTN.disabled = true;
  setTimeout(() => { LOGIN_BTN.textContent = 'Log In'; LOGIN_BTN.disabled = false; enterApp('✅ Welcome back!'); }, 900);
});

GUEST_BTN.addEventListener('click', () => enterApp('👋 Welcome, Guest!'));
GOOGLE_BTN.addEventListener('click', () => { showToast('🔑 Connecting to Google…'); setTimeout(() => enterApp('✅ Signed in with Google!'), 1000); });
APPLE_BTN.addEventListener('click',  () => { showToast('🍎 Connecting to Apple…');  setTimeout(() => enterApp('✅ Signed in with Apple!'),  1000); });

TOGGLE_PWD_BTN.addEventListener('click', () => {
  const show = PASSWORD_INPUT.type === 'password';
  PASSWORD_INPUT.type = show ? 'text' : 'password';
  TOGGLE_PWD_BTN.textContent = show ? '🙈' : '👁';
});

function enterApp(msg) {
  if (msg) showToast(msg);
  navigateTo('s2s');
  loadELSettings();
  initCamera();
  checkServer();
  if (!state.healthInterval) state.healthInterval = setInterval(checkServer, 30000);
}

/* ─────────────────────────────────────────────────────────
   PAGE 2: SIGN TO SPEECH — real camera + /predict
───────────────────────────────────────────────────────── */

function initCamera() {
  if (state.cameraReady || !videoEl) return;
  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then(stream => {
      videoEl.srcObject = stream;
      videoEl.removeAttribute('src');   // clear any uploaded-video src
      videoEl.load();
      videoEl.play();
      // 'camera-active' hides the guide overlay so the live feed shows through
      VIEWFINDER.classList.add('camera-active');
      state.cameraReady = true;
      const badge = document.getElementById('camBadge');
      if (badge) badge.textContent = 'Live · RTMPose';
      startFrameCapture();
    })
    .catch(e => {
      const badge = document.getElementById('camBadge');
      if (badge) badge.textContent = 'Camera: ' + e.message;
      showToast('⚠️ Camera unavailable — simulation mode active');
    });
}

function startFrameCapture() {
  // Capture 10 fps
  setInterval(() => {
    if (!state.cameraReady || !videoEl || videoEl.readyState < 2) return;
    // FIX BUG-1: renamed inner context variable (was shadowing outer ctx)
    const tmp = document.createElement('canvas');
    tmp.width  = videoEl.videoWidth  || 640;
    tmp.height = videoEl.videoHeight || 480;
    const captureCtx = tmp.getContext('2d');
    captureCtx.drawImage(videoEl, 0, 0);

    state.rolling.push(tmp.toDataURL('image/jpeg', 0.75));
    if (state.rolling.length > 30) state.rolling.shift();
    state.frameCount++;

    // Only send to backend while Record button is active
    if (state.isRecording && state.rolling.length >= 30 && state.frameCount % 15 === 0 && !state.inferPending) {
      runLiveInfer([...state.rolling]);
    }
  }, 100);

  // FIX BUG-6: only resize canvas when video dimensions actually change
  let prevW = 0, prevH = 0;
  setInterval(() => {
    if (!videoEl || !canvasEl) return;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (vw && vh && (vw !== prevW || vh !== prevH)) {
      canvasEl.width = vw; canvasEl.height = vh; prevW = vw; prevH = vh;
    }
  }, 500);
}

async function runLiveInfer(frames) {
  state.inferPending = true;
  flashRing();
  try {
    const r = await fetch(`${API}/predict`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
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
  // Debounce: skip identical result within 3 seconds
  if (state.currentResult?.arabic === top.arabic && Date.now() - state.lastPredTime < 3000) return;
  state.currentResult = top; state.lastPredTime = Date.now();

  // ── Slim overlay (just the word, always visible in viewfinder) ──
  TL_TEXT.classList.add('updating');
  setTimeout(() => { TL_TEXT.textContent = top.arabic || top.english || '—'; TL_TEXT.classList.remove('updating'); }, 200);

  // ── Output panel: top prediction card ──
  const nameEl = document.getElementById('op-top-name');
  const enEl   = document.getElementById('op-top-en');
  const dotEl  = document.getElementById('op-dot');
  if (nameEl) { nameEl.textContent = top.arabic || '—'; nameEl.classList.remove('pop'); void nameEl.offsetWidth; nameEl.classList.add('pop'); }
  // English translation from the model's label map — shown prominently
  if (enEl)   enEl.textContent = top.english || '';
  if (dotEl)  { dotEl.classList.add('live'); setTimeout(() => dotEl.classList.remove('live'), 3000); }

  // Camera badge — engine name only, no confidence number
  const badge = document.getElementById('camBadge');
  if (badge) badge.textContent = 'Live · RTMPose';

  // Viewfinder live indicator flash
  LIVE_IND.classList.add('active');
  setTimeout(() => LIVE_IND.classList.remove('active'), 2000);

  // ── Output panel: top-5 list ──
  renderTop5Panel(preds);

  // ── Output panel: history ──
  state.liveHistory.unshift({ ...top, time: new Date() });
  if (state.liveHistory.length > 30) state.liveHistory.pop();
  renderHistPanel();

  // ── Auto-Speak: immediately fires ElevenLabs TTS on every new result ──
  if (state.isAutoSpeak) {
    autoSpeakNow(top.arabic || top.english, /[\u0600-\u06FF]/.test(top.arabic || '') ? 'ar' : 'en');
  }
}

/* Render top-5 into the output panel (#op-top5) — XSS-safe, all DOM API */
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
    const name  = document.createElement('div'); name.className  = 'op-t5-name'; name.textContent = p.arabic  || '—';
    const en    = document.createElement('div'); en.className    = 'op-t5-en';   en.textContent   = p.english || '';
    words.append(name, en);

    const spk = document.createElement('button');
    spk.className = 'op-t5-spk'; spk.textContent = '🔊';
    spk.setAttribute('aria-label', `Speak: ${p.arabic || p.english}`);
    spk.addEventListener('click', e => { e.stopPropagation(); speak(row.dataset.arabic || row.dataset.english, 'ar'); });

    row.append(rank, words, spk);
    row.addEventListener('click', () => speak(row.dataset.arabic || row.dataset.english, 'ar'));
    container.appendChild(row);
  });
}

/* Render history into the output panel (#op-hist-list) */
function renderHistPanel() {
  const list  = document.getElementById('op-hist-list');
  const empty = document.getElementById('op-hist-empty');
  if (!list) return;
  if (!state.liveHistory.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  list.innerHTML = '';
  state.liveHistory.forEach(h => {
    const t  = h.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el = document.createElement('div');
    el.className = 'op-hi-row';
    el.dataset.arabic = h.arabic || '';

    const words = document.createElement('div'); words.style.flex = '1'; words.style.minWidth = '0';
    const name  = document.createElement('div'); name.className = 'op-hi-name'; name.textContent = h.arabic || '—';
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

/* Clear output history */
function clearOutputHistory() {
  state.liveHistory = [];
  const empty = document.getElementById('op-hist-empty');
  const list  = document.getElementById('op-hist-list');
  if (empty) { empty.style.display = ''; }
  if (list)  { list.innerHTML = ''; if (empty) list.appendChild(empty); }
  showToast('🗑 History cleared');
}

/* ──────────────────────────────────────────────────────────
   AUTO-SPEAK: fires immediately on each new result.
   Tries ElevenLabs TTS first → gTTS backend → Web Speech.
   Shows live status in the output panel.
────────────────────────────────────────────────────────── */
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, api_key: apiKey,
          voice_id: getVoiceId(),
          model_id: document.getElementById('elModel')?.value || 'eleven_multilingual_v2',
        }),
      });
      if (r.ok) {
        new Audio(URL.createObjectURL(await r.blob())).play();
        setAutoSpeakStatus('✓ ElevenLabs', 'speaking');
        setTimeout(() => setAutoSpeakStatus(''), 2500);
        return;
      }
      throw new Error('ElevenLabs returned ' + r.status);
    } catch (e) {
      setAutoSpeakStatus('ElevenLabs failed — trying fallback…', 'error');
    }
  } else {
    setAutoSpeakStatus('ℹ️ Add ElevenLabs API Key for natural voice', '');
  }

  // gTTS fallback
  try {
    const r = await fetch(`${API}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
    });
    if (r.ok) {
      new Audio(URL.createObjectURL(await r.blob())).play();
      setAutoSpeakStatus('✓ gTTS fallback', '');
      setTimeout(() => setAutoSpeakStatus(''), 2000);
      return;
    }
  } catch (_) {}

  // Web Speech last resort
  speakWebSpeech(text, lang);
  setAutoSpeakStatus('✓ Browser TTS fallback', '');
  setTimeout(() => setAutoSpeakStatus(''), 2000);
}

// Keep old names as aliases for safety
const renderTop5 = renderTop5Panel;
const renderHist = renderHistPanel;
const clearHist  = clearOutputHistory;

/* Record button */
RECORD_BTN.addEventListener('click', () => { if (state.isRecording) stopRecording(); else startRecording(); });

function startRecording() {
  state.isRecording = true; state.recordSeconds = 0;
  RECORD_BTN.setAttribute('aria-pressed', 'true');
  RECORD_BTN.setAttribute('aria-label', 'Stop recording');
  RECORD_LABEL.textContent = 'Stop';
  REC_BADGE.hidden = false; REC_TIMER.textContent = '00:00';
  VIEWFINDER.classList.add('recording');
  LIVE_IND.classList.add('active');
  if (state.hapticOn && navigator.vibrate) navigator.vibrate([100]);
  state.recordInterval = setInterval(() => { state.recordSeconds++; REC_TIMER.textContent = formatTime(state.recordSeconds); }, 1000);
  // Offline fallback: simulate translations if server not reachable
  if (document.getElementById('srvLbl')?.textContent.includes('offline')) {
    state.translationTimeout = setTimeout(runSimulation, 1200);
    state.translationInterval = setInterval(() => { if (state.isRecording) runSimulation(); }, 4000);
  }
  showToast('🔴 Recording started');
}

function stopRecording() {
  state.isRecording = false;
  RECORD_BTN.setAttribute('aria-pressed', 'false');
  RECORD_BTN.setAttribute('aria-label', 'Start recording');
  RECORD_LABEL.textContent = 'Record';
  REC_BADGE.hidden = true;
  VIEWFINDER.classList.remove('recording');
  LIVE_IND.classList.remove('active');
  if (state.hapticOn && navigator.vibrate) navigator.vibrate([50, 30, 50]);
  // FIX BUG-1-from-JISSR: clear the initial translationTimeout too
  clearTimeout(state.translationTimeout);
  clearInterval(state.recordInterval);
  clearInterval(state.translationInterval);
  state.translationTimeout = state.recordInterval = state.translationInterval = null;
  showToast(`⏹ Stopped — ${formatTime(state.recordSeconds)}`);
}

function runSimulation() {
  const text = SAMPLE_TL[simIdx++ % SAMPLE_TL.length];
  TL_TEXT.classList.add('updating');
  setTimeout(() => { TL_TEXT.textContent = text; TL_TEXT.classList.remove('updating'); }, 220);
  if (state.isAutoSpeak) autoSpeakNow(text, 'en');
}

/* Video upload → /predict-video */
function handleFile(e) { const f = e.target.files[0]; if (f) uploadVideo(f); }

async function uploadVideo(file) {
  if (!file.type.startsWith('video/')) { showToast('⚠️ Please select a video file.'); return; }

  // ── Show uploaded video in the viewfinder ──
  if (videoEl) {
    if (videoEl.srcObject) {                       // pause live camera
      videoEl.srcObject.getTracks().forEach(t => t.pause?.());
    }
    const previewURL = URL.createObjectURL(file);
    videoEl.srcObject = null;
    videoEl.src       = previewURL;
    videoEl.loop      = true;
    videoEl.play().catch(() => {});
    VIEWFINDER.classList.add('camera-active');     // keep guide hidden
    const badge = document.getElementById('camBadge');
    if (badge) badge.textContent = 'Video · analysing…';
  }

  const prog = document.getElementById('upProg');
  const fill = document.getElementById('upFill');
  const lbl  = document.getElementById('upLbl');
  if (prog) prog.style.display = 'block';
  if (lbl)  lbl.textContent = `Processing: ${file.name}`;
  let fake = 0;
  const tick = setInterval(() => { fake = Math.min(fake+2, 85); if (fill) fill.style.width = fake+'%'; }, 200);
  try {
    const fd = new FormData(); fd.append('video', file);
    const r  = await fetch(`${API}/predict-video`, { method:'POST', body:fd });
    const d  = await r.json();
    clearInterval(tick); if (fill) fill.style.width = '100%';
    if (d.success) {
      if (lbl) lbl.textContent = `Done — ${d.frames} frames`;
      showResult(d.predictions);
      setTimeout(() => {
        if (prog) prog.style.display = 'none';
        if (fill) fill.style.width = '0%';
        // Restore live camera after showing result
        if (videoEl) { videoEl.src = ''; videoEl.loop = false; }
        state.cameraReady = false;
        initCamera();
      }, 3000);
    } else {
      if (lbl) lbl.textContent = 'Error: ' + d.error;
      setTimeout(() => { if (prog) prog.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    clearInterval(tick);
    if (lbl) lbl.textContent = 'Connection error';
    setTimeout(() => { if (prog) prog.style.display = 'none'; }, 3000);
  }
}

/* Play button — speaks current top result via ElevenLabs → gTTS → Web Speech */
PLAY_BTN.addEventListener('click', () => {
  // Use the latest AI result, fall back to whatever is in the overlay text
  const text = state.currentResult?.arabic || state.currentResult?.english || TL_TEXT.textContent;
  if (!text || text === 'Waiting for sign input\u2026') { showToast('ℹ️ No translation to speak yet.'); return; }

  if (state.isPlaying) {
    state.isPlaying = false;
    PLAY_BTN.classList.remove('playing');
    if (PLAY_ICON)     PLAY_ICON.textContent = '▶';
    if (PLAY_WAVEFORM) PLAY_WAVEFORM.classList.remove('active');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } else {
    state.isPlaying = true;
    PLAY_BTN.classList.add('playing');
    if (PLAY_ICON)     PLAY_ICON.textContent = '■';
    if (PLAY_WAVEFORM) PLAY_WAVEFORM.classList.add('active');
    speak(text, /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en').finally(() => {
      state.isPlaying = false;
      PLAY_BTN.classList.remove('playing');
      if (PLAY_ICON)     PLAY_ICON.textContent = '▶';
      if (PLAY_WAVEFORM) PLAY_WAVEFORM.classList.remove('active');
    });
  }
});

AUTO_SPEAK.addEventListener('change', () => {
  state.isAutoSpeak = AUTO_SPEAK.checked;
  AUTO_SPEAK.closest('.toggle-track').setAttribute('aria-checked', AUTO_SPEAK.checked);
  if (AUTO_SPEAK.checked) {
    setAutoSpeakStatus('Ready — will speak each new sign via ElevenLabs');
    showToast('🔊 Auto-Speak on — ElevenLabs TTS fires on each new sign');
  } else {
    setAutoSpeakStatus('');
    showToast('🔇 Auto-Speak off');
  }
});

/* Flip camera */
let isFrontCamera = true;
FLIP_BTN.addEventListener('click', () => {
  isFrontCamera = !isFrontCamera;
  if (videoEl?.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    state.cameraReady = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: isFrontCamera ? 'user' : 'environment', width:640, height:480 } })
      .then(s => { videoEl.srcObject = s; videoEl.play(); state.cameraReady = true; VIEWFINDER.classList.add('camera-active'); })
      .catch(() => { state.cameraReady = false; });
  }
  showToast(`📷 ${isFrontCamera ? 'Front' : 'Rear'} camera`);
});

/* ─────────────────────────────────────────────────────────
   PAGE 3: SPEECH TO SIGN — real STT + /avatar/*
───────────────────────────────────────────────────────── */

/* Input tab switching */
TAB_MIC.addEventListener('click', () => switchInputTab('mic'));
TAB_KBD.addEventListener('click', () => switchInputTab('kbd'));

function switchInputTab(tab) {
  const isMic = tab === 'mic';
  TAB_MIC.classList.toggle('active', isMic);
  TAB_KBD.classList.toggle('active', !isMic);
  TAB_MIC.setAttribute('aria-selected', isMic);
  TAB_KBD.setAttribute('aria-selected', !isMic);
  PANEL_MIC.classList.toggle('hidden', !isMic);
  PANEL_KBD.classList.toggle('hidden', isMic);
  if (!isMic && state.isMicRecording) stopMicSTT();
}

/* Mic button */
MIC_BTN.addEventListener('click', () => { if (state.isMicRecording) stopMicSTT(); else startMicSTT(); });

async function startMicSTT() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    startBrowserSTT(); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // FIX BUG-7: use supported MIME type (not hardcoded 'audio/webm' which fails iOS)
    const mimes = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
    const mime  = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    state.mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    state.recChunks = [];
    state.mediaRec.ondataavailable = e => state.recChunks.push(e.data);
    state.mediaRec.onstop = sendToElevenLabsSTT;
    state.mediaRec.start();
    state.isMicRecording = true;
    setMicUI(true);
  } catch (e) { if (MIC_STATUS) MIC_STATUS.textContent = 'Error: ' + e.message; }
}

function stopMicSTT() {
  if (state.mediaRec && state.isMicRecording) {
    state.mediaRec.stop(); state.mediaRec.stream.getTracks().forEach(t => t.stop());
  }
  state.isMicRecording = false;
  setMicUI(false);
  if (MIC_STATUS) MIC_STATUS.textContent = 'Processing…';
}

function setMicUI(on) {
  MIC_BTN.setAttribute('aria-pressed', on);
  if (WAVEFORM) { WAVEFORM.hidden = !on; WAVEFORM.setAttribute('aria-hidden', !on); }
  if (MIC_STATUS) MIC_STATUS.textContent = on ? 'Listening…' : 'Tap to listen';
}

function startBrowserSTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = (document.getElementById('sttLang')?.value === 'ara') ? 'ar-OM' : 'en-US';
  rec.continuous = false; rec.interimResults = true;
  setSttBox('Listening…');
  rec.onresult = e => {
    const t = [...e.results].map(r => r[0].transcript).join('');
    setSttBox(t);
    if (e.results[e.results.length-1].isFinal) state.sttText = t;
  };
  rec.onerror = e => setSttBox('Error: ' + e.error);
  rec.onend   = () => {
    state.isMicRecording = false; setMicUI(false);
    if (MIC_STATUS) MIC_STATUS.textContent = 'Tap to listen';
    const useBtn = document.getElementById('btnUseText');
    if (useBtn) useBtn.disabled = !state.sttText;
  };
  rec.start();
  state.isMicRecording = true; setMicUI(true);
  if (MIC_STATUS) MIC_STATUS.textContent = 'Listening… (speak now)';
}

async function sendToElevenLabsSTT() {
  const apiKey = document.getElementById('elApiKey')?.value.trim();
  const lang   = document.getElementById('sttLang')?.value || 'eng';
  if (!apiKey) { setSttBox('Enter ElevenLabs API Key in Settings'); if (MIC_STATUS) MIC_STATUS.textContent = 'API Key required'; return; }
  const mime  = state.recChunks[0]?.type || 'audio/webm';
  const blob  = new Blob(state.recChunks, { type: mime });
  const ext   = mime.includes('mp4') ? 'rec.mp4' : mime.includes('ogg') ? 'rec.ogg' : 'rec.webm';
  const fd    = new FormData();
  fd.append('audio', blob, ext); fd.append('api_key', apiKey); fd.append('lang', lang);
  try {
    const r = await fetch(`${API}/stt-elevenlabs`, { method:'POST', body:fd });
    const d = await r.json();
    if (d.success) {
      state.sttText = d.transcript; setSttBox(d.transcript);
      const useBtn = document.getElementById('btnUseText');
      if (useBtn) useBtn.disabled = false;
    } else { setSttBox('Error: ' + d.error); }
  } catch { setSttBox('Connection error'); }
  if (MIC_STATUS) MIC_STATUS.textContent = 'Tap to listen';
}

function setSttBox(text) {
  const b = document.getElementById('sttBox');
  if (b) b.textContent = text;
}

function useSTTText() {
  if (!state.sttText) { showToast('⚠️ No recognised speech yet — tap the mic first.'); return; }

  // Strip punctuation and any non-letter characters — keep Arabic, Latin, spaces
  const cleaned = state.sttText
    .replace(/[^\u0600-\u06FFa-zA-Z\s]/g, ' ')  // keep Arabic + Latin letters + spaces
    .replace(/\s+/g, ' ')                         // collapse multiple spaces
    .trim();

  if (!cleaned) { showToast('⚠️ No usable text after cleaning.'); return; }

  const avText = document.getElementById('avText');
  if (avText) avText.value = cleaned;
  if (HEARD_TEXT) HEARD_TEXT.textContent = cleaned;
  // Switch to keyboard tab so user sees the cleaned text, then sign immediately
  switchInputTab('kbd');
  startSigning();
}

/* Avatar — /avatar/resolve + /avatar/frames/<id> */
const avCanvas = document.getElementById('avatarCanvas');
const avCtx    = avCanvas ? avCanvas.getContext('2d') : null;

async function startSigning() {
  const avText = document.getElementById('avText');
  const raw  = avText?.value.trim();
  if (!raw) { showToast('⚠️ Please type something first.'); avText?.focus(); return; }

  // Strip punctuation / non-letters — avatar only works on clean words
  const text = raw
    .replace(/[^\u0600-\u06FFa-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) { showToast('⚠️ No usable text after cleaning.'); return; }
  // Show the cleaned version in the textarea too
  if (avText) avText.value = text;

  const btnSign = document.getElementById('btnSign');
  if (btnSign) btnSign.disabled = true;
  const idleEl = document.getElementById('avatarIdle');
  if (idleEl) idleEl.style.display = 'none';
  if (AV_STATUS) AV_STATUS.classList.add('active');
  if (AV_STATUS_TXT) AV_STATUS_TXT.textContent = 'Resolving signs…';
  if (HEARD_TEXT) HEARD_TEXT.textContent = text;

  try {
    const r = await fetch(`${API}/avatar/resolve`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}),
    });
    const d = await r.json();
    if (!d.success) { showToast('⚠️ Could not resolve text.'); if (btnSign) btnSign.disabled = false; return; }

    const seq = d.sequence;
    renderWordQueue(seq, 0);

    state.avQueue = [];
    for (const item of seq) {
      if (item.has_anim && item.sign_id) {
        try {
          const fr = await fetch(`${API}/avatar/frames/${item.sign_id}`);
          const fd = await fr.json();
          state.avQueue.push(fd.success ? {...item, frames:fd.frames, fmt:fd.format} : {...item, frames:null});
        } catch { state.avQueue.push({...item, frames:null}); }
      } else { state.avQueue.push({...item, frames:null}); }
    }

    state.avCurrentIdx = 0; state.avPlaying = true;
    if (AV_STATUS_TXT) AV_STATUS_TXT.textContent = 'Signing…';
    playNextSign();
  } catch {
    showToast('⚠️ Server unavailable — using CSS avatar');
    if (btnSign) btnSign.disabled = false;
    animateAvatarFallback(text);
  }
}

async function playNextSign() {
  if (state.avCurrentIdx >= state.avQueue.length) {
    state.avPlaying = false;
    const btnSign = document.getElementById('btnSign');
    if (btnSign) btnSign.disabled = false;
    if (AV_STATUS) AV_STATUS.classList.remove('active');
    if (AV_STATUS_TXT) AV_STATUS_TXT.textContent = 'Done — ready for new input';
    return;
  }
  const item = state.avQueue[state.avCurrentIdx];
  renderWordQueue(state.avQueue, state.avCurrentIdx);

  if (!item.frames) { drawPlaceholder(item.word); await sleep(700); state.avCurrentIdx++; playNextSign(); return; }

  const msPerFrame = 1000 / (30 * state.playbackSpeed);
  for (let f = 0; f < item.frames.length; f++) {
    if (!state.avPlaying) break;
    drawAvatarFrame(item.frames[f], item.fmt, item.word);
    await sleep(msPerFrame);
  }
  state.avCurrentIdx++; playNextSign();
}

/* Skeleton rendering — unchanged from working OSL code */
function resizeAvCanvas() {
  const wrap = document.getElementById('avatarWrap');
  if (!avCanvas || !wrap) return;
  const w = wrap.clientWidth||600, h = wrap.clientHeight||340;
  if (avCanvas.width!==w || avCanvas.height!==h) { avCanvas.width=w; avCanvas.height=h; }
}

function drawAvatarFrame(frame, fmt, label) {
  if (!avCtx||!avCanvas) return;
  resizeAvCanvas();
  const W=avCanvas.width, H=avCanvas.height;
  avCtx.clearRect(0,0,W,H); avCtx.fillStyle='#0a0f1a'; avCtx.fillRect(0,0,W,H);
  const sc=Math.min(W,H)*0.16, cx=W*0.5, cy=H*0.36;
  const proj=pt=>[cx+(pt[0]||0)*sc, cy+(pt[1]||0)*sc];
  if (fmt==='543') {
    drawSkel543(frame.slice(POSE_OFF_543,POSE_OFF_543+33), frame.slice(LH_OFF_543,LH_OFF_543+21), frame.slice(RH_OFF_543,RH_OFF_543+21), proj);
  } else {
    drawSkel133(frame.slice(0,17), frame.slice(LH_OFF_133,LH_OFF_133+21), frame.slice(RH_OFF_133,RH_OFF_133+21), proj);
  }
  avCtx.fillStyle='rgba(13,255,140,0.9)'; avCtx.font='bold 20px "Plus Jakarta Sans",sans-serif'; avCtx.textAlign='center';
  avCtx.fillText(label, W/2, H-14);
}

const nz = arr => arr.some(p=>(p[0]||0)!==0||(p[1]||0)!==0);

function drawSkel543(pose,lh,rh,proj){
  avCtx.lineCap='round'; avCtx.strokeStyle='rgba(13,255,140,.75)'; avCtx.lineWidth=2.5;
  BODY_CONN_543.forEach(([a,b])=>{if(!pose[a]||!pose[b])return;const[ax,ay]=proj(pose[a]);const[bx,by]=proj(pose[b]);avCtx.beginPath();avCtx.moveTo(ax,ay);avCtx.lineTo(bx,by);avCtx.stroke();});
  if(pose[0]){const[hx,hy]=proj(pose[0]);avCtx.beginPath();avCtx.arc(hx,hy,14,0,2*Math.PI);avCtx.strokeStyle='rgba(13,255,140,.65)';avCtx.lineWidth=2;avCtx.stroke();avCtx.fillStyle='rgba(13,255,140,.06)';avCtx.fill();}
  if(nz(lh))drawHandProj(lh,proj,'#0dff8c');if(nz(rh))drawHandProj(rh,proj,'#c084fc');
}
function drawSkel133(body,lh,rh,proj){
  avCtx.lineCap='round'; avCtx.strokeStyle='rgba(13,255,140,.75)'; avCtx.lineWidth=2.5;
  BODY_CONN_133.forEach(([a,b])=>{if(!body[a]||!body[b])return;const[ax,ay]=proj(body[a]);const[bx,by]=proj(body[b]);avCtx.beginPath();avCtx.moveTo(ax,ay);avCtx.lineTo(bx,by);avCtx.stroke();});
  if(body[0]){const[hx,hy]=proj(body[0]);avCtx.beginPath();avCtx.arc(hx,hy,14,0,2*Math.PI);avCtx.strokeStyle='rgba(13,255,140,.65)';avCtx.lineWidth=2;avCtx.stroke();avCtx.fillStyle='rgba(13,255,140,.06)';avCtx.fill();}
  if(nz(lh))drawHandProj(lh,proj,'#0dff8c');if(nz(rh))drawHandProj(rh,proj,'#c084fc');
}
function drawHandProj(hand,proj,color){
  if(!hand||hand.length<21)return;
  avCtx.strokeStyle=color+'88';avCtx.lineWidth=1.8;avCtx.lineCap='round';
  HAND_CONN.forEach(([a,b])=>{if(!hand[a]||!hand[b])return;const[ax,ay]=proj(hand[a]);const[bx,by]=proj(hand[b]);avCtx.beginPath();avCtx.moveTo(ax,ay);avCtx.lineTo(bx,by);avCtx.stroke();});
  avCtx.fillStyle=color;
  hand.forEach(pt=>{const[x,y]=proj(pt);avCtx.beginPath();avCtx.arc(x,y,3,0,2*Math.PI);avCtx.fill();});
}
function drawPlaceholder(word){
  if(!avCtx||!avCanvas)return;resizeAvCanvas();
  const W=avCanvas.width,H=avCanvas.height;avCtx.clearRect(0,0,W,H);avCtx.fillStyle='#0a0f1a';avCtx.fillRect(0,0,W,H);
  avCtx.fillStyle='rgba(100,116,139,.5)';avCtx.font='bold 48px "Plus Jakarta Sans",sans-serif';avCtx.textAlign='center';avCtx.fillText(word,W/2,H/2);
  avCtx.font='14px "DM Sans",sans-serif';avCtx.fillStyle='rgba(100,116,139,.4)';avCtx.fillText('No sign available',W/2,H/2+40);
}
function renderWordQueue(seq,activeIdx){
  const q=document.getElementById('wordQueue');if(!q)return;q.innerHTML='';
  seq.forEach((item,i)=>{
    const sp=document.createElement('span');
    const base='padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid;margin:2px;display:inline-block;transition:all .3s;';
    if(i===activeIdx)sp.style.cssText=base+'background:var(--color-accent-dim);border-color:var(--color-accent);color:var(--color-accent);transform:scale(1.05);';
    else if(i<activeIdx)sp.style.cssText=base+'opacity:.4;border-color:var(--border-default);color:var(--text-muted);';
    else sp.style.cssText=base+'background:var(--bg-elevated);border-color:var(--border-default);color:var(--text-secondary);'+(item.has_anim?'':'border-style:dashed;');
    sp.textContent=item.word;if(!item.has_anim)sp.title='No sign available';
    q.appendChild(sp);
  });
}

/* CSS avatar fallback */
const avatarExpressions=['🙂','🤔','😊','🙂','😐','😊']; let avatarExpIdx=0;
function animateAvatarFallback(text){
  if(AV_STATUS)AV_STATUS.classList.add('active');if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Signing…';
  AVATAR_FIG.classList.add('signing');AV_HEAD.textContent=avatarExpressions[avatarExpIdx++%avatarExpressions.length];
  const dur=Math.min(Math.max(text.split(' ').length*500,2000),8000);
  setTimeout(()=>{AVATAR_FIG.classList.remove('signing');if(AV_STATUS)AV_STATUS.classList.remove('active');if(AV_STATUS_TXT)AV_STATUS_TXT.textContent='Done';AV_HEAD.textContent='🙂';},dur);
}

/* Speed pills */
SPEED_PILLS.forEach(pill=>pill.addEventListener('click',()=>{
  SPEED_PILLS.forEach(p=>{p.classList.remove('active');p.setAttribute('aria-pressed','false');});
  pill.classList.add('active');pill.setAttribute('aria-pressed','true');
  state.playbackSpeed=parseFloat(pill.dataset.speed);
  const el=document.getElementById('avSpeed');if(el)el.value=state.playbackSpeed;
  showToast(`⏱ Speed: ${pill.textContent}`);
}));

/* ─────────────────────────────────────────────────────────
   SHARED: speak() — ElevenLabs → gTTS → Web Speech API
───────────────────────────────────────────────────────── */
async function speak(text, lang='en') {
  const apiKey=document.getElementById('elApiKey')?.value.trim();
  if(apiKey){
    try{
      const r=await fetch(`${API}/tts-elevenlabs`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text,api_key:apiKey,voice_id:getVoiceId(),model_id:document.getElementById('elModel')?.value||'eleven_multilingual_v2'})});
      if(r.ok){new Audio(URL.createObjectURL(await r.blob())).play();return;}
    }catch(_){}
  }
  try{
    const r=await fetch(`${API}/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang})});
    if(r.ok){new Audio(URL.createObjectURL(await r.blob())).play();return;}
  }catch(_){}
  speakWebSpeech(text,lang);
}

function speakWebSpeech(text,lang='en'){
  if(!('speechSynthesis' in window))return;
  const u=new SpeechSynthesisUtterance(text);
  u.lang=/[\u0600-\u06FF]/.test(text)||lang==='ar'?'ar-OM':'en-US'; u.rate=0.95;
  const voicePref=VOICE_SEL?.value||'f1';
  const voices=window.speechSynthesis.getVoices();
  if(voices.length){
    const f=voices.find(v=>v.name.toLowerCase().includes('female')||v.name.toLowerCase().includes('samantha'));
    const m=voices.find(v=>v.name.toLowerCase().includes('male')||v.name.toLowerCase().includes('daniel'));
    if(voicePref.startsWith('f')&&f)u.voice=f;
    if(voicePref.startsWith('m')&&m)u.voice=m;
  }
  speechSynthesis.cancel();speechSynthesis.speak(u);
}

function getVoiceId(){
  const sel=document.getElementById('elVoiceId');
  return sel?.value==='custom'?(document.getElementById('elVoiceCustom')?.value||''):(sel?.value||'21m00Tcm4TlvDq8ikWAM');
}

/* ─────────────────────────────────────────────────────────
   ELEVENLABS SETTINGS
───────────────────────────────────────────────────────── */
function loadELSettings(){
  const api=document.getElementById('elApiKey'); if(api)api.value=localStorage.getItem('el_api_key')||'';
  const mod=document.getElementById('elModel');  if(mod)mod.value=localStorage.getItem('el_model')||'eleven_multilingual_v2';
  const v=localStorage.getItem('el_voice_id')||'21m00Tcm4TlvDq8ikWAM';
  const sel=document.getElementById('elVoiceId');
  if(sel){const opt=[...sel.options].find(o=>o.value===v);if(opt){sel.value=v;}else{sel.value='custom';const cu=document.getElementById('elVoiceCustom');if(cu){cu.value=v;cu.style.display='';}const row=document.getElementById('elVoiceCustomRow');if(row)row.style.display='block';}}
}

function saveELSettings(){
  const api=document.getElementById('elApiKey');if(api)localStorage.setItem('el_api_key',api.value);
  const mod=document.getElementById('elModel');if(mod)localStorage.setItem('el_model',mod.value);
  const sel=document.getElementById('elVoiceId');
  if(sel){
    if(sel.value==='custom'){const row=document.getElementById('elVoiceCustomRow');if(row)row.style.display='block';const cu=document.getElementById('elVoiceCustom');localStorage.setItem('el_voice_id',cu?.value||'');}
    else{const row=document.getElementById('elVoiceCustomRow');if(row)row.style.display='none';localStorage.setItem('el_voice_id',sel.value);}
  }
}

/* ─────────────────────────────────────────────────────────
   SETTINGS PAGE — theme, accent, text size, toggles
───────────────────────────────────────────────────────── */
function toggleTheme(){applyTheme(state.theme==='dark'?'light':'dark');}

function applyTheme(theme){
  state.theme=theme; HTML.setAttribute('data-theme',theme);
  if(THEME_SEG)THEME_SEG.querySelectorAll('.seg-btn').forEach(btn=>{const on=btn.dataset.theme===theme;btn.classList.toggle('active',on);btn.setAttribute('aria-checked',on);});
  HEADER_THEME_BTN.querySelector('.theme-icon').textContent=theme==='dark'?'🌙':'☀️';
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='dark'?'#0b0f1a':'#f0f4ff';
  showToast(theme==='dark'?'🌙 Dark mode':'☀️ Light mode');
  try{localStorage.setItem('jissr-theme',theme);}catch(_){}
}
if(THEME_SEG)THEME_SEG.querySelectorAll('.seg-btn').forEach(btn=>btn.addEventListener('click',()=>applyTheme(btn.dataset.theme)));

if(ACCENT_PICKER)ACCENT_PICKER.querySelectorAll('.accent-swatch').forEach(sw=>sw.addEventListener('click',()=>{
  ACCENT_PICKER.querySelectorAll('.accent-swatch').forEach(s=>{s.classList.remove('active');s.setAttribute('aria-pressed','false');});
  sw.classList.add('active');sw.setAttribute('aria-pressed','true');
  applyAccentColor(sw.dataset.color);showToast('🎨 Accent color updated');
}));

function applyAccentColor(hex){
  state.accentColor=hex; HTML.style.setProperty('--color-accent',hex);
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(m){const rgb=`${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}`;HTML.style.setProperty('--color-accent-dim',`rgba(${rgb},.12)`);HTML.style.setProperty('--color-accent-glow',`rgba(${rgb},.35)`);}
  try{localStorage.setItem('jissr-accent',hex);}catch(_){}
}

if(TEXT_SIZE_SL)TEXT_SIZE_SL.addEventListener('input',debounce(()=>{
  const sz=TEXT_SIZE_SL.value;state.textSize=parseInt(sz,10);
  if(TS_OUT)TS_OUT.textContent=`${sz}px`;TEXT_SIZE_SL.setAttribute('aria-valuenow',sz);
  HTML.style.setProperty('--tl-font-size',`${sz}px`);
  const pct=((sz-14)/(28-14))*100;TEXT_SIZE_SL.style.backgroundSize=`${pct}% 100%`;
  try{localStorage.setItem('jissr-textsize',sz);}catch(_){}
},60));

[HAPTIC_TOG,CUES_TOG,CONTRAST_TOG].forEach(tog=>{
  if(!tog)return;
  tog.addEventListener('change',()=>{
    const track=tog.closest('.toggle-track');if(track)track.setAttribute('aria-checked',tog.checked);
    if(tog.id==='haptic-tog'){state.hapticOn=tog.checked;showToast(tog.checked?'📳 Haptic on':'📴 Haptic off');}
    if(tog.id==='cues-tog'){state.visualCuesOn=tog.checked;showToast(tog.checked?'👁 Visual cues on':'👁 Visual cues off');}
    if(tog.id==='contrast-tog'){state.highContrast=tog.checked;HTML.setAttribute('data-high-contrast',tog.checked);showToast(tog.checked?'⚡ High contrast on':'⚡ High contrast off');}
  });
});

if(DIALECT_SEL)DIALECT_SEL.addEventListener('change',()=>showToast(`🌐 Dialect: ${DIALECT_SEL.options[DIALECT_SEL.selectedIndex].text.split('—')[0].trim()}`));
if(VOICE_SEL)  VOICE_SEL.addEventListener('change',()=>showToast(`🔊 Voice: ${VOICE_SEL.options[VOICE_SEL.selectedIndex].text.split('—')[0].trim()}`));
if(CAM_QUAL_SEL)CAM_QUAL_SEL.addEventListener('change',()=>showToast(`📷 Camera: ${CAM_QUAL_SEL.value.toUpperCase()}`));

if(LOGOUT_BTN)LOGOUT_BTN.addEventListener('click',()=>{
  if(videoEl?.srcObject){videoEl.srcObject.getTracks().forEach(t=>t.stop());videoEl.srcObject=null;}
  state.cameraReady=false;
  if(state.healthInterval){clearInterval(state.healthInterval);state.healthInterval=null;}
  showToast('👋 Signed out');setTimeout(()=>navigateTo('login'),700);
});

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
  try{
    const theme=localStorage.getItem('jissr-theme');const accent=localStorage.getItem('jissr-accent');const tsz=localStorage.getItem('jissr-textsize');
    if(theme)applyTheme(theme);
    if(accent){applyAccentColor(accent);ACCENT_PICKER?.querySelectorAll('.accent-swatch').forEach(s=>{const on=s.dataset.color===accent;s.classList.toggle('active',on);s.setAttribute('aria-pressed',on);});}
    if(tsz&&TEXT_SIZE_SL){TEXT_SIZE_SL.value=tsz;if(TS_OUT)TS_OUT.textContent=`${tsz}px`;HTML.style.setProperty('--tl-font-size',`${tsz}px`);const pct=((tsz-14)/(28-14))*100;TEXT_SIZE_SL.style.backgroundSize=`${pct}% 100%`;}
  }catch(_){}
  document.querySelectorAll('.toggle-input').forEach(i=>{const t=i.closest('.toggle-track');if(t)t.setAttribute('aria-checked',i.checked);});
  if(TEXT_SIZE_SL){const pct=((TEXT_SIZE_SL.value-14)/(28-14))*100;TEXT_SIZE_SL.style.backgroundSize=`${pct}% 100%`;}
  window.addEventListener('resize',resizeAvCanvas);
  window.addEventListener('beforeunload',()=>{try{localStorage.setItem('jissr-settings',JSON.stringify({theme:state.theme,accentColor:state.accentColor,textSize:state.textSize}));}catch(_){}});
  navigateTo('login');
  console.log('✅ JISSR initialised');
}

document.addEventListener('DOMContentLoaded',init);
