/* ════════════════════════════════════════════════════════════════════════
   JISSR · Lightweight EN ⇄ AR interface localisation
   ------------------------------------------------------------------------
   No build step, no framework. The page ships in English; this layer swaps
   visible text nodes + a few attributes to Arabic and flips the layout to
   RTL when the user picks العربية. The English original of every node is
   snapshotted on first run, so toggling back is loss-free. A MutationObserver
   re-applies the active language to dynamically inserted content (toasts,
   prediction rows, history items, chat replies).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // English (normalised) → Arabic. Keys are matched after collapsing internal
  // whitespace and trimming, so multi-line source text still resolves.
  const AR = {
    // ── Header / nav ─────────────────────────────────────────────
    "Sign in": "تسجيل الدخول",
    "Get started": "ابدأ الآن",
    "Sign to Speech": "الإشارة إلى الكلام",
    "Speech to Sign": "الكلام إلى الإشارة",
    "History": "السجل",
    "Offline": "غير متصل",
    "Server offline": "الخادم غير متصل",
    "User": "مستخدم",
    "JISSR home": "الصفحة الرئيسية لـ JISSR",
    "Voice API settings": "إعدادات واجهة الصوت",
    "Sign out": "تسجيل الخروج",
    "Menu": "القائمة",

    // ── Landing hero ─────────────────────────────────────────────
    "Made in Oman · Real-time": "صُنع في عُمان · فوري",
    "Breaking": "نكسر",
    "communication barriers": "حواجز التواصل",
    "across Oman.": "في جميع أنحاء عُمان.",
    "JISSR (جِسر) is a real-time Omani Sign Language translator. AI-powered camera recognition, natural Arabic & English speech output, and a 3D signing avatar, all built for Oman's Deaf and Hard of Hearing community.":
      "جِسر مترجم فوري للغة الإشارة العُمانية. تعرّف بالكاميرا مدعوم بالذكاء الاصطناعي، وإخراج صوتي طبيعي بالعربية والإنجليزية، وأفاتار ثلاثي الأبعاد يؤدي الإشارة، كله مصمم لمجتمع الصُم وضعاف السمع في عُمان.",
    "Create your account": "أنشئ حسابك",
    "AI-powered": "مدعوم بالذكاء الاصطناعي",
    "Bilingual EN / AR": "ثنائي اللغة EN / AR",
    "Built for OSL": "مصمم للغة الإشارة العُمانية",
    "Private & secure": "خاص وآمن",
    "Camera reads OSL signs and speaks them aloud.": "تقرأ الكاميرا إشارات لغة الإشارة العُمانية وتنطقها بصوت عالٍ.",
    "3D avatar signs back in real time.": "أفاتار ثلاثي الأبعاد يؤدي الإشارة فورياً.",

    // ── Features ─────────────────────────────────────────────────
    "Key Features": "الميزات الرئيسية",
    "Everything you need to communicate": "كل ما تحتاجه للتواصل",
    "A complete two-way bridge between sign language and spoken language for classrooms, clinics, and conversations.":
      "جسر متكامل ثنائي الاتجاه بين لغة الإشارة واللغة المنطوقة للفصول الدراسية والعيادات والمحادثات.",
    "Live Sign Recognition": "تعرّف فوري على الإشارة",
    "UniSign-powered model recognises Omani Sign Language from your camera, with predictions in milliseconds.":
      "نموذج مدعوم بـ UniSign يتعرّف على لغة الإشارة العُمانية من كاميرتك، بتنبؤات في أجزاء من الثانية.",
    "Skeletal Avatar": "أفاتار هيكلي",
    "A 3D pose-driven avatar signs back what the hearing person says, with adjustable playback speed.":
      "أفاتار ثلاثي الأبعاد قائم على الحركة يؤدي بالإشارة ما يقوله الشخص السامع، مع سرعة تشغيل قابلة للضبط.",
    "Natural Voice Output": "إخراج صوتي طبيعي",
    "ElevenLabs-powered text-to-speech and speech-to-text clear Arabic and English, low latency.":
      "تحويل النص إلى كلام والكلام إلى نص مدعوم بـ ElevenLabs، عربية وإنجليزية واضحة وبزمن استجابة منخفض.",
    "Private & Secure": "خاص وآمن",
    "Your account, history, and settings live in a MySQL database you control. No third-party tracking, ever.":
      "حسابك وسجلك وإعداداتك في قاعدة بيانات MySQL تتحكم بها أنت. بلا أي تتبّع من طرف ثالث، إطلاقاً.",
    "Personal History": "سجل شخصي",
    "Every translation is saved to your account, ready to revisit, copy, or replay whenever you need.":
      "تُحفظ كل ترجمة في حسابك، جاهزة للمراجعة أو النسخ أو إعادة التشغيل وقتما تشاء.",
    "Personalised Experience": "تجربة مخصصة",
    "Theme, text size, accent colour, haptic feedback make JISSR comfortable for the way you use it.":
      "السمة وحجم النص واللون المميز والاهتزاز تجعل جِسر مريحاً للطريقة التي تستخدمه بها.",

    // ── CTA ──────────────────────────────────────────────────────
    "Ready to break the silence?": "هل أنت مستعد لكسر الصمت؟",
    "Create your free account now to start translating Omani Sign Language.":
      "أنشئ حسابك المجاني الآن لتبدأ ترجمة لغة الإشارة العُمانية.",
    "Get started it's free": "ابدأ الآن · مجاناً",
    "Already have an account?": "هل لديك حساب بالفعل؟",

    // ── Auth ─────────────────────────────────────────────────────
    "Welcome to a bridge for every conversation.": "مرحباً بك في جسرٍ لكل محادثة.",
    "JISSR translates Omani Sign Language to speech and back again in real time, with care designed for Oman's Deaf and Hard of Hearing community.":
      "يترجم جِسر لغة الإشارة العُمانية إلى كلام والعكس فورياً، بعناية مصممة لمجتمع الصُم وضعاف السمع في عُمان.",
    "AI sign recognition": "تعرّف على الإشارة بالذكاء الاصطناعي",
    "UniSign + RTMPose · real-time": "UniSign + RTMPose · فوري",
    "Natural EN / AR speech": "كلام طبيعي بالإنجليزية والعربية",
    "ElevenLabs voice quality": "جودة صوت ElevenLabs",
    "Your data, your device": "بياناتك، جهازك",
    "Proudly built in Oman · جِسر للترجمة": "صُنع بفخر في عُمان · جِسر للترجمة",
    "Welcome back": "مرحباً بعودتك",
    "Sign in to your JISSR account to continue.": "سجّل الدخول إلى حساب جِسر للمتابعة.",
    "Sign In": "تسجيل الدخول",
    "Create Account": "إنشاء حساب",
    "Email address": "البريد الإلكتروني",
    "Password": "كلمة المرور",
    "Forgot password?": "نسيت كلمة المرور؟",
    "Enter your password": "أدخل كلمة المرور",
    "Show or hide password": "إظهار أو إخفاء كلمة المرور",
    "Show or hide confirm password": "إظهار أو إخفاء تأكيد كلمة المرور",
    "Full name": "الاسم الكامل",
    "Your full name": "اسمك الكامل",
    "Min 8 chars · upper + number": "8 أحرف على الأقل · حرف كبير + رقم",
    "Create a strong password": "أنشئ كلمة مرور قوية",
    "Confirm password": "تأكيد كلمة المرور",
    "Repeat your password": "أعد إدخال كلمة المرور",
    "By creating an account you agree to our": "بإنشائك حساباً فأنت توافق على",
    "Terms of Service": "شروط الخدمة",
    "and": "و",
    "Privacy Policy": "سياسة الخصوصية",
    "or": "أو",
    "Continue with Google": "المتابعة عبر Google",

    // ── Sign to Speech page ───────────────────────────────────────
    "Live translation": "ترجمة مباشرة",
    "Point your camera at OSL signs JISSR speaks them aloud in real time.":
      "وجّه كاميرتك نحو إشارات لغة الإشارة العُمانية - ينطقها جِسر بصوت عالٍ فورياً.",
    "Camera viewfinder": "عدسة الكاميرا",
    "Position your hands in the frame": "ضع يديك داخل الإطار",
    "Front camera · OSL · HD": "كاميرا أمامية · OSL · HD",
    "Live Translation": "الترجمة المباشرة",
    "Waiting for sign input…": "في انتظار إدخال الإشارة…",
    "Upload": "رفع",
    "Upload a video": "رفع مقطع فيديو",
    "Choose a video file": "اختر ملف فيديو",
    "Record": "تسجيل",
    "Stop": "إيقاف",
    "Start recording": "بدء التسجيل",
    "Flip Cam": "تبديل الكاميرا",
    "Switch camera": "تبديل الكاميرا",
    "Processing…": "جارٍ المعالجة…",
    "AI Output": "مخرجات الذكاء الاصطناعي",
    "Auto-Speak": "نطق تلقائي",
    "English translation": "الترجمة الإنجليزية",
    "Speak current result": "نطق النتيجة الحالية",
    "Top 5 Predictions": "أفضل 5 تنبؤات",
    "Clear": "مسح",
    "Clear history": "مسح السجل",
    "Recognition history will appear here": "سيظهر سجل التعرّف هنا",

    // ── Speech to Sign page ───────────────────────────────────────
    "Signs will appear here type below": "ستظهر الإشارات هنا - اكتب بالأسفل",
    "Idle provide input below": "في وضع الخمول - أدخِل النص بالأسفل",
    "Speed": "السرعة",
    "🎤 Microphone": "🎤 الميكروفون",
    "⌨️ Keyboard": "⌨️ لوحة المفاتيح",
    "Tap to activate microphone": "اضغط لتفعيل الميكروفون",
    "Tap to listen": "اضغط للاستماع",
    "Listening… (speak now)": "يستمع الآن… (تحدّث)",
    "API Key required": "مطلوب مفتاح API",
    "Language:": "اللغة:",
    "English": "الإنجليزية",
    "Recognised speech will appear here…": "سيظهر الكلام المُتعرَّف عليه هنا…",
    "Use in Avatar": "استخدم في الأفاتار",
    "Type what the hearing person says": "اكتب ما يقوله الشخص السامع",
    "Hello, how can I help you today?…": "مرحباً، كيف يمكنني مساعدتك اليوم؟…",
    "Translate to Sign Language": "ترجم إلى لغة الإشارة",
    "Heard:": "المسموع:",

    // ── History page ─────────────────────────────────────────────
    "Your activity": "نشاطك",
    "Translation History": "سجل الترجمة",
    "Everything you've translated automatically saved to your account.":
      "كل ما ترجمته - يُحفظ تلقائياً في حسابك.",
    "Total": "الإجمالي",
    "All": "الكل",
    "Sign": "إشارة",
    "Speech": "كلام",
    "🗑 Clear All": "🗑 مسح الكل",
    "No translation history yet": "لا يوجد سجل ترجمة بعد",
    "Your translations will be saved here automatically": "ستُحفظ ترجماتك هنا تلقائياً",
    "History cleared": "تم مسح السجل",

    // ── Footer ───────────────────────────────────────────────────
    "A communication bridge for the Deaf and Hard of Hearing community in Oman powered by AI, built with care.":
      "جسر تواصل لمجتمع الصُم وضعاف السمع في عُمان - مدعوم بالذكاء الاصطناعي، ومبني بعناية.",
    "Product": "المنتج",
    "About": "حول",
    "Our mission": "مهمتنا",
    "The team": "الفريق",
    "Contact": "اتصل بنا",
    "Legal": "قانوني",
    "Accessibility": "إمكانية الوصول",
    "© 2026 JISSR · جِسر · Made in Oman": "© 2026 JISSR · جِسر · صُنع في عُمان",

    // ── Voice modal ──────────────────────────────────────────────
    "🔊 Voice API": "🔊 واجهة الصوت",
    "Close": "إغلاق",
    "Optional. Add an ElevenLabs API key for natural Arabic/English voices and microphone speech-to-text. Without a key, JISSR uses free built-in voices.":
      "اختياري. أضف مفتاح ElevenLabs API لأصوات عربية/إنجليزية طبيعية وتحويل الكلام إلى نص عبر الميكروفون. بدون مفتاح، يستخدم جِسر أصواتاً مجانية مدمجة.",
    "API Key": "مفتاح API",
    "Required for natural TTS & STT": "مطلوب للتحويل الطبيعي بين النص والكلام",
    "Voice": "الصوت",
    "ElevenLabs voice": "صوت ElevenLabs",
    "Custom Voice ID": "معرّف صوت مخصص",
    "Enter ElevenLabs voice ID…": "أدخل معرّف صوت ElevenLabs…",
    "Model": "النموذج",
    "Multilingual v2 best for Arabic": "متعدد اللغات v2 - الأفضل للعربية",
    "Sign Out": "تسجيل الخروج",

    // ── Help chat ────────────────────────────────────────────────
    "Open help chat": "فتح محادثة المساعدة",
    "Help": "مساعدة",
    "JISSR Help": "مساعدة جِسر",
    "Close chat": "إغلاق المحادثة",
    "Hi! I'm the JISSR helper. Ask me how to use Sign to Speech, Speech to Sign, or anything about OSL.":
      "مرحباً! أنا مساعد جِسر. اسألني كيف تستخدم الإشارة إلى الكلام، أو الكلام إلى الإشارة، أو أي شيء عن لغة الإشارة العُمانية.",
    "Ask a question…": "اطرح سؤالاً…",
    "Send": "إرسال",
  };

  const LANG_KEY = "jissr-lang";
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "CODE"]);

  const origText = new WeakMap();   // textNode  → original English value
  const origAttr = new WeakMap();   // element    → { attr: originalValue }

  let current = "en";

  const norm = (s) => s.replace(/\s+/g, " ").trim();

  function translateTextNode(node, lang) {
    if (!origText.has(node)) origText.set(node, node.nodeValue);
    const orig = origText.get(node);
    const m = orig.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const lead = m[1], trail = m[3];
    const key = norm(m[2]);
    if (!key) return;
    if (lang === "ar" && AR[key] !== undefined) {
      node.nodeValue = lead + AR[key] + trail;
    } else if (node.nodeValue !== orig) {
      node.nodeValue = orig;
    }
  }

  function translateAttrs(el, lang) {
    let store = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      if (!store) { store = {}; origAttr.set(el, store); }
      if (!(a in store)) store[a] = el.getAttribute(a);
      const key = norm(store[a]);
      if (lang === "ar" && AR[key] !== undefined) el.setAttribute(a, AR[key]);
      else el.setAttribute(a, store[a]);
    }
  }

  function walk(root, lang) {
    // Text nodes
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (p && SKIP_TAGS.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    for (let n = tw.nextNode(); n; n = tw.nextNode()) nodes.push(n);
    nodes.forEach((n) => translateTextNode(n, lang));

    // Attributes (include root itself if it is an element)
    if (root.nodeType === 1) translateAttrs(root, lang);
    if (root.querySelectorAll) {
      root.querySelectorAll("[" + ATTRS.join("],[") + "]").forEach((el) => translateAttrs(el, lang));
    }
  }

  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (current !== "ar") return;
      for (const m of muts) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 3) translateTextNode(node, "ar");
          else if (node.nodeType === 1) walk(node, "ar");
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function updateToggle(lang) {
    const lbl = document.getElementById("lang-toggle-label");
    const btn = document.getElementById("lang-toggle");
    if (lbl) lbl.textContent = lang === "ar" ? "EN" : "عربي";
    if (btn) btn.setAttribute("aria-label", lang === "ar" ? "Switch to English" : "التبديل إلى العربية");
  }

  function applyLanguage(lang) {
    current = lang;
    const html = document.documentElement;
    html.setAttribute("lang", lang);
    html.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    document.body.classList.toggle("lang-ar", lang === "ar");
    walk(document.body, lang);
    updateToggle(lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
    // Also persist as a cookie so server-rendered info pages (/about, /team,
    // /privacy, …) can serve the matching language on navigation.
    try { document.cookie = LANG_KEY + "=" + lang + ";path=/;max-age=31536000;samesite=lax"; } catch (_) {}
  }

  function init() {
    let saved = "en";
    try { saved = localStorage.getItem(LANG_KEY) || "en"; } catch (_) {}
    startObserver();
    applyLanguage(saved);

    const btn = document.getElementById("lang-toggle");
    if (btn) btn.addEventListener("click", () => applyLanguage(current === "ar" ? "en" : "ar"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for manual use / debugging
  window.JISSRLang = { set: applyLanguage, get: () => current };
})();
