// Content script: chạy trong mỗi trang web, truy cập được DOM của trang
// nhưng không gọi được hầu hết chrome.* API -> nhờ service worker làm hộ.
(() => {
  // Chuỗi giao diện: lib/i18n-messages.js được nạp trước file này (manifest.json), tự theo dõi ngôn ngữ đã chọn.
  const t = (key, params) => globalThis.TT_I18N.t(key, params);
  const BUBBLE_ID = 'translator-tool-bubble';
  // Script chạy trong mọi frame (all_frames). Khung dịch chỉ chèn ở frame chính;
  // iframe (vd. bài giảng Coursera nhúng từ domain khác) chỉ tách đoạn + bắt hover.
  const IS_TOP = window === window.top;
  const MIN_FRAME_AREA = 200 * 100; // bỏ qua iframe quá nhỏ (quảng cáo, tracking…)
  const isLargeEnough = () => IS_TOP || window.innerWidth * window.innerHeight >= MIN_FRAME_AREA;

  // Service worker có thể đang tắt/khởi động lại đúng lúc gửi -> kênh tin nhắn đứt
  // ("Receiving end does not exist", "message port closed"). Gửi lại vài lần; đoạn đã dịch xong nằm trong bộ nhớ bản dịch nên không tốn thêm.
  const TRANSIENT_MSG_ERROR = /Receiving end does not exist|message port closed|message channel closed/i;
  async function sendToWorker(message, retries = 3) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch (err) {
        if (attempt >= retries || !TRANSIENT_MSG_ERROR.test(String(err?.message ?? err))) throw err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  function removeBubble() {
    document.getElementById(BUBBLE_ID)?.remove();
  }

  function line(className, text) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
  }

  // Dùng textContent (không innerHTML) vì kết quả đến từ bên ngoài.
  function showBubble(rect, { text, transliteration, dict, error } = {}) {
    removeBubble();
    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.append(line(error ? 'tt-error' : 'tt-text', error ?? text));
    if (transliteration) bubble.append(line('tt-translit', transliteration));
    if (dict) bubble.append(line('tt-dict', dict));
    bubble.style.top = `${window.scrollY + rect.bottom + 8}px`;
    bubble.style.left = `${window.scrollX + rect.left}px`;
    document.body.appendChild(bubble);
  }

  async function translateSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    showBubble(rect, { text: t('common.translating') });

    let res;
    try {
      res = await sendToWorker({ type: 'TRANSLATE', text });
    } catch (err) {
      res = { ok: false, error: String(err?.message ?? err) };
    }
    showBubble(rect, res?.ok ? res : { error: t('common.error', { error: res?.error ?? t('common.unknown') }) });
  }

  // ---- Split & Translate ----
  // Mỗi "đoạn" = phần text thuộc trực tiếp về một phần tử block (p, li, h1, div…); text trong thẻ inline
  // (a, b, span…) được gộp vào block cha. Không sửa DOM của trang: map block -> đoạn giữ trong bộ nhớ,
  // tô vàng bằng CSS Custom Highlight API (chỉ tô đúng phần chữ của đoạn, không tô cả khối).
  const HIGHLIGHT_NAME = 'tt-split-hl';
  const MAX_SEGMENTS = 1500;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'SVG', 'MATH', 'IFRAME']);
  const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents']);

  let splitActive = false;
  let translateAllActive = false;
  let segmentsByBlock = new Map(); // block element -> { id, block, nodes: Text[], text, result? }
  let hoveredSeg;

  function isBlock(el, cache) {
    if (!cache.has(el)) cache.set(el, !INLINE_DISPLAYS.has(getComputedStyle(el).display));
    return cache.get(el);
  }

  // Phần tử block gần nhất chứa `el` (tính cả chính nó).
  function nearestBlock(el, cache = new Map()) {
    while (el && el !== document.body) {
      if (isBlock(el, cache)) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function clearSegments() {
    setHovered(undefined);
    segmentsByBlock = new Map();
  }

  // Phần tử `display: contents` không có khung nên checkVisibility() luôn false (vd. <ms-docs-ast-node> của
  // AI Studio bọc toàn bộ chữ bài viết) -> kiểm tra trên phần tử cha gần nhất có khung thật.
  function isVisible(el) {
    while (el && getComputedStyle(el).display === 'contents') el = el.parentElement;
    return !el || el.checkVisibility?.() !== false;
  }

  function collectSegments() {
    clearSegments();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${BUBBLE_ID}, #${TOOLTIP_ID}, #${BADGE_ID}, [contenteditable=""], [contenteditable="true"]`)) {
          return NodeFilter.FILTER_REJECT;
        }
        for (let el = parent; el; el = el.parentElement) {
          if (SKIP_TAGS.has(el.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        }
        return isVisible(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    const displayCache = new Map();
    const groups = new Map(); // block element -> Text[]
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const block = nearestBlock(node.parentElement, displayCache);
      if (!groups.has(block)) {
        if (groups.size >= MAX_SEGMENTS) break;
        groups.set(block, []);
      }
      groups.get(block).push(node);
    }

    const segments = [];
    for (const [block, nodes] of groups) {
      const text = nodes.map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
      if (!/\p{L}/u.test(text)) continue; // bỏ đoạn chỉ có số/ký hiệu
      const seg = { id: segments.length, block, nodes, text };
      segmentsByBlock.set(block, seg);
      segments.push(seg);
    }
    return segments;
  }

  function setHovered(seg) {
    if (seg === hoveredSeg) return;
    hoveredSeg = seg;
    if (seg) {
      const ranges = seg.nodes.filter((n) => n.isConnected).map((n) => {
        const range = new Range();
        range.selectNodeContents(n);
        return range;
      });
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
    if (translateAllActive) showTooltip(seg);
    if (!splitActive) return;
    chrome.runtime.sendMessage({ type: 'SPLIT_HOVER', id: seg?.id ?? null }).catch(() => {}); // khung dịch có thể chưa tải xong
  }

  document.addEventListener('mouseover', (e) => {
    if (!(splitActive || translateAllActive) || !(e.target instanceof Element)) return;
    // Chỉ xét block gần nhất: rê vào <p> chỉ chứa ảnh sẽ không tô cả khối cha bao ngoài.
    setHovered(segmentsByBlock.get(nearestBlock(e.target)));
  });
  document.documentElement.addEventListener('mouseleave', () => {
    if (splitActive || translateAllActive) setHovered(undefined);
  });

  // ---- Translate All ----
  // Mỗi frame tự quét + dịch trước toàn bộ đoạn của mình (ưu tiên đoạn đang thấy trên màn hình),
  // giữ bản dịch trong bộ nhớ; rê chuột vào đoạn gốc là hiện tooltip ngay, không phải gọi API.
  const TOOLTIP_ID = 'translator-tool-tooltip';
  const BADGE_ID = 'translator-tool-badge';
  const ALL_CHUNK_SIZE = 20;
  let allGeneration = 0; // tăng khi tắt/bật lại để dừng vòng dịch cũ

  function ensureEl(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.documentElement.appendChild(el); // ngoài <body> để không bị quét
    }
    return el;
  }

  function segmentRect(seg) {
    const nodes = seg.nodes.filter((n) => n.isConnected);
    if (!nodes.length) return seg.block.getBoundingClientRect();
    const range = new Range();
    range.setStartBefore(nodes[0]);
    range.setEndAfter(nodes[nodes.length - 1]);
    return range.getBoundingClientRect();
  }

  function showTooltip(seg) {
    if (!seg) {
      document.getElementById(TOOLTIP_ID)?.remove();
      return;
    }
    const tip = ensureEl(TOOLTIP_ID);
    tip.classList.toggle('tt-pending', !seg.result);
    tip.classList.toggle('tt-error', seg.result?.ok === false);
    tip.textContent = !seg.result ? t('common.translating') : seg.result.ok ? seg.result.text : t('common.error', { error: seg.result.error });
    positionTooltip(seg);
  }

  // Đặt tooltip ngay dưới đoạn gốc; không đủ chỗ thì đặt phía trên. position: fixed nên dùng toạ độ viewport.
  function positionTooltip(seg) {
    const tip = document.getElementById(TOOLTIP_ID);
    if (!tip) return;
    const rect = segmentRect(seg);
    const gap = 6;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    tip.style.maxWidth = `${Math.min(520, vw - 16)}px`;
    const { width, height } = tip.getBoundingClientRect();
    const top = rect.bottom + gap + height <= vh ? rect.bottom + gap : Math.max(8, rect.top - gap - height);
    tip.style.top = `${top}px`;
    tip.style.left = `${Math.min(Math.max(8, rect.left), vw - width - 8)}px`;
  }

  window.addEventListener('scroll', () => hoveredSeg && translateAllActive && positionTooltip(hoveredSeg), { passive: true, capture: true });

  function setBadge(text, hideAfterMs) {
    const badge = ensureEl(BADGE_ID);
    badge.textContent = text;
    badge.classList.toggle('tt-done', !!hideAfterMs);
    clearTimeout(setBadge.timer);
    if (hideAfterMs) setBadge.timer = setTimeout(() => badge.remove(), hideAfterMs);
  }

  // Đoạn đang thấy trên màn hình được dịch trước, phần còn lại theo thứ tự trong trang.
  function visibleFirst(segments) {
    const vh = window.innerHeight;
    const visible = [];
    const rest = [];
    for (const seg of segments) {
      const r = seg.block.getBoundingClientRect();
      (r.bottom > 0 && r.top < vh ? visible : rest).push(seg);
    }
    return [...visible, ...rest];
  }

  async function startTranslateAll() {
    const gen = ++allGeneration;
    translateAllActive = true;
    const segments = visibleFirst(collectSegments());
    if (!segments.length) return;

    let fromCache = 0;
    // Dịch `list` theo nhóm; -> false nếu đã bị tắt/chạy lại giữa chừng.
    async function run(list) {
      let done = 0;
      setBadge(t('content.allProgress', { done: 0, total: list.length }));
      for (let i = 0; i < list.length; i += ALL_CHUNK_SIZE) {
        const chunk = list.slice(i, i + ALL_CHUNK_SIZE);
        let res;
        try {
          res = await sendToWorker({ type: 'TRANSLATE_MANY', texts: chunk.map((s) => s.text) });
        } catch (err) {
          res = { results: chunk.map(() => ({ ok: false, error: String(err?.message ?? err) })) };
        }
        if (gen !== allGeneration) return false; // đã tắt hoặc chạy lại
        chunk.forEach((seg, j) => (seg.result = res?.results?.[j] ?? { ok: false, error: res?.error ?? t('common.unknown') }));
        fromCache += chunk.filter((seg) => seg.result.cached).length;
        if (hoveredSeg && chunk.includes(hoveredSeg)) showTooltip(hoveredSeg); // đang rê đúng đoạn vừa dịch xong
        done += chunk.length;
        setBadge(t('content.allProgress', { done, total: list.length }));
      }
      return true;
    }
    if (!(await run(segments))) return;
    // Lỗi thoáng qua (rate-limit, mạng, service worker khởi động lại) -> thử lại một lượt các đoạn lỗi.
    const retry = segments.filter((s) => !s.result?.ok);
    if (retry.length) {
      await new Promise((r) => setTimeout(r, 3000));
      if (gen !== allGeneration || !(await run(retry))) return;
    }
    const failed = segments.filter((s) => !s.result?.ok).length;
    const cacheNote = fromCache ? t('content.allFromCache', { n: fromCache, total: segments.length }) : '';
    setBadge(
      failed
        ? t('content.allFailed', { failed, error: segments.find((s) => !s.result?.ok)?.result?.error ?? '' }).slice(0, 160)
        : t('content.allDone', { cache: cacheNote }),
      failed ? 8000 : 4000
    );
  }

  function stopTranslateAll() {
    allGeneration++;
    translateAllActive = false;
    showTooltip(undefined);
    document.getElementById(BADGE_ID)?.remove();
  }

  // Khung dịch nằm ngay trong tab: phần bài đọc thu lại bên trái, khung dịch (iframe trang extension) bên phải,
  // ở giữa là thanh chia kéo được. Dùng Shadow DOM để CSS của trang không ảnh hưởng tới khung.
  const PANEL_ID = 'translator-tool-split';
  const RATIO_KEY = 'splitRatio';
  const DEFAULT_RATIO = 0.2; // khung dịch = 1/5 chiều rộng
  const MIN_PANEL_PX = 180;
  const MIN_PAGE_PX = 320;

  let panel; // { host, iframe, ratio, savedHtmlWidth }

  // Chiều rộng viewport không tính thanh cuộn dọc (clientWidth của <html> luôn là viewport, không phụ thuộc width đã đặt).
  const viewportWidth = () => document.documentElement.clientWidth;

  function clampRatio(ratio) {
    const w = viewportWidth();
    const px = Math.min(Math.max(ratio * w, MIN_PANEL_PX), Math.max(w - MIN_PAGE_PX, MIN_PANEL_PX));
    return px / w;
  }

  function applyLayout() {
    const width = Math.round(clampRatio(panel.ratio) * viewportWidth());
    panel.host.style.setProperty('width', `${width}px`, 'important');
    // Thu chiều rộng <html> để nội dung trang tự xuống dòng trong phần còn lại.
    document.documentElement.style.setProperty('width', `calc(100% - ${width}px)`, 'important');
  }

  function openPanel(tabId) {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'all: initial; position: fixed !important; top: 0 !important; right: 0 !important; ' +
      'height: 100vh !important; z-index: 2147483647 !important; display: block !important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { box-shadow: -8px 0 24px rgba(15, 23, 42, 0.08); }
        .divider {
          position: absolute; top: 0; left: -5px; width: 10px; height: 100%;
          cursor: col-resize; z-index: 1; touch-action: none;
        }
        .divider::before { /* đường chia mảnh */
          content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
          background: rgba(100, 116, 139, 0.3); transition: background 0.15s, width 0.15s, left 0.15s;
        }
        .divider::after { /* tay nắm ở giữa */
          content: ''; position: absolute; top: 50%; left: 2px; width: 6px; height: 40px; margin-top: -20px;
          border-radius: 999px; background: #cbd5e1; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          transition: background 0.15s, height 0.15s, margin-top 0.15s;
        }
        .divider:hover::before, .divider.dragging::before { left: 3px; width: 3px; background: #6366f1; }
        .divider:hover::after, .divider.dragging::after { background: #6366f1; height: 56px; margin-top: -28px; }
        iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
        iframe.dragging { pointer-events: none; } /* để iframe không "nuốt" sự kiện chuột khi kéo */
      </style>
      <div class="divider"></div>
      <iframe></iframe>`;
    const divider = shadow.querySelector('.divider');
    divider.title = t('content.splitDivider');
    const iframe = shadow.querySelector('iframe');
    iframe.src = chrome.runtime.getURL(`src/split/split.html?tabId=${tabId}`);

    panel = { host, iframe, ratio: DEFAULT_RATIO, savedHtmlWidth: document.documentElement.style.getPropertyValue('width') };
    document.documentElement.appendChild(host); // gắn vào <html> (ngoài <body>) để không bị quét khi lấy text
    applyLayout();
    chrome.storage.local.get({ [RATIO_KEY]: DEFAULT_RATIO }).then(({ [RATIO_KEY]: ratio }) => {
      if (!panel) return;
      panel.ratio = ratio;
      applyLayout();
    });

    divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      divider.classList.add('dragging');
      iframe.classList.add('dragging');
    });
    divider.addEventListener('pointermove', (e) => {
      if (!divider.hasPointerCapture(e.pointerId)) return;
      const w = viewportWidth();
      panel.ratio = clampRatio((w - e.clientX) / w);
      applyLayout();
    });
    divider.addEventListener('pointerup', (e) => {
      divider.releasePointerCapture(e.pointerId);
      divider.classList.remove('dragging');
      iframe.classList.remove('dragging');
      chrome.storage.local.set({ [RATIO_KEY]: panel.ratio });
    });
  }

  function closePanel() {
    if (!panel) return;
    panel.host.remove();
    const html = document.documentElement.style;
    if (panel.savedHtmlWidth) html.setProperty('width', panel.savedHtmlWidth);
    else html.removeProperty('width');
    panel = undefined;
    clearSegments();
    splitActive = false;
  }

  window.addEventListener('resize', () => panel && applyLayout());

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TRANSLATE_SELECTION') translateSelection();
    if (message?.type === 'SPLIT_TOGGLE' && IS_TOP) {
      if (panel) closePanel();
      else openPanel(message.tabId);
      sendResponse({ open: !!panel });
    }
    if (message?.type === 'SPLIT_COLLECT') {
      // Khung dịch gửi tới mọi frame; mỗi frame trả đoạn của mình qua SPLIT_SEGMENTS (khung dịch biết frameId qua sender).
      // Chỉ frame chính sendResponse, để khung dịch biết trang có content script hay chưa.
      if (translateAllActive) stopTranslateAll(); // hai chế độ dùng chung danh sách đoạn -> chỉ bật một
      if (isLargeEnough()) {
        splitActive = true;
        const segments = collectSegments();
        chrome.runtime.sendMessage({ type: 'SPLIT_SEGMENTS', segments, host: location.hostname, isTop: IS_TOP }).catch(() => {});
      }
      if (IS_TOP) sendResponse({ ok: true });
    }
    if (message?.type === 'SPLIT_CLOSE') {
      if (IS_TOP) closePanel();
      clearSegments();
      splitActive = false;
    }
    if (message?.type === 'TRANSLATE_ALL_STATE' && IS_TOP) sendResponse({ on: translateAllActive });
    // Popup hỏi chế độ nào đang bật ở tab này để tô nổi nút tương ứng.
    if (message?.type === 'PAGE_MODES' && IS_TOP) sendResponse({ split: !!panel, all: translateAllActive });
    // Service worker hỏi URL trang chính (iframe khác domain không tự đọc được) để lưu bản dịch theo trang.
    if (message?.type === 'PAGE_URL' && IS_TOP) sendResponse(location.href);
    if (message?.type === 'TRANSLATE_ALL_SET') {
      stopTranslateAll();
      clearSegments();
      if (message.on) {
        if (IS_TOP) closePanel(); // tắt Split & Translate nếu đang mở
        splitActive = false;
        if (isLargeEnough()) startTranslateAll();
        else translateAllActive = true; // frame nhỏ: chỉ giữ trạng thái, không quét
      }
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest?.(`#${BUBBLE_ID}`)) removeBubble();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') removeBubble();
  });
})();
