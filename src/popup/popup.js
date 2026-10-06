// Popup: trang HTML nhỏ mở ra khi bấm icon extension. Bị đóng là mất state.
import { ENGINES, availableEngines, effectiveEngine } from '../lib/translators/index.js';
import { getSettings, saveSettings, DEFAULT_DUAL_SUB_STYLE } from '../lib/settings.js';
import { LANGUAGES } from '../lib/langs.js';
import { toggleSplit } from '../lib/splitToggle.js';
import { toggleTranslateAll } from '../lib/translateAllToggle.js';
import { initPageI18n, t } from '../lib/i18n.js';

await initPageI18n();

const $ = (id) => document.getElementById(id);
const input = $('input');
const output = $('output');
const engineLabel = $('engine');

function showOutput(text, state = '') {
  $('resultCard').hidden = false;
  output.textContent = text;
  output.className = state;
}

// Ba dropdown: dịch từ / dịch sang / engine. Đổi là lưu ngay (service worker đọc cài đặt mỗi lần dịch).
const settings = await getSettings();
const fill = (select, entries, value) => {
  select.replaceChildren(...entries.map(([v, label]) => new Option(label, v)));
  select.value = value;
};
fill($('sourceLang'), LANGUAGES.map((l) => [l.code, l.label]), settings.sourceLang);
fill($('targetLang'), LANGUAGES.filter((l) => l.code !== 'auto').map((l) => [l.code, l.label]), settings.targetLang);
fill($('engineSelect'), availableEngines(), effectiveEngine(settings.engine)); // LLM ẩn khi FEATURES.llm = false

async function saveSelection() {
  // Chờ lưu xong rồi mới dịch lại, vì service worker đọc cài đặt từ storage lúc dịch.
  await saveSettings({
    sourceLang: $('sourceLang').value,
    targetLang: $('targetLang').value,
    engine: $('engineSelect').value,
  });
  // Đang có kết quả -> dịch lại theo lựa chọn mới.
  if (!$('resultCard').hidden && input.value.trim()) translateInput();
}
for (const id of ['sourceLang', 'targetLang', 'engineSelect']) $(id).addEventListener('change', saveSelection);

$('swapLang').addEventListener('click', () => {
  // "Tự nhận diện" không thể là ngôn ngữ đích -> nguồn auto thì chỉ đưa đích cũ lên làm nguồn.
  const from = $('sourceLang').value;
  $('sourceLang').value = $('targetLang').value;
  if (from !== 'auto') $('targetLang').value = from;
  saveSelection();
});

let requestSeq = 0; // chỉ hiển thị kết quả của lần dịch mới nhất (đổi dropdown liên tục -> nhiều request chồng nhau)

async function translateInput() {
  const text = input.value.trim();
  if (!text) return input.focus();
  const seq = ++requestSeq;

  const button = $('translate');
  button.disabled = true;
  showOutput(t('common.translating'), 'pending');
  engineLabel.textContent = '';
  const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text });
  if (seq !== requestSeq) return;
  button.disabled = false;
  if (res?.ok) {
    showOutput(res.text);
    engineLabel.textContent = t('popup.via', { engine: ENGINES[res.engine]?.label ?? res.engine });
  } else {
    showOutput(t('common.error', { error: res?.error ?? t('common.unknown') }), 'error');
  }
}

$('translate').addEventListener('click', translateInput);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) translateInput();
});

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.textContent);
  engineLabel.textContent = t('popup.copied');
});

// Split & Translate / Translate All: content script trong trang làm phần việc chính.
function bindPageAction(buttonId, toggle) {
  $(buttonId).addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      await toggle(tab.id);
      window.close();
    } catch {
      showOutput(t('popup.pageError'), 'error');
    }
  });
}
bindPageAction('split', toggleSplit);
bindPageAction('all', toggleTranslateAll);

// Tô nổi chế độ đang bật ở tab hiện tại (trang chưa có content script -> không trả lời -> để nguyên).
async function showActiveModes() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const modes = await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_MODES' }, { frameId: 0 }).catch(() => null);
  $('split').setAttribute('aria-pressed', String(!!modes?.split));
  $('all').setAttribute('aria-pressed', String(!!modes?.all));
}
showActiveModes();

// Phụ đề song ngữ Coursera: lưu ngay khi đổi, content script trên trang Coursera nghe storage.onChanged.
// Danh sách ngôn ngữ = các track phụ đề Coursera cung cấp cho video ở tab hiện tại (hỏi content script).
$('dualSubSize').value = settings.dualSubSize;
$('dualSubEnabled').checked = settings.dualSubEnabled;
$('dualSubEnabled').addEventListener('change', (e) => saveSettings({ dualSubEnabled: e.target.checked }));
$('dualSubSize').addEventListener('change', (e) => saveSettings({ dualSubSize: e.target.value }));
$('dualSubFree').checked = settings.dualSubFree;
$('dualSubFree').addEventListener('change', (e) => saveSettings({ dualSubFree: e.target.checked }));
$('dualSubLang1').addEventListener('change', (e) => saveSettings({ dualSubLang1: e.target.value }));
$('dualSubLang2').addEventListener('change', (e) => saveSettings({ dualSubLang2: e.target.value }));

function langLabel(code) {
  return LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase())?.label ?? code;
}

// Ngôn ngữ đã chọn mà video này không có vẫn giữ trong danh sách (để không mất lựa chọn khi sang video khác).
function fillTrackSelect(select, tracks, value, extra = []) {
  const entries = [...extra, ...tracks.map((t) => [t.lang, t.label])];
  if (value && !entries.some(([v]) => v === value.toLowerCase())) {
    entries.push([value.toLowerCase(), tracks.length ? t('subs.notInVideo', { lang: langLabel(value) }) : langLabel(value)]);
  }
  fill(select, entries, value.toLowerCase());
}

// ---- Kiểu hiển thị phụ đề: màu chữ / màu nền / độ đậm nền cho từng dòng ----
// Dùng ô màu có sẵn thay vì <input type="color">: trên macOS bảng chọn màu hệ thống lấy focus làm popup tự đóng.
const TEXT_COLORS = ['#ffffff', '#ffe17a', '#facc15', '#fdba74', '#f9a8d4', '#86efac', '#67e8f9', '#d1d5db', '#000000'];
const BG_COLORS = ['#080808', '#374151', '#1e3a8a', '#14532d', '#4c1d95', '#7f1d1d', '#ffffff', '#fef3c7'];

const cloneStyle = (s) => ({
  line1: { ...DEFAULT_DUAL_SUB_STYLE.line1, ...s?.line1 },
  line2: { ...DEFAULT_DUAL_SUB_STYLE.line2, ...s?.line2 },
});
let subStyle = cloneStyle(settings.dualSubStyle);
let activeLine = 'line1';

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildSwatches(container, colors, prop) {
  container.replaceChildren(...colors.map((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.dataset.color = color;
    btn.title = color;
    btn.setAttribute('aria-label', color);
    btn.style.setProperty('--sw', color);
    btn.addEventListener('click', () => {
      subStyle[activeLine][prop] = color;
      renderStyle();
      saveStyle();
    });
    return btn;
  }));
}

function renderStyle() {
  const style = subStyle[activeLine];
  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.line === activeLine);
    btn.setAttribute('aria-selected', String(btn.dataset.line === activeLine));
  }
  for (const pv of document.querySelectorAll('.pv')) {
    const s = subStyle[pv.dataset.line];
    pv.style.color = s.color;
    pv.style.background = rgba(s.bg, s.bgOpacity);
    pv.classList.toggle('active', pv.dataset.line === activeLine);
  }
  for (const [id, prop] of [['swText', 'color'], ['swBg', 'bg']]) {
    for (const btn of $(id).children) btn.classList.toggle('selected', btn.dataset.color === style[prop]);
  }
  const pct = Math.round(style.bgOpacity * 100);
  $('bgOpacity').value = String(pct);
  $('bgOpacityValue').textContent = `${pct}%`;
}

// Kéo thanh trượt bắn nhiều sự kiện -> gom lại rồi mới ghi storage (content script áp dụng khi storage đổi).
let saveTimer;
function saveStyle() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings({ dualSubStyle: subStyle }), 120);
}

buildSwatches($('swText'), TEXT_COLORS, 'color');
buildSwatches($('swBg'), BG_COLORS, 'bg');
for (const btn of document.querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', () => {
    activeLine = btn.dataset.line;
    renderStyle();
  });
}
$('bgOpacity').addEventListener('input', (e) => {
  subStyle[activeLine].bgOpacity = Number(e.target.value) / 100;
  renderStyle();
  saveStyle();
});
$('resetStyle').addEventListener('click', () => {
  clearTimeout(saveTimer);
  subStyle = cloneStyle(null);
  renderStyle();
  saveSettings({ dualSubStyle: null });
});
renderStyle();

// Tính năng chỉ dành cho Coursera: tab khác thì giữ ẩn cả mục (tab.url đọc được nhờ quyền activeTab).
const COURSERA_HOSTS = new Set(['coursera.org', 'www.coursera.org']);
function isCourseraUrl(url) {
  try {
    return COURSERA_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function loadSubtitleLanguages() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isCourseraUrl(tab?.url)) return;
  $('dualSubSection').hidden = false;
  const res = tab?.id
    ? await chrome.tabs.sendMessage(tab.id, { type: 'DUAL_SUB_TRACKS' }, { frameId: 0 }).catch(() => null)
    : null;
  const tracks = res?.tracks ?? [];
  fillTrackSelect($('dualSubLang1'), tracks, settings.dualSubLang1);
  fillTrackSelect($('dualSubLang2'), tracks, settings.dualSubLang2, [['', t('subs.none')]]);
  const noList = !tracks.length;
  $('dualSubLang1').disabled = noList;
  $('dualSubLang2').disabled = noList;
  $('dualSubHint').textContent = !noList ? t('subs.hint') : res?.isLecture ? t('subs.hintLoading') : t('subs.hintOpenLecture');
}
loadSubtitleLanguages();

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

input.focus();
