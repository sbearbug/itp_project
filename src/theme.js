import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from './platform.js';

const MODE_KEY = 'appearance_mode';
const LEGACY_PALETTE_KEY = 'appearance_palette';
const LIGHT_THEME_KEY = 'appearance_light_theme';
const DARK_THEME_KEY = 'appearance_dark_theme';
const MODE_CACHE_KEY = 'campus-theme-mode';
const LEGACY_PALETTE_CACHE_KEY = 'campus-theme-palette';
const LIGHT_THEME_CACHE_KEY = 'campus-theme-light';
const DARK_THEME_CACHE_KEY = 'campus-theme-dark';

export const APPEARANCE_MODES = Object.freeze(['system', 'light', 'dark']);
export const LIGHT_THEMES = Object.freeze(['mist', 'ice', 'moss', 'sunny']);
export const DARK_THEMES = Object.freeze(['graphite', 'ice-dark']);

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
  graphite: '石墨',
  'ice-dark': '坚冰'
});

const SystemBars = globalThis.__campusSystemBars
  || (globalThis.__campusSystemBars = registerPlugin('SystemBars'));
const systemScheme = window.matchMedia('(prefers-color-scheme: dark)');

function normalizeMode(value) {
  return APPEARANCE_MODES.includes(value) ? value : 'system';
}

function normalizeLightTheme(value) {
  const migrated = value === 'cyan' ? 'ice' : value;
  return LIGHT_THEMES.includes(migrated) ? migrated : 'mist';
}

function normalizeDarkTheme(value) {
  return DARK_THEMES.includes(value) ? value : 'graphite';
}

let appearance = {
  mode: normalizeMode(localStorage.getItem(MODE_CACHE_KEY)),
  lightTheme: normalizeLightTheme(
    localStorage.getItem(LIGHT_THEME_CACHE_KEY) || localStorage.getItem(LEGACY_PALETTE_CACHE_KEY)
  ),
  darkTheme: normalizeDarkTheme(localStorage.getItem(DARK_THEME_CACHE_KEY))
};
let transitionTimer = null;
let initialized = false;

function resolveTheme() {
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && systemScheme.matches);
  return dark ? appearance.darkTheme : appearance.lightTheme;
}

function cacheAppearance() {
  localStorage.setItem(MODE_CACHE_KEY, appearance.mode);
  localStorage.setItem(LIGHT_THEME_CACHE_KEY, appearance.lightTheme);
  localStorage.setItem(DARK_THEME_CACHE_KEY, appearance.darkTheme);
}

async function syncNativeSystemBars(theme, background) {
  if (!isNative()) return;
  const dark = DARK_THEMES.includes(theme);
  await Promise.allSettled([
    StatusBar.setBackgroundColor({ color: background }),
    StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark }),
    SystemBars.setNavigationBar({
      color: background,
      darkIcons: !dark,
      theme,
      mode: appearance.mode,
      lightTheme: appearance.lightTheme,
      darkTheme: appearance.darkTheme
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
  document.documentElement.style.colorScheme = DARK_THEMES.includes(theme) ? 'dark' : 'light';
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
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
  const [savedMode, savedLight, savedDark, legacyPalette] = await Promise.all([
    Preferences.get({ key: MODE_KEY }),
    Preferences.get({ key: LIGHT_THEME_KEY }),
    Preferences.get({ key: DARK_THEME_KEY }),
    Preferences.get({ key: LEGACY_PALETTE_KEY })
  ]);
  appearance = {
    mode: normalizeMode(savedMode.value || appearance.mode),
    lightTheme: normalizeLightTheme(savedLight.value || legacyPalette.value || appearance.lightTheme),
    darkTheme: normalizeDarkTheme(savedDark.value || appearance.darkTheme)
  };
  cacheAppearance();
  await applyTheme();
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

export async function setLightTheme(theme) {
  appearance.lightTheme = normalizeLightTheme(theme);
  cacheAppearance();
  await Preferences.set({ key: LIGHT_THEME_KEY, value: appearance.lightTheme });
  await applyTheme({ animate: true });
  return getAppearanceSettings();
}

export async function setDarkTheme(theme) {
  appearance.darkTheme = normalizeDarkTheme(theme);
  cacheAppearance();
  await Preferences.set({ key: DARK_THEME_KEY, value: appearance.darkTheme });
  await applyTheme({ animate: true });
  return getAppearanceSettings();
}
