// Đa ngôn ngữ cho trang extension + service worker. Chuỗi nằm trong i18n-messages.js (dùng chung với content script).
// HTML: data-i18n (text), data-i18n-html (chuỗi có thẻ, nội dung tĩnh), data-i18n-title, data-i18n-placeholder.
import './i18n-messages.js';

const i18n = globalThis.TT_I18N;

export const UI_LANGS = i18n.LANGS;
export const t = (key, params) => i18n.t(key, params);
export const locale = () => i18n.locale();
export const uiLang = () => i18n.lang;
export const setUiLang = (lang) => i18n.setLang(lang);
export const onUiLangChange = (fn) => i18n.onChange(fn);

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  if (root === document) document.documentElement.lang = i18n.lang;
}

// Gọi đầu mỗi trang (trước khi dựng phần động): đọc ngôn ngữ đã lưu, dịch DOM tĩnh,
// và tự dịch lại khi người dùng đổi ngôn ngữ (onChange để trang tự cập nhật phần động).
export async function initPageI18n(onChange) {
  const { uiLang: stored } = await chrome.storage.local.get({ uiLang: i18n.DEFAULT_LANG });
  setUiLang(stored);
  applyI18n();
  onUiLangChange(() => {
    applyI18n();
    onChange?.();
  });
}
