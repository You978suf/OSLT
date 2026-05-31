/**
 * JISSR — history.js
 * Synchronizes translation logs, queries history entries with filter toggles, and handles SQLite session deletions.
 */
'use strict';

/* ── HISTORY — SAVE & SYNC ─────────────────────────────────────────────────── */
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
    const output = document.createElement('div'); output.className = 'hist-output'; output.textContent = item.output_text || '—';
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

/* ── WIRE UP HISTORY LISTENERS ──────────────────────────────────────────────── */
function wireHistoryListeners() {
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
}
