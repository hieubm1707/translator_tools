// api: 'openai' -> chuẩn OpenAI /chat/completions; 'anthropic' -> Claude Messages API.
// defaultModel chỉ đặt khi chắc chắn; còn lại người dùng bấm "Tải danh sách model".
import { t } from '../../i18n.js'; // label dạng getter: đổi theo ngôn ngữ giao diện

export const LLM_PROVIDERS = {
  openai: { label: 'OpenAI (ChatGPT)', api: 'openai', endpoint: 'https://api.openai.com/v1', needsKey: true },
  claude: { label: 'Claude (Anthropic)', api: 'anthropic', endpoint: 'https://api.anthropic.com/v1', needsKey: true, defaultModel: 'claude-opus-5-5' },
  gemini: { get label() { return t('llm.gemini'); }, api: 'openai', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true },
  grok: { label: 'Grok (xAI)', api: 'openai', endpoint: 'https://api.x.ai/v1', needsKey: true },
  groq: { get label() { return t('llm.groq'); }, api: 'openai', endpoint: 'https://api.groq.com/openai/v1', needsKey: true },
  openrouter: { get label() { return t('llm.openrouter'); }, api: 'openai', endpoint: 'https://openrouter.ai/api/v1', needsKey: true },
  githubModels: {
    get label() { return t('llm.github'); }, api: 'openai',
    endpoint: 'https://models.github.ai/inference', modelsUrl: 'https://models.github.ai/catalog/models', needsKey: true,
  },
  ollama: { label: 'Ollama (local)', api: 'openai', endpoint: 'http://localhost:11434/v1', needsKey: false },
  lmstudio: { label: 'LM Studio (local)', api: 'openai', endpoint: 'http://localhost:1234/v1', needsKey: false },
  custom: { get label() { return t('llm.custom'); }, api: 'openai', endpoint: '', needsKey: false },
};

// Gộp preset với cấu hình người dùng đã lưu cho provider đó.
export function resolveLlmConfig(settings) {
  const id = settings.llmProvider;
  const preset = LLM_PROVIDERS[id] ?? LLM_PROVIDERS.custom;
  const saved = settings.llmConfigs?.[id] ?? {};
  return {
    id,
    ...preset,
    endpoint: (id === 'custom' ? saved.endpoint : preset.endpoint)?.replace(/\/$/, '') ?? '',
    apiKey: saved.apiKey ?? '',
    model: saved.model || preset.defaultModel || '',
  };
}
