// Điều phối dịch: bộ nhớ bản dịch (hash từng đoạn) -> engine (theo lô) -> fallback giữa các engine Google.
// LLM/Gemini không fallback sang Google để không gửi văn bản tới nơi người dùng không chọn.
import { ENGINES, GOOGLE_FALLBACK_ORDER, effectiveEngine, cacheIdOf } from './translators/index.js';
import { BatchMismatchError } from './translators/errors.js';
import { getSettings, cacheMaxAgeMs } from './settings.js';
import * as cache from './translationCache.js';
import { t } from './i18n.js';

const DEFAULT_BATCH_LIMITS = { maxBytes: 1500, maxItems: 50 }; // endpoint Google dùng GET -> giới hạn theo byte
const GOOGLE_BATCH_PAUSE_MS = 100; // giãn request để Google không rate-limit
const encoder = new TextEncoder();

// purpose 'page' = Split & Translate / Translate All (dùng "Engine dịch cả trang"), 'quick' = popup / vùng chọn.
export function engineFor(settings, purpose) {
  const chosen = purpose === 'page' && settings.pageEngine && settings.pageEngine !== 'same' ? settings.pageEngine : settings.engine;
  return effectiveEngine(chosen);
}

function candidates(engine, settings) {
  return settings.fallback && GOOGLE_FALLBACK_ORDER.includes(engine)
    ? [engine, ...GOOGLE_FALLBACK_ORDER.filter((e) => e !== engine)]
    : [engine];
}

function toBatches(items, { maxBytes, maxItems }) {
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const item of items) {
    const size = encoder.encode(item).length + 1;
    if (batch.length && (bytes + size > maxBytes || batch.length >= maxItems)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(item);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// Một lô qua một engine -> string[] cùng độ dài. Engine không có translateBatch thì nối bằng "\n".
async function runBatch(name, texts, settings) {
  const engine = ENGINES[name];
  const { sourceLang, targetLang } = settings;
  if (engine.translateBatch) return engine.translateBatch(texts, sourceLang, targetLang, settings);
  const res = await engine.translate(texts.join('\n'), sourceLang, targetLang, settings);
  const lines = res.text.split('\n').map((l) => l.trim());
  if (lines.length !== texts.length) throw new BatchMismatchError();
  return lines;
}

// -> [{ ok, text?, error?, engine }] cùng thứ tự `texts`
async function translateTexts(engineName, texts, settings) {
  const errors = [];
  for (const name of candidates(engineName, settings)) {
    try {
      return (await runBatch(name, texts, settings)).map((text) => ({ ok: true, text, engine: name }));
    } catch (err) {
      if (err instanceof BatchMismatchError) {
        if (texts.length === 1) {
          errors.push(t('err.invalidResult', { engine: ENGINES[name].label }));
          continue;
        }
        // Engine chạy được nhưng gộp/tách đoạn -> chia đôi lô.
        const mid = Math.ceil(texts.length / 2);
        return [
          ...(await translateTexts(engineName, texts.slice(0, mid), settings)),
          ...(await translateTexts(engineName, texts.slice(mid), settings)),
        ];
      }
      errors.push(`${ENGINES[name]?.label ?? name}: ${err?.message ?? err}`);
    }
  }
  return texts.map(() => ({ ok: false, error: errors.join(' | '), engine: engineName }));
}

// Dịch nhiều đoạn. site = URL trang (bản dịch lưu riêng cho từng trang; '' cho popup).
// -> [{ ok, text?, error?, engine, cached? }] cùng thứ tự `texts`.
export async function translateMany(texts, { purpose = 'page', site = '' } = {}) {
  const settings = await getSettings();
  const engineName = engineFor(settings, purpose);
  const { sourceLang, targetLang } = settings;

  const results = new Array(texts.length);
  let keys;
  let cacheId;
  try {
    cacheId = cacheIdOf(engineName, settings);
    keys = await Promise.all(texts.map((t) => cache.hashKey(site, cacheId, sourceLang, targetLang, t)));
  } catch (err) {
    // cacheIdOf có thể ném lỗi cấu hình (vd. thiếu Gemini key) -> báo cho mọi đoạn
    return texts.map(() => ({ ok: false, error: String(err?.message ?? err), engine: engineName }));
  }
  const hits = await cache.getMany(keys, { maxAgeMs: cacheMaxAgeMs(settings) });

  // Đoạn chưa có trong bộ nhớ (gộp đoạn trùng nhau để chỉ dịch một lần)
  const missing = new Map(); // text -> [index]
  texts.forEach((text, i) => {
    const hit = hits.get(keys[i]);
    if (hit) results[i] = { ok: true, text: hit.translation, engine: engineName, cached: true };
    else missing.set(text, [...(missing.get(text) ?? []), i]);
  });

  const limits = ENGINES[engineName].batchLimits ?? DEFAULT_BATCH_LIMITS;
  const batches = toBatches([...missing.keys()], limits);
  for (const [b, batch] of batches.entries()) {
    if (b > 0 && GOOGLE_FALLBACK_ORDER.includes(engineName)) await new Promise((r) => setTimeout(r, GOOGLE_BATCH_PAUSE_MS));
    const out = await translateTexts(engineName, batch, settings);
    const toStore = [];
    batch.forEach((text, j) => {
      for (const i of missing.get(text)) results[i] = out[j];
      if (out[j].ok) {
        toStore.push({ hash: keys[missing.get(text)[0]], site, engine: cacheId, sourceLang, targetLang, source: text, translation: out[j].text });
      }
    });
    await cache.putMany(toStore);
  }
  return results;
}

// Dịch một đoạn (popup, vùng chọn): giữ thêm phiên âm/từ điển nếu engine có. Ném lỗi nếu mọi engine thất bại.
export async function translate(text, { purpose = 'quick', site = '' } = {}) {
  const settings = await getSettings();
  const engineName = engineFor(settings, purpose);
  const { sourceLang, targetLang } = settings;
  const cacheId = cacheIdOf(engineName, settings);
  const key = await cache.hashKey(site, cacheId, sourceLang, targetLang, text);
  const hit = (await cache.getMany([key], { maxAgeMs: cacheMaxAgeMs(settings) })).get(key);
  if (hit) {
    return { text: hit.translation, transliteration: hit.transliteration, dict: hit.dict, engine: engineName, cached: true };
  }

  const errors = [];
  for (const name of candidates(engineName, settings)) {
    try {
      const result = { ...(await ENGINES[name].translate(text, sourceLang, targetLang, settings)), engine: name };
      await cache.putMany([{
        hash: key, site, engine: cacheId, sourceLang, targetLang, source: text,
        translation: result.text, transliteration: result.transliteration, dict: result.dict,
      }]);
      return result;
    } catch (err) {
      errors.push(`${ENGINES[name]?.label ?? name}: ${err?.message ?? err}`);
    }
  }
  throw new Error(errors.join(' | '));
}
