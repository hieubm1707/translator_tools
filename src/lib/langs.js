import { t } from './i18n.js';

// code: mã kiểu Google Translate; name: tên tiếng Anh (dùng trong prompt LLM); label: hiển thị UI.
export const LANGUAGES = [
  { code: 'auto', name: 'auto-detected language', get label() { return t('lang.auto'); } }, // theo ngôn ngữ giao diện
  { code: 'vi', name: 'Vietnamese', label: 'Tiếng Việt' },
  { code: 'en', name: 'English', label: 'English' },
  { code: 'ja', name: 'Japanese', label: '日本語' },
  { code: 'ko', name: 'Korean', label: '한국어' },
  { code: 'zh-CN', name: 'Simplified Chinese', label: '中文 (简体)' },
  { code: 'zh-TW', name: 'Traditional Chinese', label: '中文 (繁體)' },
  { code: 'fr', name: 'French', label: 'Français' },
  { code: 'de', name: 'German', label: 'Deutsch' },
  { code: 'es', name: 'Spanish', label: 'Español' },
  { code: 'ru', name: 'Russian', label: 'Русский' },
  { code: 'th', name: 'Thai', label: 'ไทย' },
];

export function langName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
