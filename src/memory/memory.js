// Trang xem bộ nhớ bản dịch (IndexedDB dùng chung với service worker): bảng phân trang + tìm kiếm.
import * as translationCache from '../lib/translationCache.js';
import { LANGUAGES } from '../lib/langs.js';
import { getSettings, cacheMaxAgeMs } from '../lib/settings.js';
import { initPageI18n, t, locale } from '../lib/i18n.js';

const PAGE_SIZE = 50;
const $ = (id) => document.getElementById(id);
let page = 0;
let query = '';
const maxAgeMs = cacheMaxAgeMs(await getSettings());
const dateFmt = () => new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' });
const num = (n) => n.toLocaleString(locale());
await initPageI18n(() => render()); // đổi ngôn ngữ giao diện -> dựng lại bảng

function expiryNote(createdAt) {
  if (maxAgeMs === Infinity) return '';
  const days = Math.ceil((createdAt + maxAgeMs - Date.now()) / 86400000);
  return days > 0 ? t('memory.daysLeft', { days }) : t('memory.expired');
}

function siteCell(site) {
  const td = document.createElement('td');
  td.className = 'site';
  if (!site) {
    td.className = 'legacy';
    td.textContent = site === '' ? '(popup)' : '—';
    return td;
  }
  const a = document.createElement('a');
  a.href = site;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = site;
  a.textContent = site.replace(/^https?:\/\//, '');
  td.append(a);
  return td;
}

const langLabel = (code) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

function engineLabel(id) {
  if (!id) return '—';
  if (id === 'google') return t('memory.googleClassic');
  if (id === 'gemini' || id.startsWith('gemini:')) return 'Gemini';
  return id;
}

// Tô từ khoá tìm kiếm; dựng bằng text node (không innerHTML) vì nội dung đến từ trang web.
function textCell(text, className = 'text') {
  const td = document.createElement('td');
  td.className = className;
  if (text == null) {
    td.className = 'legacy';
    td.textContent = t('memory.legacy');
    return td;
  }
  if (!query) {
    td.textContent = text;
    return td;
  }
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    td.append(text.slice(from, at));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + q.length);
    td.append(mark);
    from = at + q.length;
  }
  td.append(text.slice(from));
  return td;
}

function row(entry, index) {
  const tr = document.createElement('tr');

  const no = document.createElement('td');
  no.className = 'index';
  no.textContent = String(index);

  const engine = document.createElement('td');
  const name = document.createElement('span');
  name.className = 'engine-name';
  name.textContent = engineLabel(entry.engine);
  engine.append(name);
  if (entry.sourceLang && entry.targetLang) {
    const pair = document.createElement('span');
    pair.className = 'lang-pair';
    pair.textContent = `${langLabel(entry.sourceLang)} → ${langLabel(entry.targetLang)}`;
    engine.append(pair);
  }
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = t('memory.savedAt', { date: dateFmt().format(entry.createdAt) }) + expiryNote(entry.createdAt);
  engine.append(meta);

  tr.append(no, engine, siteCell(entry.site), textCell(entry.source), textCell(entry.translation));
  return tr;
}

async function render() {
  const { rows, total } = await translationCache.listPage({ offset: page * PAGE_SIZE, limit: PAGE_SIZE, query });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page >= pages) {
    page = pages - 1;
    return render();
  }
  $('rows').replaceChildren(...rows.map((entry, i) => row(entry, page * PAGE_SIZE + i + 1)));
  $('empty').hidden = rows.length > 0;
  $('empty').textContent = query ? t('memory.noMatch', { query }) : t('memory.empty');
  $('pageInfo').textContent = t('memory.pageInfo', { page: page + 1, pages });
  $('prev').disabled = page === 0;
  $('next').disabled = page >= pages - 1;

  const all = await translationCache.count();
  $('summary').textContent = query
    ? t('memory.matchSummary', { n: num(total), all: num(all) })
    : t('memory.summary', { n: num(all) }) +
      (maxAgeMs === Infinity ? t('memory.noAutoDelete') : t('memory.autoDelete', { days: Math.round(maxAgeMs / 86400000) }));
}

function flash(msg) {
  $('status').textContent = msg;
  $('status').classList.add('show');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => $('status').classList.remove('show'), 3000);
}

let searchTimer;
$('query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = $('query').value.trim();
    page = 0;
    render();
  }, 250);
});
$('prev').addEventListener('click', () => {
  page--;
  render();
});
$('next').addEventListener('click', () => {
  page++;
  render();
});
$('clearCache').addEventListener('click', async () => {
  if (!confirm(t('memory.confirmClear'))) return;
  await translationCache.clear();
  new BroadcastChannel('translation-cache').postMessage('cleared'); // trang Cài đặt đang mở cập nhật số lượng
  page = 0;
  await render();
  flash(t('memory.cleared'));
});

render();
