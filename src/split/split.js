// Trang trong khung dịch (iframe chèn vào tab nguồn). Mọi frame của tab (trang chính + iframe nhúng)
// gửi đoạn text qua SPLIT_SEGMENTS; mỗi frame hiển thị thành một nhóm, dịch theo hàng đợi,
// và đồng bộ highlight khi rê chuột (khoá đoạn = frameId:id).
import { initPageI18n, t } from '../lib/i18n.js';

const tabId = Number(new URLSearchParams(location.search).get('tabId'));
const list = document.getElementById('list');
const status = document.getElementById('status');

// Gửi từng nhóm nhỏ sang service worker (nó tự gộp lô theo byte) để cập nhật tiến độ thường xuyên.
const CHUNK_SIZE = 20;

let generation = 0; // tăng mỗi lần "Dịch lại" để bỏ kết quả cũ còn đang chạy
let items = new Map(); // "frameId:id" -> element
let sections = new Map(); // frameId -> <details>
let queue = []; // [{ gen, chunk: [{ key, text }] }]
let total = 0;
let done = 0;
let pumping = false;
let highlighted;

const keyOf = (frameId, id) => `${frameId}:${id}`;

const progressBar = document.getElementById('progressBar');

function updateStatus() {
  status.textContent = done < total ? t('split.progress', { done, total }) : t('split.done', { total });
  progressBar.style.width = `${total ? (done / total) * 100 : 0}%`;
  progressBar.classList.toggle('done', total > 0 && done >= total);
}

function renderSection(frameId, host, isTop, segments) {
  // Frame gửi lại (vd. khi Dịch lại) -> thay nhóm cũ.
  sections.get(frameId)?.remove();

  const section = document.createElement('details');
  section.open = true;
  const summary = document.createElement('summary');
  summary.textContent = `${isTop ? t('split.mainPage') : t('split.embedded')} · ${host || t('split.page')} (${segments.length})`;
  section.append(summary);

  for (const { id, text } of segments) {
    const el = document.createElement('div');
    el.className = 'item pending';
    el.textContent = text;
    items.set(keyOf(frameId, id), el);
    section.append(el);
  }
  // Trang chính luôn ở trên cùng, các iframe xếp sau theo thứ tự gửi về.
  if (isTop) list.prepend(section);
  else list.append(section);
  sections.set(frameId, section);
}

function setResult(gen, key, text, isError = false) {
  const el = items.get(key);
  if (gen !== generation || !el) return;
  el.classList.remove('pending');
  el.classList.toggle('error', isError);
  if (isError) el.title = text;
  else el.textContent = text;
}

async function translateChunk(gen, chunk) {
  const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE_MANY', texts: chunk.map((s) => s.text) });
  chunk.forEach((seg, i) => {
    const r = res?.results?.[i] ?? { ok: false, error: res?.error };
    setResult(gen, seg.key, r?.ok ? r.text : t('common.error', { error: r?.error ?? t('common.unknown') }), !r?.ok);
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const { gen, chunk } = queue.shift();
    if (gen !== generation) continue;
    updateStatus();
    await translateChunk(gen, chunk);
    if (gen === generation) done += chunk.length;
  }
  pumping = false;
  updateStatus();
}

async function collect() {
  generation++;
  items = new Map();
  sections = new Map();
  queue = [];
  total = 0;
  done = 0;
  highlighted = undefined;
  list.replaceChildren();
  status.textContent = t('split.reading');
  progressBar.classList.remove('done');
  progressBar.style.width = '0';
  try {
    // Gửi tới mọi frame của tab; chỉ frame chính trả lời để xác nhận content script đang chạy.
    await chrome.tabs.sendMessage(tabId, { type: 'SPLIT_COLLECT' });
  } catch {
    status.textContent = t('split.readFailed');
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab?.id !== tabId) return;
  const frameId = sender.frameId ?? 0;

  if (message?.type === 'SPLIT_SEGMENTS') {
    const segments = message.segments ?? [];
    if (!segments.length) return; // frame không có text (vd. iframe quảng cáo) -> không hiện nhóm
    // Frame gửi lại -> trừ số đoạn cũ của frame đó khỏi tổng.
    const old = sections.get(frameId);
    if (old) total -= old.querySelectorAll('.item').length;
    renderSection(frameId, message.host, message.isTop, segments);
    total += segments.length;
    const gen = generation;
    const keyed = segments.map((s) => ({ key: keyOf(frameId, s.id), text: s.text }));
    for (let i = 0; i < keyed.length; i += CHUNK_SIZE) {
      queue.push({ gen, chunk: keyed.slice(i, i + CHUNK_SIZE) });
    }
    updateStatus();
    pump();
  }

  // Content script (ở frame nào cũng được) báo đoạn nào đang được rê chuột.
  if (message?.type === 'SPLIT_HOVER') {
    highlighted?.classList.remove('hl');
    highlighted = message.id == null ? undefined : items.get(keyOf(frameId, message.id));
    if (highlighted) {
      highlighted.parentElement.open = true; // mở nhóm nếu đang thu gọn
      highlighted.classList.add('hl');
      highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
});

document.getElementById('refresh').addEventListener('click', collect);
document.getElementById('close').addEventListener('click', () => {
  chrome.tabs.sendMessage(tabId, { type: 'SPLIT_CLOSE' });
});

await initPageI18n(() => total && updateStatus());
collect();
