/**
 * JISSR — avatar.js
 * Renders the 3D WebGL skeletal keypoints canvas, plays sign sequences, controls microphone audio speech-to-text, and orchestrates DOM initializations.
 */
'use strict';

/* ── SPEECH TO SIGN INPUT TAB SWITCHING ─────────────────────────────────────── */
function switchInputTab(tab) {
  const isMic = tab === 'mic';
  TAB_MIC.classList.toggle('active', isMic); TAB_KBD.classList.toggle('active', !isMic);
  TAB_MIC.setAttribute('aria-selected', isMic); TAB_KBD.setAttribute('aria-selected', !isMic);
  PANEL_MIC.classList.toggle('hidden', !isMic); PANEL_KBD.classList.toggle('hidden', isMic);
  if (!isMic && state.isMicRecording) stopMicSTT();
}

/* ── MICROPHONE & SPEECH RECOGNITION (STT) ──────────────────────────────────── */
async function startMicSTT() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) { startBrowserSTT(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    state.mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    state.recChunks = [];
    state.mediaRec.ondataavailable = e => state.recChunks.push(e.data);
    state.mediaRec.onstop = sendToElevenLabsSTT;
    state.mediaRec.start(); state.isMicRecording = true; setMicUI(true);
  } catch (e) { if (MIC_STATUS) MIC_STATUS.textContent = 'Error: ' + e.message; }
}

function stopMicSTT() {
  if (state.mediaRec && state.isMicRecording) {
    state.mediaRec.stop(); state.mediaRec.stream.getTracks().forEach(t => t.stop());
  }
  state.isMicRecording = false; setMicUI(false);
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
    if (e.results[e.results.length - 1].isFinal) state.sttText = t;
  };
  rec.onerror = e => setSttBox('Error: ' + e.error);
  rec.onend = () => {
    state.isMicRecording = false; setMicUI(false);
    if (MIC_STATUS) MIC_STATUS.textContent = 'Tap to listen';
    const useBtn = document.getElementById('btnUseText');
    if (useBtn) useBtn.disabled = !state.sttText;
  };
  rec.start(); state.isMicRecording = true; setMicUI(true);
  if (MIC_STATUS) MIC_STATUS.textContent = 'Listening… (speak now)';
}

async function sendToElevenLabsSTT() {
  const apiKey = document.getElementById('elApiKey')?.value.trim();
  const lang = document.getElementById('sttLang')?.value || 'eng';
  if (!apiKey) {
    setSttBox('Enter ElevenLabs API Key in Settings');
    if (MIC_STATUS) MIC_STATUS.textContent = 'API Key required';
    return;
  }
  const mime = state.recChunks[0]?.type || 'audio/webm';
  const blob = new Blob(state.recChunks, { type: mime });
  const ext = mime.includes('mp4') ? 'rec.mp4' : mime.includes('ogg') ? 'rec.ogg' : 'rec.webm';
  const fd = new FormData();
  fd.append('audio', blob, ext); fd.append('api_key', apiKey); fd.append('lang', lang);
  try {
    const r = await fetch(`${API}/stt-elevenlabs`, { method: 'POST', headers: authHeader(), body: fd });
    const d = await r.json();
    if (d.success) {
      state.sttText = d.transcript;
      setSttBox(d.transcript);
      const useBtn = document.getElementById('btnUseText');
      if (useBtn) useBtn.disabled = false;
    } else {
      setSttBox('Error: ' + d.error);
    }
  } catch {
    setSttBox('Connection error');
  }
  if (MIC_STATUS) MIC_STATUS.textContent = 'Tap to listen';
}

function setSttBox(text) { const b = document.getElementById('sttBox'); if (b) b.textContent = text; }

function useSTTText() {
  if (!state.sttText) { showToast('⚠️ No recognised speech yet.'); return; }
  const cleaned = state.sttText.replace(/[^؀-ۿa-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) { showToast('⚠️ No usable text after cleaning.'); return; }
  const avText = document.getElementById('avText'); if (avText) avText.value = cleaned;
  if (HEARD_TEXT) HEARD_TEXT.textContent = cleaned;
  switchInputTab('kbd'); startSigning();
}

/* ── 3D SIGNING AVATAR TIMELINE COORDINATES DRAWER ─────────────────────────── */
const avCanvas = document.getElementById('avatarCanvas');
const avCtx = avCanvas ? avCanvas.getContext('2d') : null;

async function startSigning() {
  const avText = document.getElementById('avText');
  const raw = avText?.value.trim();
  if (!raw) { showToast('⚠️ Please type something first.'); avText?.focus(); return; }
  const text = raw.replace(/[^؀-ۿa-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) { showToast('⚠️ No usable text.'); return; }
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
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ text })
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
          const fd2 = await fr.json();
          state.avQueue.push(fd2.success ? { ...item, frames: fd2.frames, fmt: fd2.format } : { ...item, frames: null });
        } catch {
          state.avQueue.push({ ...item, frames: null });
        }
      } else {
        state.avQueue.push({ ...item, frames: null });
      }
    }
    state.avCurrentIdx = 0; state.avPlaying = true;
    if (AV_STATUS_TXT) AV_STATUS_TXT.textContent = 'Signing…';
    playNextSign();
    saveTranslation('sp2s', text, text, 0);
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

function resizeAvCanvas() {
  const wrap = document.getElementById('avatarWrap'); if (!avCanvas || !wrap) return;
  const w = wrap.clientWidth || 600, h = wrap.clientHeight || 340;
  if (avCanvas.width !== w || avCanvas.height !== h) { avCanvas.width = w; avCanvas.height = h; }
}

function drawAvatarFrame(frame, fmt, label) {
  if (!avCtx || !avCanvas) return; resizeAvCanvas();
  const W = avCanvas.width, H = avCanvas.height;
  avCtx.clearRect(0, 0, W, H); avCtx.fillStyle = '#040810'; avCtx.fillRect(0, 0, W, H);
  const sc = Math.min(W, H) * 0.16, cx = W * 0.5, cy = H * 0.36;
  const proj = pt => [cx + (pt[0] || 0) * sc, cy + (pt[1] || 0) * sc];
  if (fmt === '543') {
    drawSkel543(frame.slice(POSE_OFF_543, POSE_OFF_543 + 33), frame.slice(LH_OFF_543, LH_OFF_543 + 21), frame.slice(RH_OFF_543, RH_OFF_543 + 21), proj);
  } else {
    drawSkel133(frame.slice(0, 17), frame.slice(LH_OFF_133, LH_OFF_133 + 21), frame.slice(RH_OFF_133, RH_OFF_133 + 21), proj);
  }
  avCtx.fillStyle = 'rgba(13,255,140,0.9)'; avCtx.font = 'bold 20px "Plus Jakarta Sans",sans-serif'; avCtx.textAlign = 'center';
  avCtx.fillText(label, W / 2, H - 14);
}

const nz = arr => arr.some(p => (p[0] || 0) !== 0 || (p[1] || 0) !== 0);

function drawSkel543(pose, lh, rh, proj) {
  avCtx.lineCap = 'round'; avCtx.strokeStyle = 'rgba(13,255,140,.75)'; avCtx.lineWidth = 2.5;
  BODY_CONN_543.forEach(([a, b]) => {
    if (!pose[a] || !pose[b]) return;
    const [ax, ay] = proj(pose[a]); const [bx, by] = proj(pose[b]);
    avCtx.beginPath(); avCtx.moveTo(ax, ay); avCtx.lineTo(bx, by); avCtx.stroke();
  });
  if (pose[0]) {
    const [hx, hy] = proj(pose[0]);
    avCtx.beginPath(); avCtx.arc(hx, hy, 14, 0, 2 * Math.PI);
    avCtx.strokeStyle = 'rgba(13,255,140,.65)'; avCtx.lineWidth = 2; avCtx.stroke();
    avCtx.fillStyle = 'rgba(13,255,140,.06)'; avCtx.fill();
  }
  if (nz(lh)) drawHandProj(lh, proj, '#0dff8c');
  if (nz(rh)) drawHandProj(rh, proj, '#c084fc');
}

function drawSkel133(body, lh, rh, proj) {
  avCtx.lineCap = 'round'; avCtx.strokeStyle = 'rgba(13,255,140,.75)'; avCtx.lineWidth = 2.5;
  BODY_CONN_133.forEach(([a, b]) => {
    if (!body[a] || !body[b]) return;
    const [ax, ay] = proj(body[a]); const [bx, by] = proj(body[b]);
    avCtx.beginPath(); avCtx.moveTo(ax, ay); avCtx.lineTo(bx, by); avCtx.stroke();
  });
  if (body[0]) {
    const [hx, hy] = proj(body[0]);
    avCtx.beginPath(); avCtx.arc(hx, hy, 14, 0, 2 * Math.PI);
    avCtx.strokeStyle = 'rgba(13,255,140,.65)'; avCtx.lineWidth = 2; avCtx.stroke();
    avCtx.fillStyle = 'rgba(13,255,140,.06)'; avCtx.fill();
  }
  if (nz(lh)) drawHandProj(lh, proj, '#0dff8c');
  if (nz(rh)) drawHandProj(rh, proj, '#c084fc');
}

function drawHandProj(hand, proj, color) {
  if (!hand || hand.length < 21) return;
  avCtx.strokeStyle = color + '88'; avCtx.lineWidth = 1.8; avCtx.lineCap = 'round';
  HAND_CONN.forEach(([a, b]) => {
    if (!hand[a] || !hand[b]) return;
    const [ax, ay] = proj(hand[a]); const [bx, by] = proj(hand[b]);
    avCtx.beginPath(); avCtx.moveTo(ax, ay); avCtx.lineTo(bx, by); avCtx.stroke();
  });
  avCtx.fillStyle = color;
  hand.forEach(pt => {
    const [x, y] = proj(pt);
    avCtx.beginPath(); avCtx.arc(x, y, 3, 0, 2 * Math.PI); avCtx.fill();
  });
}

function drawPlaceholder(word) {
  if (!avCtx || !avCanvas) return; resizeAvCanvas();
  const W = avCanvas.width, H = avCanvas.height;
  avCtx.clearRect(0, 0, W, H); avCtx.fillStyle = '#040810'; avCtx.fillRect(0, 0, W, H);
  avCtx.fillStyle = 'rgba(100,116,139,.5)'; avCtx.font = 'bold 48px "Plus Jakarta Sans",sans-serif'; avCtx.textAlign = 'center';
  avCtx.fillText(word, W / 2, H / 2);
  avCtx.font = '14px "DM Sans",sans-serif'; avCtx.fillStyle = 'rgba(100,116,139,.4)';
  avCtx.fillText('No sign available', W / 2, H / 2 + 40);
}

function renderWordQueue(seq, activeIdx) {
  const q = document.getElementById('wordQueue'); if (!q) return;
  q.innerHTML = '';
  seq.forEach((item, i) => {
    const sp = document.createElement('span');
    const base = 'padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid;margin:2px;display:inline-block;transition:all .3s;';
    if (i === activeIdx) sp.style.cssText = base + 'background:var(--color-accent-dim);border-color:var(--color-accent);color:var(--color-accent);transform:scale(1.05);';
    else if (i < activeIdx) sp.style.cssText = base + 'opacity:.4;border-color:var(--glass-border);color:var(--text-muted);';
    else sp.style.cssText = base + 'background:var(--glass-bg);border-color:var(--glass-border);color:var(--text-secondary);' + (item.has_anim ? '' : 'border-style:dashed;');
    sp.textContent = item.word;
    if (!item.has_anim) sp.title = 'No sign available';
    q.appendChild(sp);
  });
}

const avatarExpressions = ['🙂', '🤔', '😊', '🙂', '😐', '😊']; let avatarExpIdx = 0;

function animateAvatarFallback(text) {
  if (AV_STATUS) AV_STATUS.classList.add('active');
  if (AV_STATUS_TXT) AV_STATUS_TXT.textContent = 'Signing…';
  AVATAR_FIG.classList.add('signing');
  AV_HEAD.textContent = avatarExpressions[avatarExpIdx++ % avatarExpressions.length];
  const dur = Math.min(Math.max(text.split(' ').length * 500, 2000), 8000);
  setTimeout(() => {
    AVATAR_FIG.classList.remove('signing');
    if (AV_STATUS) AV_STATUS.classList.remove('active');
    if (AV_STATUS_TXT) AV_STATUS_TXT.textContent = 'Done';
    AV_HEAD.textContent = '🙂';
  }, dur);
}

/* ── DOM CONTENT LOADED ORCHESTRATOR ────────────────────────────────────────── */
function initAppOrchestrator() {
  // Theme and preferences initialization
  try {
    localStorage.removeItem('jissr-theme');
    state.theme = 'light';
    HTML.setAttribute('data-theme', 'light');
    if (THEME_SEG) {
      THEME_SEG.querySelectorAll('.seg-btn').forEach(btn => {
        const on = btn.dataset.theme === 'light';
        btn.classList.toggle('active', on); btn.setAttribute('aria-checked', on);
      });
    }
    const accent = localStorage.getItem('jissr-accent');
    const tsz = localStorage.getItem('jissr-textsize');
    if (accent) {
      applyAccentColor(accent);
      ACCENT_PICKER?.querySelectorAll('.accent-swatch').forEach(s => {
        const on = s.dataset.color === accent;
        s.classList.toggle('active', on); s.setAttribute('aria-pressed', on);
      });
    }
    if (tsz && TEXT_SIZE_SL) {
      TEXT_SIZE_SL.value = tsz; if (TS_OUT) TS_OUT.textContent = `${tsz}px`;
      HTML.style.setProperty('--tl-font-size', `${tsz}px`);
      const pct = ((tsz - 14) / (28 - 14)) * 100;
      TEXT_SIZE_SL.style.backgroundSize = `${pct}% 100%`;
    }
  } catch (_) {}

  // Wire up listeners from modules
  wireAuthListeners();
  wireSettingsListeners();
  wireHistoryListeners();
  wireTranslationListeners();

  // Wire up speech to sign listeners
  TAB_MIC?.addEventListener('click', () => switchInputTab('mic'));
  TAB_KBD?.addEventListener('click', () => switchInputTab('kbd'));
  MIC_BTN?.addEventListener('click', () => { if (state.isMicRecording) stopMicSTT(); else startMicSTT(); });
  document.getElementById('btnUseText')?.addEventListener('click', useSTTText);
  document.getElementById('btnSign')?.addEventListener('click', startSigning);
  
  SPEED_PILLS.forEach(pill => pill.addEventListener('click', () => {
    SPEED_PILLS.forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
    pill.classList.add('active'); pill.setAttribute('aria-pressed', 'true');
    state.playbackSpeed = parseFloat(pill.dataset.speed);
    const el = document.getElementById('avSpeed'); if (el) el.value = state.playbackSpeed;
    showToast(`⏱ Speed: ${pill.textContent}`);
  }));

  // Clean form state switches
  const AUTH_INPUT_IDS = ['email-input', 'password-input', 'reg-name', 'reg-email', 'reg-password', 'reg-confirm-password'];
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById('auth-panel-' + tab.dataset.auth);
      if (panel) panel.classList.add('active');

      AUTH_INPUT_IDS.forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        el.classList.remove('valid', 'invalid');
        const err = document.getElementById(id + '-error'); if (err) err.textContent = '';
      });
      const wrap = document.getElementById('pw-strength-wrap'); if (wrap) wrap.style.display = 'none';
    });
  });

  TOGGLE_PWD_BTN?.addEventListener('click', () => {
    const show = PASSWORD_INPUT.type === 'password';
    PASSWORD_INPUT.type = show ? 'text' : 'password';
    TOGGLE_PWD_BTN.textContent = show ? '🙈' : '👁';
  });

  TOGGLE_REG_PWD?.addEventListener('click', () => {
    const p = document.getElementById('reg-password'); if (!p) return;
    const show = p.type === 'password'; p.type = show ? 'text' : 'password';
    TOGGLE_REG_PWD.textContent = show ? '🙈' : '👁';
  });

  // Client-side real-time form validation
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
    if (confirmEl?.classList.contains('valid') || confirmEl?.classList.contains('invalid')) {
      const cErr = validateConfirmValue(pwEl.value, confirmEl.value);
      setFieldState(confirmEl, 'reg-confirm-icon', 'reg-confirm-error', !cErr, cErr);
    }
  });

  confirmEl?.addEventListener('input', () => {
    const cErr = validateConfirmValue(pwEl?.value || '', confirmEl.value);
    setFieldState(confirmEl, 'reg-confirm-icon', 'reg-confirm-error', !cErr, cErr);
  });

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

  pwEl?.addEventListener('focus', () => {
    const pw = pwEl?.value || '';
    const wrap = document.getElementById('pw-strength-wrap');
    if (wrap && pw) wrap.style.display = 'flex';
  });

  document.querySelectorAll('.toggle-input').forEach(i => {
    const t = i.closest('.toggle-track'); if (t) t.setAttribute('aria-checked', i.checked);
  });

  if (TEXT_SIZE_SL) {
    const pct = ((TEXT_SIZE_SL.value - 14) / (28 - 14)) * 100;
    TEXT_SIZE_SL.style.backgroundSize = `${pct}% 100%`;
  }

  // Google sign in trigger wiring
  GOOGLE_BTN?.addEventListener('click', triggerGoogleSignIn);
  APPLE_BTN?.addEventListener('click', () => {
    showToast('🍎 Connecting to Apple…');
    setTimeout(() => enterAppOffline('✅ Signed in with Apple!'), 800);
  });

  window.addEventListener('resize', resizeAvCanvas);

  // Verification & Auth check on load
  if (loadStoredAuth()) {
    fetch(`${API}/auth/me`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : { success: false })
      .then(d => {
        if (d.success && d.user) {
          state.user = d.user;
          updateHeaderUser(d.user);
          enterApp(null);
        } else {
          clearAuth(); navigateTo('landing');
        }
      })
      .catch(() => {
        clearAuth(); navigateTo('landing');
      });
  } else {
    navigateTo('landing');
  }

  console.log('✅ JISSR v4.0 initialised — strict auth gating active');
}

document.addEventListener('DOMContentLoaded', initAppOrchestrator);
