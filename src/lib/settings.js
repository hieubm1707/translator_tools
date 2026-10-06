import { setUiLang } from './i18n.js';

// Lưu trong chrome.storage.local (không dùng sync để API key không bị đồng bộ đi nơi khác).
export const DEFAULT_SETTINGS = {
  uiLang: 'en', // ngôn ngữ giao diện: en | vi (chuỗi trong lib/i18n-messages.js)
  engine: 'google', // engine cho dịch nhanh (popup, vùng chọn): google | googleGTX | googleV2 | gemini | llm
  pageEngine: 'same', // engine cho Split & Translate / Translate All; 'same' = giống engine trên
  geminiApiKey: '',
  geminiModel: '', // trống = DEFAULT_GEMINI_MODEL
  geminiFallbackModels: '', // "model-a, model-b": dùng khi model chính hết quota ngày
  cacheTtlDays: 7, // bộ nhớ bản dịch tự xoá sau N ngày kể từ lúc tạo; 0 = không bao giờ
  sourceLang: 'auto',
  targetLang: 'vi',
  fallback: true, // engine Google lỗi -> thử engine Google khác
  llmProvider: 'openai',
  // Cấu hình riêng cho từng provider để đổi qua lại không mất key: { [provider]: { endpoint, apiKey, model } }
  llmConfigs: {},
  // Phụ đề song ngữ video Coursera (src/content/dualSubs.js giữ bản sao các giá trị mặc định này).
  dualSubEnabled: true,
  dualSubLang1: 'en', // ngôn ngữ dòng 1 (chọn trong các track phụ đề Coursera của video)
  dualSubLang2: 'vi', // ngôn ngữ dòng 2; '' = chỉ hiện 1 dòng
  dualSubSize: 'medium', // small | medium | large | xlarge
  dualSubFree: false, // true = bỏ ghim, kéo thả phụ đề tự do trong khung video
  dualSubPos: null, // { x, y } tỉ lệ 0..1 của khung video (tâm ngang, mép dưới); null = vị trí mặc định
  dualSubStyle: null, // { line1, line2 } dạng DEFAULT_DUAL_SUB_STYLE; null = mặc định
};

// Kiểu hiển thị mặc định từng dòng phụ đề Coursera (dualSubs.js giữ bản sao). bgOpacity: 0..1.
export const DEFAULT_DUAL_SUB_STYLE = {
  line1: { color: '#ffffff', bg: '#080808', bgOpacity: 0.75 },
  line2: { color: '#ffe17a', bg: '#080808', bgOpacity: 0.75 },
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  setUiLang(stored.uiLang); // service worker không có top-level await -> đồng bộ ngôn ngữ mỗi lần đọc cài đặt
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

// Tuổi tối đa của bản dịch đã lưu (ms); Infinity = không hết hạn.
export function cacheMaxAgeMs(settings) {
  const days = Number(settings.cacheTtlDays);
  return days > 0 ? days * 24 * 60 * 60 * 1000 : Infinity;
}
