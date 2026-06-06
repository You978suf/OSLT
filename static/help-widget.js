/* ════════════════════════════════════════════════════════════════════════
   JISSR · Self-contained help-chat widget for the standalone pages
   (info pages + password pages). The main SPA has its own copy wired in
   script.js; this script injects an equivalent bubble + panel, its own
   styles, and talks to the public /api/chat endpoint. Bilingual: it follows
   the page's <html lang> for labels and RTL.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (document.getElementById("chat-widget")) return; // never double-inject

  var isAr = (document.documentElement.lang || "en").toLowerCase().indexOf("ar") === 0;
  var T = isAr
    ? { help: "مساعدة", title: "مساعدة جِسر", close: "إغلاق", placeholder: "اطرح سؤالاً…",
        greeting: "مرحباً! أنا مساعد جِسر. اسألني عن كيفية استخدام التطبيق.",
        offline: "مساعد جِسر غير متاح حالياً. حاول لاحقاً.", error: "حدث خطأ ما. حاول مجدداً." }
    : { help: "Help", title: "JISSR Help", close: "Close", placeholder: "Ask a question…",
        greeting: "Hi! I'm the JISSR helper. Ask me how to use the app.",
        offline: "Help assistant is offline. Please try again later.", error: "Something went wrong. Please try again." };

  var css = ''
    + '#chat-widget{position:fixed;right:20px;bottom:20px;z-index:1000;font-family:"Plus Jakarta Sans",system-ui,sans-serif;}'
    + '#chat-widget *{box-sizing:border-box;}'
    + '.hw-bubble{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;background:#0b5fae;color:#fff;border:none;border-radius:999px;box-shadow:0 6px 20px rgba(11,95,174,.35);font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;}'
    + '.hw-bubble:hover{transform:translateY(-2px);}'
    + '.hw-panel{position:absolute;right:0;bottom:60px;width:340px;max-width:calc(100vw - 32px);height:460px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 12px 40px rgba(13,23,38,.18);display:flex;flex-direction:column;overflow:hidden;}'
    + '.hw-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(180deg,#f4f8ff,#fff);border-bottom:1px solid #dfe5ee;font-weight:700;color:#0d1726;}'
    + '.hw-close{background:none;border:none;font-size:18px;cursor:pointer;color:#56627a;line-height:1;}'
    + '.hw-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f9fbfe;}'
    + '.hw-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;}'
    + '.hw-bot{align-self:flex-start;background:#fff;border:1px solid #e6ebf2;color:#0d1726;border-bottom-left-radius:4px;}'
    + '.hw-user{align-self:flex-end;background:#0b5fae;color:#fff;border-bottom-right-radius:4px;}'
    + '.hw-form{display:flex;gap:8px;padding:10px;border-top:1px solid #dfe5ee;background:#fff;}'
    + '.hw-input{flex:1;padding:10px 12px;font-size:14px;font-family:inherit;border:1px solid #dfe5ee;border-radius:10px;outline:none;}'
    + '.hw-input:focus{border-color:#0b5fae;}'
    + '.hw-send{background:#0b5fae;color:#fff;border:none;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer;}'
    + '[dir="rtl"] .hw-panel{right:0;left:auto;}'
    + '[dir="rtl"] .hw-bot{border-bottom-left-radius:12px;border-bottom-right-radius:4px;}'
    + '[dir="rtl"] .hw-user{border-bottom-right-radius:12px;border-bottom-left-radius:4px;}';
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var widget = document.createElement("div");
  widget.id = "chat-widget";
  widget.innerHTML =
    '<button class="hw-bubble" type="button" aria-expanded="false">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
    + '<span>' + T.help + '</span></button>'
    + '<div class="hw-panel" hidden>'
    + '  <div class="hw-head"><span>' + T.title + '</span><button class="hw-close" type="button" aria-label="' + T.close + '">✕</button></div>'
    + '  <div class="hw-msgs"></div>'
    + '  <form class="hw-form"><input class="hw-input" type="text" placeholder="' + T.placeholder + '" autocomplete="off" maxlength="500" required /><button class="hw-send" type="submit">↑</button></form>'
    + '</div>';
  document.body.appendChild(widget);

  var bubble = widget.querySelector(".hw-bubble");
  var panel  = widget.querySelector(".hw-panel");
  var closeB = widget.querySelector(".hw-close");
  var msgs   = widget.querySelector(".hw-msgs");
  var form   = widget.querySelector(".hw-form");
  var input  = widget.querySelector(".hw-input");
  var history = [];

  function add(role, text) {
    var d = document.createElement("div");
    d.className = "hw-msg " + (role === "user" ? "hw-user" : "hw-bot");
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  add("bot", T.greeting);

  function open()  { panel.hidden = false; bubble.setAttribute("aria-expanded", "true");  setTimeout(function () { input.focus(); }, 50); }
  function close() { panel.hidden = true;  bubble.setAttribute("aria-expanded", "false"); }
  bubble.addEventListener("click", function () { panel.hidden ? open() : close(); });
  closeB.addEventListener("click", close);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    add("user", text);
    history.push({ role: "user", content: text });
    input.value = "";
    var pending = add("bot", "…");
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-10) }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.success) {
          pending.textContent = res.d.reply;
          history.push({ role: "assistant", content: res.d.reply });
        } else {
          pending.textContent = res.d.error || T.error;
        }
      })
      .catch(function () { pending.textContent = T.offline; });
  });
})();
