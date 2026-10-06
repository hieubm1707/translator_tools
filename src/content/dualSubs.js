// Phụ đề song ngữ cho video bài giảng Coursera (/learn/<khoá>/lecture/<id>).
// Không gọi engine dịch nào: mỗi dòng là một track phụ đề (WebVTT) Coursera cung cấp cho video. Người dùng chọn
// ngôn ngữ dòng 1 và (tuỳ chọn) dòng 2 trong popup; danh sách ngôn ngữ là các track của video đang mở.
//
// Lớp phụ đề không thể là con của <video> (thẻ video không vẽ phần tử con, chúng chỉ là nội dung dự phòng)
// -> chèn vào phần tử cha của video (khung player). Player video.js đưa chính khung này lên fullscreen nên
// phụ đề vẫn hiện; cỡ chữ tính theo kích thước khung (container query `cqmin`) nên tự co giãn khi resize.
// Chế độ kéo thả tự do: vị trí lưu theo tỉ lệ của khung ({ x: tâm ngang, y: mép dưới } trong 0..1) nên vẫn đúng
// chỗ khi resize/fullscreen; nhấp đúp vào phụ đề để về vị trí mặc định.
(() => {
  // Chuỗi giao diện: lib/i18n-messages.js được nạp trước file này (manifest.json).
  const t = (key, params) => globalThis.TT_I18N.t(key, params);
  // Giữ khớp với DEFAULT_SETTINGS trong src/lib/settings.js (content script không import module được).
  const DEFAULTS = {
    dualSubEnabled: true, dualSubLang1: 'en', dualSubLang2: 'vi', dualSubSize: 'medium',
    dualSubFree: false, dualSubPos: null, dualSubStyle: null,
  };
  // Màu chữ / màu nền / độ đậm nền (0..1) từng dòng; dualSubStyle = null -> dùng mặc định.
  // Giữ khớp với DEFAULT_DUAL_SUB_STYLE trong src/lib/settings.js.
  const DEFAULT_STYLE = {
    line1: { color: '#ffffff', bg: '#080808', bgOpacity: 0.75 },
    line2: { color: '#ffe17a', bg: '#080808', bgOpacity: 0.75 },
  };
  const DEFAULT_POS = { x: 0.5, y: 0.12 }; // vị trí bắt đầu khi chưa từng kéo
  const SIZES = new Set(['small', 'medium', 'large', 'xlarge']);
  const HOST_CLASS = 'tt-dualsub-host';
  const ON_CLASS = 'tt-dualsub-on'; // gắn lên video + khung player để dualSubs.css ẩn phụ đề gốc của Coursera
  const POLL_MS = 1000; // Coursera là SPA: đổi bài giảng không tải lại trang -> kiểm tra định kỳ
  const NOTICE_MS = 6000;

  let settings = { ...DEFAULTS };
  let state; // { video, sig, tracks, host, parts, cues1, cues2, gen, raf, abort, noticeTimer, drag }
  const vttCache = new Map(); // url -> Promise<cue[] | null>

  const isLecturePage = () => /^(www\.)?coursera\.org$/.test(location.hostname)
    && /^\/learn\/[^/]+\/lecture\//.test(location.pathname);

  const STYLE = `
    :host { all: initial; position: absolute; inset: 0; pointer-events: none; z-index: 1; }
    .box { position: absolute; inset: 0; container-type: size; }
    .subs {
      position: absolute; left: 5%; right: 5%; bottom: var(--tt-dualsub-bottom, max(56px, 12%));
      display: flex; flex-direction: column; align-items: center; gap: 0.2em;
      font: 600 var(--fs)/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      text-align: center; transition: bottom 0.2s ease;
      -webkit-font-smoothing: antialiased;
    }
    /* % theo cạnh ngắn của khung player; max() giữ chữ còn đọc được khi player rất nhỏ. */
    .size-small  { --fs: max(10px, 2.8cqmin); }
    .size-medium { --fs: max(11px, 3.5cqmin); }
    .size-large  { --fs: max(12px, 4.4cqmin); }
    .size-xlarge { --fs: max(13px, 5.4cqmin); }
    .subs.free {
      left: calc(var(--x) * 100%); right: auto; bottom: calc(var(--y) * 100%);
      width: max-content; max-width: 90cqw; transform: translateX(calc(-50% + var(--dx, 0px)));
      pointer-events: auto; cursor: grab; touch-action: none; user-select: none; transition: none;
      border-radius: 0.25em;
    }
    .subs.free:hover, .subs.free.hover { outline: 1px dashed rgba(255, 255, 255, 0.7); outline-offset: 0.2em; }
    .subs.free.dragging { cursor: grabbing; }
    .row { max-width: 100%; }
    .line {
      padding: 0.08em 0.45em; border-radius: 0.2em;
      white-space: pre-line;
      -webkit-box-decoration-break: clone; box-decoration-break: clone;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    }
    .line1 { color: var(--c1); background: var(--bg1); }
    .line2 { color: var(--c2); background: var(--bg2); }
    .notice { font-size: 0.65em; font-weight: 500; color: #d1d5db; }
  `;

  // ---- WebVTT ----
  const decoder = document.createElement('textarea'); // innerHTML của textarea không chạy script -> giải mã &amp; …

  function parseTime(s) {
    return s.trim().replace(',', '.').split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  }

  function parseVtt(text) {
    const cues = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [from, rest] = lines[i].split('-->');
      decoder.innerHTML = lines.slice(i + 1).join(' ').replace(/<[^>]*>/g, '');
      const body = decoder.value.replace(/\s+/g, ' ').trim();
      if (body) cues.push({ start: parseTime(from), end: parseTime(rest.trim().split(/\s+/)[0]), text: body });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  // URL có hmac + cookie đăng nhập của trang -> fetch từ content script (cùng origin coursera.org).
  function fetchCues(url) {
    if (!vttCache.has(url)) {
      vttCache.set(url, fetch(url, { credentials: 'include' })
        .then((res) => (res.ok ? res.text() : ''))
        .then((text) => (/^﻿?WEBVTT/.test(text) ? parseVtt(text) : null))
        .catch(() => null));
    }
    return vttCache.get(url);
  }

  // Cue cuối cùng bắt đầu trước `t` (tìm nhị phân), lùi vài cue phòng trường hợp cue chồng nhau.
  function cueAt(cues, t) {
    let lo = 0;
    let hi = cues.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    for (let i = idx; i >= 0 && i > idx - 3; i--) if (cues[i].end > t) return cues[i].text;
    return '';
  }

  // ---- Chọn track ----
  function listTracks(video) {
    const seen = new Set();
    return [...video.querySelectorAll('track[src]')]
      .map((t) => ({
        lang: (t.srclang || '').toLowerCase(),
        label: t.label || langLabel(t.srclang) || t.srclang,
        src: t.src, // thuộc tính .src đã là URL tuyệt đối
        isDefault: t.default,
      }))
      .filter((t) => t.lang && !seen.has(t.lang) && seen.add(t.lang));
  }

  // Phụ đề 1 luôn có: ngôn ngữ đã chọn, không có thì tiếng Anh, rồi track mặc định, rồi track đầu tiên.
  // Phụ đề 2 tuỳ chọn ('' = không hiện); video không có ngôn ngữ đó thì bỏ trống phụ đề 2.
  function pickTracks(tracks, lang1, lang2) {
    const find = (lang) => lang && tracks.find((t) => t.lang === lang.toLowerCase());
    const line1 = find(lang1) ?? tracks.find((t) => t.lang === 'en' || t.lang.startsWith('en-'))
      ?? tracks.find((t) => t.isDefault) ?? tracks[0];
    const line2 = lang2 && lang2.toLowerCase() !== line1.lang ? find(lang2) : undefined;
    return { line1, line2 };
  }

  const trackLabel = (lang) => state?.tracks.find((t) => t.lang === lang?.toLowerCase())?.label ?? langLabel(lang);

  function langLabel(code) {
    try {
      return new Intl.DisplayNames([globalThis.TT_I18N.lang], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  // ---- Lớp phụ đề ----
  function setLine(el, text) {
    if (el.textContent === text) return false;
    el.textContent = text;
    el.parentElement.hidden = !text;
    return true;
  }

  function render() {
    if (!state) return;
    const t = state.video.currentTime;
    const changed1 = setLine(state.parts.line1, cueAt(state.cues1, t));
    const changed2 = setLine(state.parts.line2, cueAt(state.cues2, t));
    if (changed1 || changed2) keepInside();
  }

  // Chế độ tự do neo theo tâm ngang: câu dài hơn câu lúc kéo có thể tràn mép khung -> đẩy ngang vào trong.
  function keepInside() {
    const { subs } = state.parts;
    subs.style.removeProperty('--dx');
    if (!settings.dualSubFree) return;
    const box = state.parts.box.getBoundingClientRect();
    const rect = subs.getBoundingClientRect();
    const dx = rect.left < box.left ? box.left - rect.left : rect.right > box.right ? box.right - rect.right : 0;
    if (dx) subs.style.setProperty('--dx', `${dx}px`);
  }

  // timeupdate chỉ ~4 lần/giây -> khi đang phát dùng requestAnimationFrame cho phụ đề khớp tiếng.
  function tick() {
    render();
    state.raf = state.video.paused ? 0 : requestAnimationFrame(tick);
  }

  function showNotice(text) {
    clearTimeout(state.noticeTimer);
    setLine(state.parts.notice, text);
    state.noticeTimer = setTimeout(() => state && setLine(state.parts.notice, ''), NOTICE_MS);
  }

  function applyLayout() {
    const { subs } = state.parts;
    const size = SIZES.has(settings.dualSubSize) ? settings.dualSubSize : DEFAULTS.dualSubSize;
    subs.className = `subs size-${size}`;
    subs.classList.toggle('free', !!settings.dualSubFree);
    subs.title = settings.dualSubFree ? t('subs.dragTitle') : '';
    subs.classList.toggle('dragging', !!state.drag);
    // Chế độ tự do: đưa lớp phụ đề lên trên các lớp phủ của player (host vẫn pointer-events: none,
    // chỉ khối phụ đề bắt chuột) để có con trỏ "grab" + viền khi rê.
    state.host.style.zIndex = settings.dualSubFree ? '2147483647' : '';
    const pos = settings.dualSubPos ?? DEFAULT_POS;
    subs.style.setProperty('--x', String(pos.x));
    subs.style.setProperty('--y', String(pos.y));
    for (const [key, n] of [['line1', 1], ['line2', 2]]) {
      const style = { ...DEFAULT_STYLE[key], ...settings.dualSubStyle?.[key] };
      subs.style.setProperty(`--c${n}`, style.color);
      subs.style.setProperty(`--bg${n}`, hexToRgba(style.bg, style.bgOpacity));
    }
    keepInside();
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    const n = m ? parseInt(m[1], 16) : 0x080808;
    const a = Number.isFinite(Number(alpha)) ? Math.min(Math.max(Number(alpha), 0), 1) : 0.75;
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  // Kéo thả trong chế độ tự do. Player Coursera có thể phủ lớp trong suốt (bắt click play/pause) lên trên phụ đề,
  // khi đó sự kiện chuột không tới được phần tử phụ đề -> nghe ở window, pha capture (chạy trước handler của trang)
  // và tự kiểm tra con trỏ có nằm trong khung phụ đề không. Sự kiện thuộc thao tác kéo bị chặn hẳn để
  // click/nhấp đúp vào phụ đề không làm video dừng/phát hay bật fullscreen.
  function enableDrag(signal) {
    const opts = { signal, capture: true };
    let suppressClick = false; // click phát sinh ngay sau khi thả chuột

    const overSubs = (e) => {
      if (!state || !settings.dualSubFree) return false;
      const r = state.parts.subs.getBoundingClientRect();
      return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const swallow = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !overSubs(e)) return;
      swallow(e);
      const { box, subs } = state.parts;
      subs.setPointerCapture(e.pointerId); // vẫn nhận pointermove khi chuột ra khỏi phụ đề/khung video
      state.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, box: box.getBoundingClientRect(), rect: subs.getBoundingClientRect() };
      applyLayout();
    }, opts);

    // Rê chuột: lớp phủ của player che mất :hover/cursor của phụ đề -> tự bật viền + con trỏ "grab".
    let hovering = false;
    const setHover = (on) => {
      if (on === hovering) return;
      hovering = on;
      state?.parts.subs.classList.toggle('hover', on);
      if (on) document.documentElement.style.setProperty('cursor', 'grab', 'important');
      else document.documentElement.style.removeProperty('cursor');
    };
    signal.addEventListener('abort', () => setHover(false));

    window.addEventListener('pointermove', (e) => {
      const d = state?.drag;
      if (d?.id !== e.pointerId) {
        if (!d) setHover(overSubs(e));
        return;
      }
      swallow(e);
      const left = clamp(d.rect.left + e.clientX - d.x, d.box.left, d.box.right - d.rect.width);
      const top = clamp(d.rect.top + e.clientY - d.y, d.box.top, d.box.bottom - d.rect.height);
      settings.dualSubPos = {
        x: (left + d.rect.width / 2 - d.box.left) / d.box.width,
        y: (d.box.bottom - top - d.rect.height) / d.box.height,
      };
      applyLayout();
    }, opts);

    const endDrag = (e) => {
      if (state?.drag?.id !== e.pointerId) return;
      swallow(e);
      state.drag = undefined;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      applyLayout();
      chrome.storage.local.set({ dualSubPos: settings.dualSubPos });
    };
    window.addEventListener('pointerup', endDrag, opts);
    window.addEventListener('pointercancel', endDrag, opts);

    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
      window.addEventListener(type, (e) => {
        if (!suppressClick && !overSubs(e)) return;
        swallow(e);
        if (type === 'dblclick') { // nhấp đúp -> về vị trí mặc định
          settings.dualSubPos = null;
          applyLayout();
          chrome.storage.local.set({ dualSubPos: null });
        }
      }, opts);
    }
  }

  async function loadCues() {
    const s = state;
    const gen = ++s.gen;
    s.cues1 = [];
    s.cues2 = [];
    clearTimeout(s.noticeTimer);
    setLine(s.parts.notice, '');
    render();
    const { dualSubLang1: lang1, dualSubLang2: lang2 } = settings;
    const { line1, line2 } = pickTracks(s.tracks, lang1, lang2);
    const [cues1, cues2] = await Promise.all([fetchCues(line1.src), line2 ? fetchCues(line2.src) : null]);
    if (s !== state || gen !== s.gen) return; // đã đổi video / ngôn ngữ trong lúc tải
    s.cues1 = cues1 ?? [];
    s.cues2 = cues2 ?? [];
    const notices = [];
    if (lang1 && line1.lang !== lang1.toLowerCase()) notices.push(t('subs.missingFallback', { lang: trackLabel(lang1), fallback: line1.label }));
    if (lang2 && lang2.toLowerCase() !== line1.lang && !line2) notices.push(t('subs.missing', { lang: trackLabel(lang2) }));
    if (!cues1 || (line2 && !cues2)) notices.push(t('subs.loadFailed'));
    if (notices.length) showNotice(notices.join(' · '));
    render();
  }

  function mount(video, tracks, sig) {
    const parent = video.parentElement;
    const host = document.createElement('div');
    host.className = HOST_CLASS;
    const shadow = host.attachShadow({ mode: 'closed' }); // CSS của trang không ảnh hưởng tới phụ đề
    shadow.innerHTML = `<style>${STYLE}</style>
      <div class="box"><div class="subs">
        <div class="row" hidden><span class="line line1"></span></div>
        <div class="row" hidden><span class="line line2"></span></div>
        <div class="row" hidden><span class="notice"></span></div>
      </div></div>`;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(host);
    parent.classList.add(ON_CLASS);
    video.classList.add(ON_CLASS);

    const abort = new AbortController();
    state = {
      video, sig, tracks, host, abort, gen: 0, raf: 0, noticeTimer: 0, cues1: [], cues2: [],
      parts: {
        box: shadow.querySelector('.box'),
        subs: shadow.querySelector('.subs'),
        line1: shadow.querySelector('.line1'),
        line2: shadow.querySelector('.line2'),
        notice: shadow.querySelector('.notice'),
      },
    };
    applyLayout();
    enableDrag(abort.signal);
    const resizeObserver = new ResizeObserver(() => state && keepInside()); // resize/fullscreen
    resizeObserver.observe(state.parts.box);
    abort.signal.addEventListener('abort', () => resizeObserver.disconnect());
    const opts = { signal: abort.signal };
    video.addEventListener('play', () => { cancelAnimationFrame(state.raf); tick(); }, opts);
    for (const type of ['timeupdate', 'seeked', 'pause']) video.addEventListener(type, render, opts);
    loadCues();
    if (!video.paused) tick();
  }

  function unmount() {
    if (!state) return;
    const { video, host, abort, raf, noticeTimer } = state;
    abort.abort();
    cancelAnimationFrame(raf);
    clearTimeout(noticeTimer);
    host.parentElement?.classList.remove(ON_CLASS);
    video.classList.remove(ON_CLASS);
    host.remove();
    state = undefined;
  }

  // Gắn/gỡ lớp phụ đề theo trang hiện tại: đổi bài giảng (SPA), video mới, hoặc track được nạp muộn.
  function sync() {
    const video = settings.dualSubEnabled && isLecturePage() ? document.querySelector('video') : null;
    const tracks = video ? listTracks(video) : [];
    const sig = tracks.map((t) => t.src).join('\n');
    if (state && state.video === video && state.sig === sig && state.host.isConnected) return;
    unmount();
    if (video?.parentElement && tracks.length) mount(video, tracks, sig);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(DEFAULTS).filter((k) => k in changes);
    if (!keys.length) return;
    for (const k of keys) settings[k] = changes[k].newValue ?? DEFAULTS[k];
    if (keys.includes('dualSubEnabled')) sync();
    if (!state) return;
    if (['dualSubSize', 'dualSubFree', 'dualSubStyle'].some((k) => keys.includes(k))) applyLayout();
    // Vị trí đổi từ tab khác; đang kéo ở tab này thì giữ vị trí đang kéo.
    if (keys.includes('dualSubPos') && !state.drag) applyLayout();
    if (keys.includes('dualSubLang1') || keys.includes('dualSubLang2')) loadCues();
  });

  globalThis.TT_I18N.onChange(() => state && applyLayout()); // đổi ngôn ngữ giao diện -> tooltip kéo thả

  // Popup hỏi danh sách ngôn ngữ phụ đề của video đang mở để dựng dropdown.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'DUAL_SUB_TRACKS') return false;
    const video = isLecturePage() ? document.querySelector('video') : null;
    sendResponse({
      isLecture: isLecturePage(),
      tracks: (video ? listTracks(video) : []).map(({ lang, label }) => ({ lang, label })),
    });
    return false;
  });

  chrome.storage.local.get(DEFAULTS).then((stored) => {
    settings = { ...DEFAULTS, ...stored };
    sync();
    setInterval(sync, POLL_MS);
  });
})();
