// Service worker: chạy nền, không có DOM. Chỉ chạy khi có sự kiện rồi tự tắt,
// nên đừng giữ state quan trọng trong biến toàn cục — dùng chrome.storage.
import { translate, translateMany } from '../lib/translate.js';
import { toggleSplit } from '../lib/splitToggle.js';
import { toggleTranslateAll } from '../lib/translateAllToggle.js';
import { getSettings, cacheMaxAgeMs } from '../lib/settings.js';
import * as translationCache from '../lib/translationCache.js';
import { t } from '../lib/i18n.js';

const MENU_ID = 'translate-selection';
const SPLIT_MENU_ID = 'split-translate';
const ALL_MENU_ID = 'translate-all';

// Menu chuột phải là menu gốc của Chrome (không style bằng CSS được). Chrome tự gom các mục
// của extension vào một submenu "Translator Tool" có icon; ở đây chỉ sắp thứ tự + dấu phân cách.
// Tránh ký tự "&" trong title: trên Windows/Linux nó là ký hiệu phím tắt (mnemonic) và bị ẩn.
const OPTIONS_MENU_ID = 'open-options';

// Tiêu đề menu theo ngôn ngữ giao diện; đổi ngôn ngữ -> dựng lại menu.
// Các lần dựng chạy nối tiếp nhau để removeAll/create không xen kẽ (trùng id).
let menuQueue = Promise.resolve();
function createMenus() {
  menuQueue = menuQueue.then(buildMenus).catch(console.error);
  return menuQueue;
}

async function buildMenus() {
  await getSettings(); // đồng bộ ngôn ngữ giao diện trước khi lấy tiêu đề
  await chrome.contextMenus.removeAll();
  const menus = [
    { id: MENU_ID, title: t('menu.translate'), contexts: ['selection'] },
    { id: 'sep-selection', type: 'separator', contexts: ['selection'] },
    { id: SPLIT_MENU_ID, title: t('menu.split'), contexts: ['page', 'selection'] },
    { id: ALL_MENU_ID, title: t('menu.all'), contexts: ['page', 'selection'] },
    { id: 'sep-options', type: 'separator', contexts: ['page', 'selection'] },
    { id: OPTIONS_MENU_ID, title: t('menu.options'), contexts: ['page', 'selection'] },
  ];
  for (const menu of menus) chrome.contextMenus.create(menu);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'uiLang' in changes) createMenus();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // Mỗi bản cập nhật xoá toàn bộ bộ nhớ bản dịch (cách tính hash/định dạng có thể đã đổi).
  // Lưu ý: bấm "Reload" extension unpacked cũng tính là update.
  if (reason === 'update') translationCache.clear().catch(console.error);
  scheduleCacheCleanup();
  createMenus();
});

// ---- Dọn bản dịch hết hạn ----
// Service worker tự tắt khi rảnh nên không dùng setTimeout; chrome.alarms đánh thức nó mỗi ngày.
// (Khi đọc, bản quá hạn đã bị coi như chưa có -> việc dọn chỉ để giải phóng dung lượng.)
const CLEANUP_ALARM = 'translation-cache-cleanup';

function scheduleCacheCleanup() {
  chrome.alarms.create(CLEANUP_ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

async function cleanupExpired() {
  const maxAge = cacheMaxAgeMs(await getSettings());
  if (maxAge === Infinity) return;
  const deleted = await translationCache.deleteOlderThan(Date.now() - maxAge);
  if (deleted) console.log(`[cache] đã xoá ${deleted} bản dịch hết hạn`);
}

chrome.runtime.onStartup.addListener(() => {
  scheduleCacheCleanup(); // alarm có thể mất khi trình duyệt khởi động lại
  cleanupExpired().catch(console.error);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANUP_ALARM) cleanupExpired().catch(console.error);
});

// ---- URL trang để lưu bản dịch theo trang ----
// URL đầy đủ của trang trên thanh địa chỉ (bỏ phần #anchor). Request có thể đến từ iframe khác domain
// (vd. bài giảng Coursera) hoặc từ khung Split -> hỏi content script ở frame chính. Popup: '' (dùng chung).
function normalizeSite(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    u.hash = '';
    return u.href;
  } catch {
    return '';
  }
}

async function siteOf(sender) {
  if (!sender.tab?.id) return '';
  if (sender.frameId === 0 && sender.url) return normalizeSite(sender.url);
  const url = await chrome.tabs.sendMessage(sender.tab.id, { type: 'PAGE_URL' }, { frameId: 0 }).catch(() => '');
  return normalizeSite(url ?? '');
}

// Click chuột phải -> "Dịch ..."
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id) {
    // Gửi đúng frame chứa vùng chọn (có thể là iframe).
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' }, { frameId: info.frameId ?? 0 });
  }
  if (info.menuItemId === SPLIT_MENU_ID && tab?.id) {
    toggleSplit(tab.id).catch(console.error);
  }
  if (info.menuItemId === ALL_MENU_ID && tab?.id) {
    toggleTranslateAll(tab.id).catch(console.error);
  }
  if (info.menuItemId === OPTIONS_MENU_ID) chrome.runtime.openOptionsPage();
});

// Phím tắt (Alt+T)
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'translate-selection' && tab?.id) {
    // Không biết frame nào có vùng chọn -> gửi mọi frame, frame không có vùng chọn sẽ bỏ qua.
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' });
  }
});

// Content script / popup gửi { type: 'TRANSLATE', text } -> trả về kết quả dịch.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TRANSLATE_MANY') {
    siteOf(sender)
      .then((site) => translateMany(message.texts, { purpose: message.purpose ?? 'page', site }))
      .then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
    return true;
  }
  if (message?.type !== 'TRANSLATE') return false;

  siteOf(sender)
    .then((site) => translate(message.text, { site }))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));

  return true; // giữ kênh mở để sendResponse bất đồng bộ
});
