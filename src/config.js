import { Preferences } from '@capacitor/preferences';

export const API_PROVIDERS = Object.freeze({
  glm: Object.freeze({
    id: 'glm',
    label: '智谱 GLM',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4.6v-flash',
    apiKey: import.meta.env.VITE_GLM_API_KEY || '',
    imageUrlMode: 'base64',
    requestOptions: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }) })
  }),
  deepseek: Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    apiBase: 'https://api.deepseek.com',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    apiKey: import.meta.env.VITE_DEEPSEEK_API_KEY || '',
    imageUrlMode: 'data-url',
    requestOptions: Object.freeze({})
  })
});

// Change only this value to switch the built-in provider back to DeepSeek.
export const ACTIVE_API_PROVIDER = 'glm';
const ACTIVE_CONFIG = API_PROVIDERS[ACTIVE_API_PROVIDER];
if (!ACTIVE_CONFIG) throw new Error(`未知识别服务配置：${ACTIVE_API_PROVIDER}`);

export const API_BASE = ACTIVE_CONFIG.apiBase;
export const API_URL = ACTIVE_CONFIG.apiUrl;
export const MODEL = ACTIVE_CONFIG.model;
export const API_KEY = ACTIVE_CONFIG.apiKey;
export const API_KEY_LABEL = `${ACTIVE_CONFIG.label} API KEY`;
const CUSTOM_API_CONFIG_KEY = 'custom_api_config';

function normalizeBase(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');
}

function inferProvider(apiBase, model) {
  const looksLikeGlm = /open\.bigmodel\.cn/i.test(apiBase) || /^glm-/i.test(model);
  return looksLikeGlm ? API_PROVIDERS.glm : API_PROVIDERS.deepseek;
}

function completeConfig({ apiBase, model, apiKey }) {
  const normalizedBase = normalizeBase(apiBase);
  const normalizedModel = String(model || '').trim();
  const provider = inferProvider(normalizedBase, normalizedModel);
  return {
    apiBase: normalizedBase,
    apiUrl: `${normalizedBase}/chat/completions`,
    model: normalizedModel,
    apiKey: String(apiKey || '').trim(),
    provider: provider.id,
    imageUrlMode: provider.imageUrlMode,
    requestOptions: provider.requestOptions
  };
}

export function getDefaultApiConfig({ includeApiKey = true } = {}) {
  return {
    ...ACTIVE_CONFIG,
    apiKey: includeApiKey ? ACTIVE_CONFIG.apiKey : ''
  };
}

export async function getCustomApiConfig() {
  const { value } = await Preferences.get({ key: CUSTOM_API_CONFIG_KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const config = completeConfig(parsed);
    return config.apiBase && config.model && config.apiKey ? config : null;
  } catch {
    return null;
  }
}

export async function saveCustomApiConfig(config) {
  const value = {
    apiBase: normalizeBase(config.apiBase),
    model: String(config.model || '').trim(),
    apiKey: String(config.apiKey || '').trim()
  };
  await Preferences.set({ key: CUSTOM_API_CONFIG_KEY, value: JSON.stringify(value) });
  return completeConfig(value);
}

export async function clearCustomApiConfig() {
  await Preferences.remove({ key: CUSTOM_API_CONFIG_KEY });
}

export async function getApiConfig() {
  const custom = await getCustomApiConfig();
  return custom || getDefaultApiConfig();
}

export async function getApiKey() {
  return (await getApiConfig()).apiKey;
}
