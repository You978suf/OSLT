/**
 * JISSR — translation.js
 * Orchestrates webcam operations, frame capturing, live RTMPose/UniSign inference pipelines, and text-to-speech audio rendering.
 */
'use strict';

/* ── CAMERA INITIALIZATION ─────────────────────────────────────────────────── */
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
      showToast('⚠️ Camera unavailable — simulation mode active');
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

/* ── LIVE ML INFERENCE PIPELINE ──────────────────────────────────────────────── */
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
  setTimeout(() => { TL_TEXT.textContent = top.arabic || top.english || '—'; TL_TEXT.classList.remove('updating'); }, 200);

  const nameEl = document.getElementById('op-top-name');
  const enEl   = document.getElementById('op-top-en');
  const dotEl  = document.getElementById('op-dot');
  if (nameEl) { nameEl.textContent = top.arabic || '—'; nameEl.classList.remove('pop'); void nameEl.offsetWidth; nameEl.classList.add('pop'); }
  if (enEl)   enEl.textContent = top.english || '';
  if (dotEl)  { dotEl.classList.add('live'); setTimeout(() => dotEl.classList.remove('live'), 3000); }

  LIVE_IND.classList.add('active');
  setTimeout(() => LIVE_IND.classList.remove('active'), 2000);

  renderTop5Panel(preds);

  state.liveHistory.unshift({ ...top, time: new Date() });
  if (state.liveHistory.length > 30) state.liveHistory.pop();
  renderHistPanel();

  // Save to SQLite
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
    const name  = document.createElement('div'); name.className  = 'op-t5-name'; name.textContent = p.arabic  || '—';
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

function clearOutputHistory() {
  state.liveHistory = [];
  const empty = document.getElementById('op-hist-empty');
  const list  = document.getElementById('op-hist-list');
  if (empty) { empty.style.display = ''; }
  if (list)  { list.innerHTML = ''; if (empty) list.appendChild(empty); }
  showToast('🗑 History cleared');
}

/* ── CAMERA RECORDING CONTROLS ──────────────────────────────────────────────── */
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
  showToast(`⏹ Stopped — ${formatTime(state.recordSeconds)}`);
}

function runSimulation() {
  const text=SAMPLE_TL[simIdx++%SAMPLE_TL.length];
  TL_TEXT.classList.add('updating');
  setTimeout(()=>{ TL_TEXT.textContent=text; TL_TEXT.classList.remove('updating'); },220);
  if (state.isAutoSpeak) autoSpeakNow(text,'en');
}

/* ── FILE UPLOADER CONTROLS ─────────────────────────────────────────────────── */
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
      if(lbl)lbl.textContent=`Done — ${d.frames} frames`;
      showResult(d.predictions);
      setTimeout(()=>{
        if(prog)prog.style.display='none'; if(fill)fill.style.width='0%';
        if(videoEl){videoEl.src='';videoEl.loop=false;}
        state.cameraReady=false; initCamera();
      },3000);
    } else { if(lbl)lbl.textContent='Error: '+d.error; setTimeout(()=>{ if(prog)prog.style.display='none'; },3000); }
  } catch { clearInterval(tick); if(lbl)lbl.textContent='Connection error'; setTimeout(()=>{ if(prog)prog.style.display='none'; },3000); }
}

/* ── TEXT TO SPEECH (TTS) CONTROLS ────────────────────────────────────────────── */
async function speak(text,lang='en'){
  const apiKey=document.getElementById('elApiKey')?.value.trim();
  if(apiKey){
    try {
      const r=await fetch(`${API}/tts-elevenlabs`,{
        method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},
        body:JSON.stringify({text,api_key:apiKey,voice_id:getVoiceId(),model_id:document.getElementById('elModel')?.value||'eleven_multilingual_v2'})
      });
      if(r.ok){ new Audio(URL.createObjectURL(await r.blob())).play(); return; }
    } catch (_) {}
  }
  try {
    const r=await fetch(`${API}/tts`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text,lang})});
    if(r.ok){ new Audio(URL.createObjectURL(await r.blob())).play(); return; }
  } catch (_) {}
  speakWebSpeech(text,lang);
}

function speakWebSpeech(text,lang='en'){
  if(!('speechSynthesis' in window))return;
  const u=new SpeechSynthesisUtterance(text);
  u.lang=/[؀-ۿ]/.test(text)||lang==='ar'?'ar-OM':'en-US';
  u.rate=0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function getVoiceId(){
  const sel=document.getElementById('elVoiceId');
  return sel?.value==='custom'?(document.getElementById('elVoiceCustom')?.value||''):(sel?.value||'21m00Tcm4TlvDq8ikWAM');
}

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
    } catch { setAutoSpeakStatus('ElevenLabs failed — trying fallback…','error'); }
  } else {
    setAutoSpeakStatus('ℹ️ Add ElevenLabs API Key for natural voice','');
  }
  try {
    const r = await fetch(`${API}/tts`,{method:'POST',headers:{'Content-Type':'application/json', ...authHeader()},body:JSON.stringify({text,lang})});
    if (r.ok) { new Audio(URL.createObjectURL(await r.blob())).play(); setAutoSpeakStatus('✓ gTTS fallback',''); setTimeout(()=>setAutoSpeakStatus(''),2000); return; }
  } catch(_) {}
  speakWebSpeech(text,lang); setAutoSpeakStatus('✓ Browser TTS',''); setTimeout(()=>setAutoSpeakStatus(''),2000);
}

/* ── WIRE UP LIVE TRANSLATION EVENT LISTENERS ─────────────────────────────────── */
function wireTranslationListeners() {
  RECORD_BTN?.addEventListener('click', () => { if (state.isRecording) stopRecording(); else startRecording(); });

  PLAY_BTN?.addEventListener('click', () => {
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

  AUTO_SPEAK?.addEventListener('change', () => {
    state.isAutoSpeak=AUTO_SPEAK.checked;
    AUTO_SPEAK.closest('.toggle-track').setAttribute('aria-checked',AUTO_SPEAK.checked);
    if(AUTO_SPEAK.checked){setAutoSpeakStatus('Ready — will speak each new sign');showToast('🔊 Auto-Speak on');}
    else{setAutoSpeakStatus('');showToast('🔇 Auto-Speak off');}
  });

  let isFrontCamera=true;
  FLIP_BTN?.addEventListener('click', () => {
    isFrontCamera=!isFrontCamera;
    if(videoEl?.srcObject){
      videoEl.srcObject.getTracks().forEach(t=>t.stop()); state.cameraReady=false;
      navigator.mediaDevices.getUserMedia({video:{facingMode:isFrontCamera?'user':'environment',width:640,height:480}})
        .then(s=>{videoEl.srcObject=s;videoEl.play();state.cameraReady=true;VIEWFINDER.classList.add('camera-active');})
        .catch(()=>{state.cameraReady=false;});
    }
    showToast(`📷 ${isFrontCamera?'Front':'Rear'} camera`);
  });
}
