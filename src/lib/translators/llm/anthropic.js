// Claude Messages API, gọi raw HTTP (extension không có bước build nên không dùng SDK).
import { buildPrompt } from './prompt.js';
import { t } from '../../i18n.js';

// Model hỗ trợ output_config.effort -> dịch thuật để "low" cho nhanh và rẻ.
const EFFORT_MODELS = /^claude-(fable-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/;
// Model hỗ trợ fallbacks:"default": request bị bộ lọc an toàn từ chối sẽ được chạy lại trên model khác phía server.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

function headers(config) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    // Bắt buộc khi gọi trực tiếp từ trình duyệt/extension (request có header Origin).
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export async function translate(config, text, sourceLang, targetLang) {
  const { system, user } = buildPrompt(text, sourceLang, targetLang);
  const body = {
    model: config.model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
  };
  const h = headers(config);
  if (EFFORT_MODELS.test(config.model)) body.output_config = { effort: 'low' };
  if (FALLBACK_MODELS.has(config.model)) {
    body.fallbacks = 'default';
    h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }

  const res = await fetch(`${config.endpoint}/messages`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error(t('err.claudeRefusal'));
  const out = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!out) throw new Error('Empty response');
  return { text: out, detectedLang: '' };
}

export async function listModels(config) {
  const res = await fetch(`${config.endpoint}/models?limit=100`, { headers: headers(config) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data.map((m) => m.id);
}
