import { resolveLlmConfig } from './providers.js';
import { hasOriginPermission } from '../../permissions.js';
import * as openaiCompatible from './openaiCompatible.js';
import * as anthropic from './anthropic.js';
import { t } from '../../i18n.js';

const adapters = { openai: openaiCompatible, anthropic };

export function adapterFor(config) {
  return adapters[config.api];
}

export default {
  get label() { return t('llm.engineLabel'); },
  async translate(text, sourceLang, targetLang, settings) {
    const config = resolveLlmConfig(settings);
    if (!config.endpoint || !config.model) throw new Error(t('err.llmNotConfigured'));
    if (config.needsKey && !config.apiKey) throw new Error(t('err.llmNoKey', { provider: config.label }));
    if (!(await hasOriginPermission(config.endpoint))) {
      throw new Error(t('err.llmNoPermission'));
    }
    return adapterFor(config).translate(config, text, sourceLang, targetLang);
  },
};
