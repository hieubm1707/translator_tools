// Dùng cho OpenAI, Gemini, Grok, Groq, OpenRouter, GitHub Models, Ollama, LM Studio, custom.
// Không gửi temperature: một số model mới (vd. dòng reasoning của OpenAI) từ chối giá trị khác mặc định.
import { buildPrompt } from './prompt.js';

function headers(config) {
  const h = { 'Content-Type': 'application/json' };
  if (config.apiKey) h.Authorization = `Bearer ${config.apiKey}`;
  return h;
}

export async function translate(config, text, sourceLang, targetLang) {
  const { system, user } = buildPrompt(text, sourceLang, targetLang);
  const res = await fetch(`${config.endpoint}/chat/completions`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Empty response');
  return { text: out, detectedLang: '' };
}

export async function listModels(config) {
  const res = await fetch(config.modelsUrl ?? `${config.endpoint}/models`, { headers: headers(config) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // OpenAI: {data:[{id}]}; Ollama: {models:[{name}]}; GitHub catalog: [{id}]
  const list = Array.isArray(data) ? data : data.data ?? data.models ?? [];
  return list.map((m) => m.id ?? m.name ?? m.model).filter(Boolean);
}
