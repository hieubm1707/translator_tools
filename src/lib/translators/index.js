import google from './google.js';
import googleGTX from './googleGTX.js';
import googleV2 from './googleV2.js';
import gemini from './gemini.js';
import llm from './llm/index.js';

export const ENGINES = { google, googleGTX, googleV2, gemini, llm };

// Bật/tắt tính năng mà không xoá code. LLM chung (OpenAI/Claude/local…) đang tạm ẩn: không hiện trong
// popup/Cài đặt, cài đặt cũ đang chọn "llm" sẽ tự dùng Google. Bật lại: đặt true và thêm lại
// "optional_host_permissions": ["https://*/*"] vào manifest.json (thêm "http://localhost/*", "http://127.0.0.1/*"
// nếu cần Ollama/LM Studio) — endpoint LLM được xin quyền lúc runtime qua lib/permissions.js.
export const FEATURES = { llm: false };

export function isEngineEnabled(name) {
  return name in ENGINES && (name !== 'llm' || FEATURES.llm);
}

// Engine người dùng chọn được: [[name, label], ...]
export function availableEngines() {
  return Object.entries(ENGINES)
    .filter(([name]) => isEngineEnabled(name))
    .map(([name, engine]) => [name, engine.label]);
}

// Engine thực sự dùng: engine đã lưu nếu còn bật, không thì Google.
export function effectiveEngine(name) {
  return isEngineEnabled(name) ? name : 'google';
}

// Thứ tự thử khi engine Google đang chọn bị lỗi.
export const GOOGLE_FALLBACK_ORDER = ['google', 'googleGTX', 'googleV2'];

// Khoá bộ nhớ bản dịch theo "nguồn bản dịch": 3 engine Google trả cùng model Cổ điển nên dùng chung;
// Gemini dùng chung cho mọi model (đổi model không dịch lại); LLM tách theo provider/model.
export function cacheIdOf(name, settings) {
  if (GOOGLE_FALLBACK_ORDER.includes(name)) return 'google';
  return ENGINES[name].cacheId?.(settings) ?? name;
}
