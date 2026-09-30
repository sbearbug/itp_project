import { Preferences } from '@capacitor/preferences';

export const API_BASE = 'https://api.deepseek.com';
export const MODEL = 'deepseek-flash';
const CUSTOM_API_CONFIG_KEY = 'custom_api_config';

function normalizeBase(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');
}

export async function getCustomApiConfig() {
  const { value } = await Preferences.get({ key: CUSTOM_API_CONFIG_KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const apiBase = normalizeBase(parsed.apiBase);
    const model = String(parsed.model || '').trim();
    const apiKey = String(parsed.apiKey || '').trim();
    return apiBase && model && apiKey ? { apiBase, model, apiKey } : null;
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
  return value;
}

export async function clearCustomApiConfig() {
  await Preferences.remove({ key: CUSTOM_API_CONFIG_KEY });
}

export async function getApiConfig() {
  const custom = await getCustomApiConfig();
  return custom || {
    apiBase: API_BASE,
    model: MODEL,
    apiKey: import.meta.env.VITE_DEEPSEEK_API_KEY || ''
  };
}

export async function getApiKey() {
  return (await getApiConfig()).apiKey;
}
