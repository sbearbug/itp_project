import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from './platform.js';

const MODE_KEY = 'appearance_mode';
const THEME_KEY = 'appearance_theme';
const LEGACY_PALETTE_KEY = 'appearance_palette';
const LEGACY_LIGHT_THEME_KEY = 'appearance_light_theme';
const LEGACY_DARK_THEME_KEY = 'appearance_dark_theme';
const MODE_CACHE_KEY = 'campus-theme-mode';
const THEME_CACHE_KEY = 'campus-theme-name';
const LEGACY_PALETTE_CACHE_KEY = 'campus-theme-palette';
const LEGACY_LIGHT_THEME_CACHE_KEY = 'campus-theme-light';
const LEGACY_DARK_THEME_CACHE_KEY = 'campus-theme-dark';

export const APPEARANCE_MODES = Object.freeze(['system', 'light', 'dark']);
export const THEMES = Object.freeze(['mist', 'ice', 'moss', 'sunny', 'paper', 'dusk']);

export const MODE_LABELS = Object.freeze({
  system: '跟随系统',
  light: '浅色',
  dark: '深色'
});

export const THEME_LABELS = Object.freeze({
  mist: '烟雨',
  ice: '坚冰',
  moss: '苔绿',
  sunny: '暖阳',
  paper: '素笺',
  dusk: '暮霞'
});

const SystemBars = globalThis.__campusSystemBars
  || (globalThis.__campusSystemBars = registerPlugin('SystemBars'));
const systemScheme = window.matchMedia('(prefers-color-scheme: dark)');

function normalizeMode(value) {
  return APPEARANCE_MODES.includes(value) ? value : 'system';
}

function normalizeTheme(value) {
  const migrated = {
    cyan: 'ice',
    graphite: 'mist',
    'ice-dark': 'ice'
  }[value] || value;
  return THEMES.includes(migrated) ? migrated : 'mist';
}

function shouldUseDark(mode) {
  return mode === 'dark' || (mode === 'system' && systemScheme.matches);
}

function migrateCachedTheme(mode) {
  const savedTheme = localStorage.getItem(THEME_CACHE_KEY);
  if (savedTheme) return normalizeTheme(savedTheme);
  if (shouldUseDark(mode)) {
    return normalizeTheme(localStorage.getItem(LEGACY_DARK_THEME_CACHE_KEY) || 'graphite');
  }
  return normalizeTheme(
    localStorage.getItem(LEGACY_LIGHT_THEME_CACHE_KEY)
      || localStorage.getItem(LEGACY_PALETTE_CACHE_KEY)
      || 'mist'
  );
}

const cachedMode = normalizeMode(localStorage.getItem(MODE_CACHE_KEY));
let appearance = {
  mode: cachedMode,
  theme: migrateCachedTheme(cachedMode)
};
let transitionTimer = null;
let initialized = false;

function resolveTheme() {
  return `${appearance.theme}-${shouldUseDark(appearance.mode) ? 'dark' : 'light'}`;
}

function cacheAppearance() {
  localStorage.setItem(MODE_CACHE_KEY, appearance.mode);
  localStorage.setItem(THEME_CACHE_KEY, appearance.theme);
}

function toHexColor(value, fallback = '') {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value || '');
  if (match) {
    const channel = (n) => Math.round(Number(n)).toString(16).padStart(2, '0');
    return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
  }
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

// 状态栏背景跟随当前页面背景。页面底色是 body 的背景（--surface），不是 :root 的 --bg，
// 所以这里读实际计算值，避免两者不一致时状态栏和页面顶部出现色差。
function readPageBackground() {
  if (typeof document === 'undefined') return '#FFFFFF';
  const fromBody = toHexColor(document.body ? getComputedStyle(document.body).backgroundColor : '');
  if (fromBody) return fromBody;
  const token = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  return toHexColor(token, '#FFFFFF');
}

async function syncNativeSystemBars(theme, background) {
  if (!isNative()) return;
  const dark = theme.endsWith('-dark');
  await Promise.allSettled([
    StatusBar.setBackgroundColor({ color: background }),
    // Capacitor 的 Style 命名与直觉相反：Style.Dark = 深色背景配浅色图标，
    // Style.Light = 浅色背景配深色图标。深色主题要浅色图标，因此是 Style.Dark。
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }),
    SystemBars.setNavigationBar({
      color: background,
      darkIcons: !dark,
      theme,
      mode: appearance.mode,
      selectedTheme: appearance.theme
    })
  ]);
}

export async function applyTheme({ animate = false } = {}) {
  const theme = resolveTheme();
  if (animate) {
    document.documentElement.classList.remove('theme-transition');
    void document.documentElement.offsetWidth;
    document.documentElement.classList.add('theme-transition');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => document.documentElement.classList.remove('theme-transition'), 220);
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme.endsWith('-dark') ? 'dark' : 'light';
  // 主题令牌在这里才生效，必须等 dataset.theme 写入之后再读背景色。
  const background = readPageBackground();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  await syncNativeSystemBars(theme, background);
  return theme;
}

export function getAppearanceSettings() {
  return { ...appearance, resolvedTheme: resolveTheme() };
}

export async function initializeTheme() {
  if (initialized) return getAppearanceSettings();
  initialized = true;
  const [savedMode, savedTheme, legacyLight, legacyDark, legacyPalette] = await Promise.all([
    Preferences.get({ key: MODE_KEY }),
    Preferences.get({ key: THEME_KEY }),
    Preferences.get({ key: LEGACY_LIGHT_THEME_KEY }),
    Preferences.get({ key: LEGACY_DARK_THEME_KEY }),
    Preferences.get({ key: LEGACY_PALETTE_KEY })
  ]);
  const mode = normalizeMode(savedMode.value || appearance.mode);
  const migratedTheme = shouldUseDark(mode)
    ? normalizeTheme(legacyDark.value || 'graphite')
    : normalizeTheme(legacyLight.value || legacyPalette.value || appearance.theme);
  appearance = {
    mode,
    theme: normalizeTheme(savedTheme.value || migratedTheme)
  };
  cacheAppearance();
  await Promise.allSettled([
    Preferences.set({ key: THEME_KEY, value: appearance.theme }),
    applyTheme()
  ]);
  systemScheme.addEventListener('change', () => {
    if (appearance.mode === 'system') void applyTheme({ animate: true });
  });
  return getAppearanceSettings();
}

export async function setAppearanceMode(mode) {
  appearance.mode = normalizeMode(mode);
  cacheAppearance();
  await Preferences.set({ key: MODE_KEY, value: appearance.mode });
  await applyTheme({ animate: true });
  return getAppearanceSettings();
}

export async function setSelectedTheme(theme) {
  appearance.theme = normalizeTheme(theme);
  cacheAppearance();
  await Preferences.set({ key: THEME_KEY, value: appearance.theme });
  await applyTheme({ animate: true });
  return getAppearanceSettings();
}
