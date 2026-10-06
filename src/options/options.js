import { getSettings, saveSettings } from '../lib/settings.js';
import { LANGUAGES } from '../lib/langs.js';
import { LLM_PROVIDERS, resolveLlmConfig } from '../lib/translators/llm/providers.js';
import { adapterFor } from '../lib/translators/llm/index.js';
import { ENGINES, availableEngines, effectiveEngine } from '../lib/translators/index.js';
import { DEFAULT_GEMINI_MODEL, exhaustedModels } from '../lib/translators/gemini.js';
import * as translationCache from '../lib/translationCache.js';
import { requestOriginPermission } from '../lib/permissions.js';
import { initPageI18n, t, locale, UI_LANGS } from '../lib/i18n.js';

const $ = (id) => document.getElementById(id);
const status = $('status');
const settings = await getSettings();
// Đổi ngôn ngữ giao diện: DOM tĩnh tự dịch lại (data-i18n), phần dựng bằng JS dựng lại ở relabel().
await initPageI18n(() => relabel());
// Bản nháp cấu hình theo provider, để đổi provider trên form không mất dữ liệu chưa lưu.
const llmConfigs = structuredClone(settings.llmConfigs);

function fillSelect(select, entries) {
  select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
}

// Dựng lại option giữ nguyên giá trị đang chọn (dùng cả khi đổi ngôn ngữ giao diện).
function refillSelect(select, entries) {
  const value = select.value;
  fillSelect(select, entries);
  if (value) select.value = value;
}

function fillLabeledSelects() {
  refillSelect($('sourceLang'), LANGUAGES.map((l) => [l.code, l.label]));
  refillSelect($('targetLang'), LANGUAGES.filter((l) => l.code !== 'auto').map((l) => [l.code, l.label]));
  refillSelect($('engine'), availableEngines()); // LLM bị ẩn khi FEATURES.llm = false
  refillSelect($('pageEngine'), [['same', t('options.sameEngine')], ...availableEngines()]);
  refillSelect($('llmProvider'), Object.entries(LLM_PROVIDERS).map(([id, p]) => [id, p.label]));
}

fillSelect($('uiLang'), UI_LANGS);
$('uiLang').value = settings.uiLang;
// Lưu ngay khi đổi (không cần bấm Lưu): mọi trang/popup/content script nghe storage.onChanged và tự dịch lại.
$('uiLang').addEventListener('change', (e) => saveSettings({ uiLang: e.target.value }));
fillLabeledSelects();

$('engine').value = effectiveEngine(settings.engine);
$('pageEngine').value = settings.pageEngine === 'same' ? 'same' : effectiveEngine(settings.pageEngine);
$('geminiApiKey').value = settings.geminiApiKey;
$('geminiModel').value = settings.geminiModel;
$('geminiModel').placeholder = DEFAULT_GEMINI_MODEL;
// Model dự phòng: chọn từ danh sách model tải về (không nhập tay). Lưu vẫn dạng "a, b" như cũ.
const MODEL_LIST_KEY = 'geminiModelList'; // chrome.storage.local: danh sách model lần tải gần nhất
let fallbackModels = settings.geminiFallbackModels.split(',').map((m) => m.trim()).filter(Boolean);
let knownModels = (await chrome.storage.local.get(MODEL_LIST_KEY))[MODEL_LIST_KEY] ?? [];

const ICON_UP = '<svg class="icon" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>';
const ICON_X = '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function iconButton(svg, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.title = title;
  btn.innerHTML = svg; // icon tĩnh của extension, không phải dữ liệu ngoài
  btn.addEventListener('click', onClick);
  return btn;
}

function renderFallback() {
  const primary = $('geminiModel').value.trim() || DEFAULT_GEMINI_MODEL;
  fallbackModels = fallbackModels.filter((m) => m !== primary); // model chính không làm dự phòng cho chính nó

  $('fallbackChips').replaceChildren(
    ...fallbackModels.map((model, i) => {
      const li = document.createElement('li');
      // Model đã lưu nhưng không có trong danh sách vừa tải (đổi tên/ngừng hỗ trợ) -> tô đỏ để người dùng bỏ
      li.className = knownModels.length && !knownModels.includes(model) ? 'chip unknown' : 'chip';
      if (li.classList.contains('unknown')) li.title = t('options.modelUnknown');
      const order = document.createElement('span');
      order.className = 'chip-order';
      order.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = model;
      li.append(order, name);
      if (i > 0) {
        li.append(iconButton(ICON_UP, t('options.moveUp'), () => {
          [fallbackModels[i - 1], fallbackModels[i]] = [fallbackModels[i], fallbackModels[i - 1]];
          renderFallback();
        }));
      }
      li.append(iconButton(ICON_X, t('options.removeModel'), () => {
        fallbackModels.splice(i, 1);
        renderFallback();
      }));
      return li;
    })
  );

  const choices = knownModels.filter((m) => m !== primary && !fallbackModels.includes(m));
  const picker = $('fallbackPicker');
  const placeholder = !knownModels.length
    ? t('options.pickerLoadFirst')
    : choices.length ? t('options.pickerAdd') : t('options.pickerAllChosen');
  picker.replaceChildren(new Option(placeholder, ''), ...choices.map((m) => new Option(m, m)));
  picker.disabled = !choices.length;
}

$('fallbackPicker').addEventListener('change', (e) => {
  if (!e.target.value) return;
  fallbackModels.push(e.target.value);
  renderFallback();
});
$('geminiModel').addEventListener('change', renderFallback);
$('geminiModelList').replaceChildren(...knownModels.map((m) => new Option(m, m)));
renderFallback();

// Model nào đang hết quota ngày (do extension ghi nhận khi gặp 429)
async function renderQuotaStatus() {
  const entries = Object.entries(await exhaustedModels());
  const fmt = (time) => new Date(time).toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  $('geminiQuotaStatus').hidden = !entries.length;
  $('geminiQuotaStatus').textContent = entries.map(([model, time]) => t('options.quotaOut', { model, time: fmt(time) })).join(' · ');
}
renderQuotaStatus();
$('cacheTtlDays').value = String(settings.cacheTtlDays);
$('fallback').checked = settings.fallback;
$('sourceLang').value = settings.sourceLang;
$('targetLang').value = settings.targetLang;
$('llmProvider').value = settings.llmProvider;

function currentLlmSettings() {
  return { llmProvider: $('llmProvider').value, llmConfigs };
}

function stashForm() {
  llmConfigs[$('llmProvider').dataset.shown] = {
    endpoint: $('llmEndpoint').value.trim(),
    apiKey: $('llmApiKey').value.trim(),
    model: $('llmModel').value.trim(),
  };
}

function renderLlm() {
  const config = resolveLlmConfig(currentLlmSettings());
  $('llmProvider').dataset.shown = config.id;
  $('llmEndpoint').value = config.endpoint;
  $('llmEndpoint').readOnly = config.id !== 'custom';
  $('llmApiKey').value = config.apiKey;
  $('apiKeyRow').hidden = !config.needsKey && config.id !== 'custom';
  $('llmModel').value = config.model;
  $('llmModelList').replaceChildren();
  $('llm-section').hidden = ![$('engine').value, $('pageEngine').value].includes('llm');
}

function flash(msg) {
  status.textContent = msg;
  status.classList.add('show');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => status.classList.remove('show'), 3000);
}

$('swapLang').addEventListener('click', () => {
  // "Tự nhận diện" không thể là ngôn ngữ đích -> khi đảo thì đích cũ thành nguồn, nguồn mới mặc định là đích cũ.
  const from = $('sourceLang').value;
  $('sourceLang').value = $('targetLang').value;
  if (from !== 'auto') $('targetLang').value = from;
});

for (const id of ['engine', 'pageEngine']) {
  $(id).addEventListener('change', () => {
    stashForm();
    renderLlm();
  });
}

function geminiSettings() {
  return {
    geminiApiKey: $('geminiApiKey').value.trim(),
    geminiModel: $('geminiModel').value.trim(),
    geminiFallbackModels: fallbackModels.join(', '),
  };
}

$('loadGeminiModels').addEventListener('click', async () => {
  try {
    const models = await ENGINES.gemini.listModels(geminiSettings());
    knownModels = models;
    await chrome.storage.local.set({ [MODEL_LIST_KEY]: models }); // mở lại Cài đặt không phải tải lại
    $('geminiModelList').replaceChildren(...models.map((m) => new Option(m, m)));
    renderFallback();
    flash(t('options.geminiOk', { n: models.length }));
  } catch (err) {
    flash(t('common.error', { error: err.message }));
  }
});

async function renderCacheCount() {
  const n = await translationCache.count();
  $('cacheCount').textContent = t('options.cacheCount', { n: n.toLocaleString(locale()) });
}

renderCacheCount();
// Trang Bộ nhớ báo khi xoá dữ liệu -> cập nhật số lượng ngay (cùng origin extension nên dùng BroadcastChannel được).
new BroadcastChannel('translation-cache').onmessage = () => renderCacheCount();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && renderCacheCount());

$('llmProvider').addEventListener('change', () => {
  // dataset.shown vẫn là provider cũ ở thời điểm này
  stashForm();
  renderLlm();
});

$('loadModels').addEventListener('click', () => {
  stashForm();
  const config = resolveLlmConfig(currentLlmSettings());
  if (!config.endpoint) return flash(t('options.endpointFirst'));
  // Xin quyền ngay trong click handler (trước await) để Chrome chấp nhận.
  requestOriginPermission(config.endpoint)
    .then((granted) => {
      if (!granted) throw new Error(t('options.noPermission'));
      return adapterFor(config).listModels(config);
    })
    .then((models) => {
      $('llmModelList').replaceChildren(...models.map((m) => new Option(m, m)));
      flash(t('options.modelsLoaded', { n: models.length }));
    })
    .catch((err) => flash(t('common.error', { error: err.message })));
});

$('save').addEventListener('click', () => {
  stashForm();
  const llm = currentLlmSettings();
  const config = resolveLlmConfig(llm);

  let endpointOk = true;
  try {
    if (config.endpoint) new URL(config.endpoint);
  } catch {
    endpointOk = false;
  }
  if ([$('engine').value, $('pageEngine').value].includes('llm') && !endpointOk) return flash(t('options.badEndpoint'));
  if ([$('engine').value, $('pageEngine').value].includes('gemini') && !$('geminiApiKey').value.trim()) {
    return flash(t('options.geminiKeyFirst'));
  }

  const usesLlm = [$('engine').value, $('pageEngine').value].includes('llm');
  const permission = usesLlm && config.endpoint ? requestOriginPermission(config.endpoint) : Promise.resolve(true);

  permission
    .then(async (granted) => {
      await saveSettings({
        engine: $('engine').value,
        pageEngine: $('pageEngine').value,
        cacheTtlDays: Number($('cacheTtlDays').value),
        ...geminiSettings(),
        fallback: $('fallback').checked,
        sourceLang: $('sourceLang').value,
        targetLang: $('targetLang').value,
        ...llm,
      });
      flash(granted ? t('options.saved') : t('options.savedNoPermission'));
    })
    .catch((err) => flash(t('common.error', { error: err.message })));
});

renderLlm();

function relabel() {
  fillLabeledSelects();
  renderFallback();
  renderQuotaStatus();
  renderCacheCount();
}
