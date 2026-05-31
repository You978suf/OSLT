/**
 * JISSR — navigation.js
 * Controls application routing, theme rendering, and server connectivity.
 */
'use strict';

/* ── SERVER HEALTH ─────────────────────────────────────────────────────────── */
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

/* ── SPA NAVIGATION ────────────────────────────────────────────────────────── */
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
  if (HEADER_PUBLIC) HEADER_PUBLIC.hidden = !onPublic;
  if (HEADER_LOGOUT) HEADER_LOGOUT.hidden = onPublic;
  if (SRV_STATUS)    SRV_STATUS.hidden    = onPublic;

  // Global title / headers
  if (PAGE_HEADING) {
    PAGE_HEADING.textContent = PAGE_TITLES[key] || 'JISSR';
  }
  document.querySelectorAll('[data-target]').forEach(el => {
    const on = el.dataset.target === key;
    el.classList.toggle('active', on);
    el.setAttribute('aria-current', on ? 'page' : 'false');
  });

  if (key === 'history') loadHistoryPage();
  if (key === 'settings') loadELSettings();

  // Navigation drawer / mobile responsive drawer reset
  if (MOBILE_DRAWER) {
    MOBILE_DRAWER.classList.remove('open');
    if (MENU_TOGGLE) MENU_TOGGLE.setAttribute('aria-expanded', 'false');
  }
}

/* ── THEME & ACCENT MANAGEMENT ─────────────────────────────────────────────── */
function toggleTheme() { /* Site is forced to light theme per requirement, kept for compatibility */ }
function applyTheme(_theme) { HTML.setAttribute('data-theme', 'light'); state.theme = 'light'; }

function applyAccentColor(hex) {
  state.accentColor = hex; HTML.style.setProperty('--color-accent', hex);
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (m) {
    const rgb = `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}`;
    HTML.style.setProperty('--color-accent-dim', `rgba(${rgb},.10)`);
    HTML.style.setProperty('--color-accent-glow', `rgba(${rgb},.30)`);
  }
  try { localStorage.setItem('jissr-accent', hex); } catch(_) {}
}
