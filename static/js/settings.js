/**
 * JISSR — settings.js
 * Synchronizes client options (text size, accents, camera preferences, ElevenLabs API configuration) with SQLite.
 */
'use strict';

/* ── SETTINGS ← DB ─────────────────────────────────────────────────────────── */
async function loadSettingsFromDB() {
  if (!state.authToken) return;
  try {
    const r = await fetch(`${API}/settings`, { headers: authHeader() });
    const d = await r.json();
    if (!d.success) return;
    const s = d.settings;
    if (s.theme)         applyTheme(s.theme);
    if (s.accent_color)  {
      applyAccentColor(s.accent_color);
      ACCENT_PICKER?.querySelectorAll('.accent-swatch').forEach(sw => {
        const on = sw.dataset.color === s.accent_color;
        sw.classList.toggle('active', on);
        sw.setAttribute('aria-pressed', on);
      });
    }
    if (s.text_size && TEXT_SIZE_SL) {
      TEXT_SIZE_SL.value = s.text_size;
      if (TS_OUT) TS_OUT.textContent = s.text_size + 'px';
      HTML.style.setProperty('--tl-font-size', s.text_size + 'px');
      const pct=((s.text_size-14)/(28-14))*100;
      TEXT_SIZE_SL.style.backgroundSize = pct + '% 100%';
    }
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

/* ── ELEVENLABS SETTINGS ────────────────────────────────────────────────────── */
function loadELSettings(){
  const api = document.getElementById('elApiKey'); if(api)api.value=localStorage.getItem('el_api_key')||'';
  const mod = document.getElementById('elModel');  if(mod)mod.value=localStorage.getItem('el_model')||'eleven_multilingual_v2';
  const v = localStorage.getItem('el_voice_id')||'21m00Tcm4TlvDq8ikWAM';
  const sel = document.getElementById('elVoiceId');
  if(sel){
    const opt = [...sel.options].find(o=>o.value===v);
    if(opt) sel.value=v;
    else {
      sel.value='custom';
      const cu=document.getElementById('elVoiceCustom'); if(cu)cu.value=v;
      const row=document.getElementById('elVoiceCustomRow'); if(row)row.style.display='block';
    }
  }
}

function saveELSettings(){
  const api=document.getElementById('elApiKey'); if(api)localStorage.setItem('el_api_key',api.value);
  const mod=document.getElementById('elModel');  if(mod)localStorage.setItem('el_model',mod.value);
  const sel=document.getElementById('elVoiceId');
  if(sel){
    if(sel.value==='custom'){
      const row=document.getElementById('elVoiceCustom');
      const rowDiv=document.getElementById('elVoiceCustomRow'); if(rowDiv)rowDiv.style.display='block';
      localStorage.setItem('el_voice_id',row?.value||'');
    } else {
      const rowDiv=document.getElementById('elVoiceCustomRow'); if(rowDiv)rowDiv.style.display='none';
      localStorage.setItem('el_voice_id',sel.value);
    }
  }
  const dbData = {};
  const apiEl=document.getElementById('elApiKey'); if(apiEl) dbData.el_api_key=apiEl.value;
  const modEl=document.getElementById('elModel');  if(modEl) dbData.el_model=modEl.value;
  if(sel&&sel.value!=='custom') dbData.el_voice_id=sel.value;
  saveSettingsToDB(dbData);
}

/* ── WIRE UP PREFERENCES EVENTS ─────────────────────────────────────────────── */
function wireSettingsListeners() {
  if (ACCENT_PICKER) {
    ACCENT_PICKER.querySelectorAll('.accent-swatch').forEach(sw => sw.addEventListener('click', () => {
      ACCENT_PICKER.querySelectorAll('.accent-swatch').forEach(s => {
        s.classList.remove('active'); s.setAttribute('aria-pressed', 'false');
      });
      sw.classList.add('active'); sw.setAttribute('aria-pressed', 'true');
      applyAccentColor(sw.dataset.color);
      showToast('🎨 Accent color updated');
      saveSettingsToDB({ accent_color: sw.dataset.color });
    }));
  }

  if (TEXT_SIZE_SL) {
    TEXT_SIZE_SL.addEventListener('input', debounce(() => {
      const sz = TEXT_SIZE_SL.value; state.textSize = parseInt(sz, 10);
      if (TS_OUT) TS_OUT.textContent = `${sz}px`;
      TEXT_SIZE_SL.setAttribute('aria-valuenow', sz);
      HTML.style.setProperty('--tl-font-size', `${sz}px`);
      const pct=((sz-14)/(28-14))*100;
      TEXT_SIZE_SL.style.backgroundSize = `${pct}% 100%`;
      try { localStorage.setItem('jissr-textsize', sz); } catch(_) {}
      saveSettingsToDB({ text_size: parseInt(sz, 10) });
    }, 600));
  }

  [HAPTIC_TOG, CUES_TOG, CONTRAST_TOG].forEach(tog => {
    if (!tog) return;
    tog.addEventListener('change', () => {
      const track = tog.closest('.toggle-track'); if (track) track.setAttribute('aria-checked', tog.checked);
      if (tog.id === 'haptic-tog') {
        state.hapticOn = tog.checked;
        showToast(tog.checked ? '📳 Haptic on' : '📴 Haptic off');
        saveSettingsToDB({ haptic_feedback: tog.checked ? 1 : 0 });
      }
      if (tog.id === 'cues-tog') {
        state.visualCuesOn = tog.checked;
        showToast(tog.checked ? '👁 Visual cues on' : '👁 Visual cues off');
        saveSettingsToDB({ visual_cues: tog.checked ? 1 : 0 });
      }
      if (tog.id === 'contrast-tog') {
        state.highContrast = tog.checked;
        HTML.setAttribute('data-high-contrast', tog.checked);
        showToast(tog.checked ? '⚡ High contrast on' : '⚡ High contrast off');
        saveSettingsToDB({ high_contrast: tog.checked ? 1 : 0 });
      }
    });
  });

  if (CAM_QUAL_SEL) {
    CAM_QUAL_SEL.addEventListener('change', () => {
      showToast(`📷 Camera: ${CAM_QUAL_SEL.value.toUpperCase()}`);
      saveSettingsToDB({ camera_quality: CAM_QUAL_SEL.value });
    });
  }
}
