import './style.css';
import './intro.css';
import emptyCalendarUrl from '../material/empty-calendar.svg?url';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { isNative } from './platform.js';
import { getIntroMode, playIntro } from './intro.js';
import {
  APPEARANCE_MODES,
  THEMES,
  MODE_LABELS,
  THEME_LABELS,
  getAppearanceSettings,
  initializeTheme,
  setAppearanceMode,
  setSelectedTheme
} from './theme.js';
import { extractEvents, extractEventsFromText, compressImage } from './extract.js';
import { addToCalendar, addDeadlineToCalendar, hasDeadlineCalendarEntry } from './calendar.js';
import {
  API_BASE,
  API_KEY_LABEL,
  MODEL,
  EVENT_CATEGORIES,
  TERM_CONFIG,
  getCustomApiConfig,
  saveCustomApiConfig,
  clearCustomApiConfig
} from './config.js';
import {
  loadEvents,
  addEvents,
  updateEvent,
  deleteEvent,
  loadPendingEvents,
  addPendingEvents,
  updatePendingEvent,
  deletePendingEvent
} from './store.js';

const app = document.querySelector('#app');
const RECOGNITION_STATES = ['idle', 'compressing', 'uploading', 'recognizing', 'done', 'error'];
const STAGE_STATES = ['compressing', 'uploading', 'recognizing', 'done'];
const STATUS_MESSAGES = ['正在读取文字…', '正在识别时间…', '正在整理活动信息…'];
const WORKING_STATES = ['compressing', 'uploading', 'recognizing'];
const seenUncertainIds = new Set();

let events = [];
let pendingEvents = [];
let formError = '';
let recognitionRunId = 0;
let slowTimer = null;
let statusTextTimer = null;
let toastTimer = null;
let listScrollHandler = null;
let closeActiveDialog = null;
let settingsRoot = null;
let settingsGestureInstalled = false;
let settingsCloseGestureInstalled = false;
let pressFeedbackInstalled = false;
let settingsAnimation = null;
let settingsScrimAnimation = null;
let activePageAnimation = null;
let navigationSequence = 0;

const ui = {
  booting: true,
  pageAnimation: 'page--fade-in',
  recognitionStatus: 'idle',
  errorStage: null,
  error: '',
  slow: false,
  statusTextIndex: 0,
  selectedFile: null,
  selectedText: '',
  recognitionSource: 'image',
  previewUrl: '',
  compressedImage: '',
  startedAt: 0,
  resultIds: [],
  activeDraftId: null,
  actionBusy: null,
  toast: '',
  newItemIds: [],
  fabHidden: false,
  selectionMode: false,
  selectedEventIds: new Set(),
  calendarSuccessIds: new Set(),
  openSwipeId: null,
  endedExpanded: false,
  settingsOpen: false,
  settingsView: 'menu'
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rubberBand(value, minimum, maximum, resistance = 0.22) {
  if (value < minimum) return minimum + (value - minimum) * resistance;
  if (value > maximum) return maximum + (value - maximum) * resistance;
  return value;
}

function motionEasing(name = '--motion-spring-soft') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease-out';
}

function transformTranslateX(element) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(transform).m41;
  } catch {
    return 0;
  }
}

function capturePointer(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    // The pointer may already have been cancelled by the browser's scroll recognizer.
  }
}

function releasePointer(element, pointerId) {
  try {
    element?.releasePointerCapture?.(pointerId);
  } catch {
    // Releasing an already-cancelled pointer is harmless.
  }
}

function appDialog({ title = '请确认', message, confirmLabel = '确认', cancelLabel = '取消', danger = false }) {
  closeActiveDialog?.(false);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-backdrop';
    overlay.innerHTML = `<section class="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title">
      <div class="app-dialog__mark ${danger ? 'app-dialog__mark--danger' : ''}">${danger ? '!' : 'i'}</div>
      <h2 id="app-dialog-title">${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="app-dialog__actions">
        ${cancelLabel ? `<button class="button button--secondary" type="button" data-dialog-cancel>${escapeHtml(cancelLabel)}</button>` : ''}
        <button class="button ${danger ? 'button--danger' : 'button--primary'}" type="button" data-dialog-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    </section>`;
    document.body.appendChild(overlay);

    let finished = false;
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      closeActiveDialog = null;
      document.removeEventListener('keydown', onKeyDown);
      overlay.classList.add('app-dialog-backdrop--leaving');
      setTimeout(() => {
        overlay.remove();
        resolve(answer);
      }, 220);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish(false);
    };
    closeActiveDialog = finish;
    document.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => finish(false));
    overlay.querySelector('[data-dialog-confirm]').addEventListener('click', () => finish(true));
    requestAnimationFrame(() => overlay.classList.add('app-dialog-backdrop--visible'));
    overlay.querySelector('[data-dialog-cancel], [data-dialog-confirm]')?.focus();
  });
}

const confirmAction = (message, options = {}) => appDialog({ message, ...options });
const showNotice = (message, options = {}) => appDialog({
  title: options.title || '提示',
  message,
  confirmLabel: options.confirmLabel || '知道了',
  cancelLabel: null
});

async function getWebApiStatus() {
  try {
    const response = await fetch('/api/config/status', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    return Boolean(body.configured);
  } catch {
    return null;
  }
}

function openWebApiKeyDialog({ required = false } = {}) {
  closeActiveDialog?.(false);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-backdrop';
    overlay.innerHTML = `<form class="app-dialog api-key-dialog" aria-modal="true" aria-labelledby="api-key-dialog-title">
      <div class="app-dialog__mark">◆</div>
      <h2 id="api-key-dialog-title">配置识别接口</h2>
      <p>接口密钥只会发送给本机服务并保存在当前文件夹中，不会写入网页代码。</p>
      <label class="settings-field"><span>${escapeHtml(API_KEY_LABEL)}</span>
        <input name="apiKey" type="password" placeholder="sk-..." autocomplete="off" required autofocus>
        <small>保存后立即可以上传截图识别</small>
      </label>
      <div class="api-key-dialog__error" aria-live="polite"></div>
      <div class="app-dialog__actions">
        ${required ? '' : '<button class="button button--secondary" type="button" data-api-cancel>取消</button>'}
        <button class="button button--primary" type="submit" data-api-save>保存并继续</button>
      </div>
    </form>`;
    document.body.appendChild(overlay);

    let finished = false;
    const finish = (saved) => {
      if (finished) return;
      finished = true;
      closeActiveDialog = null;
      document.removeEventListener('keydown', onKeyDown);
      overlay.classList.add('app-dialog-backdrop--leaving');
      setTimeout(() => {
        overlay.remove();
        resolve(saved);
      }, 220);
    };
    const onKeyDown = (event) => {
      if (!required && event.key === 'Escape') finish(false);
    };
    closeActiveDialog = required ? () => {} : finish;
    document.addEventListener('keydown', onKeyDown);
    overlay.querySelector('[data-api-cancel]')?.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (event) => {
      if (!required && event.target === overlay) finish(false);
    });
    overlay.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = overlay.querySelector('[name="apiKey"]');
      const button = overlay.querySelector('[data-api-save]');
      const errorRoot = overlay.querySelector('.api-key-dialog__error');
      const apiKey = input.value.trim();
      if (!apiKey) {
        errorRoot.textContent = '请填写接口密钥';
        input.focus();
        return;
      }
      button.disabled = true;
      button.innerHTML = '<span class="button-spinner"></span>正在保存…';
      errorRoot.textContent = '';
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || '本地服务器无法保存设置');
        finish(true);
      } catch (error) {
        input.value = '';
        errorRoot.textContent = error.message || '保存失败，请重试';
        button.disabled = false;
        button.textContent = '保存并继续';
        input.focus();
      }
    });
    requestAnimationFrame(() => {
      overlay.classList.add('app-dialog-backdrop--visible');
      overlay.querySelector('[name="apiKey"]')?.focus();
    });
  });
}

async function ensureWebApiKey() {
  if (isNative()) return;
  const configured = await getWebApiStatus();
  if (configured === false) await openWebApiKeyDialog({ required: true });
}

async function renderSettingsDrawer() {
  const native = isNative();
  const custom = native ? await getCustomApiConfig() : null;
  const webConfigured = native ? null : await getWebApiStatus();
  const appearance = getAppearanceSettings();
  if (!settingsRoot) {
    settingsRoot = document.createElement('div');
    settingsRoot.id = 'settings-root';
    document.body.appendChild(settingsRoot);
  }

  const backHeader = (title, description) => `<header class="settings-header settings-header--with-back">
    <button class="icon-button settings-back" type="button" data-settings-view="menu" aria-label="返回设置菜单">←</button>
    <div><h2>${title}</h2><p>${description}</p></div>
  </header>`;

  const menuMarkup = `<header class="settings-header">
      <h2>设置</h2>
      <p>调整外观或识别接口</p>
    </header>
    <div class="settings-menu">
      <button class="settings-menu-item" type="button" data-settings-view="appearance">
        <span class="settings-menu-item__icon">◐</span>
        <span><b>外观</b><small>${MODE_LABELS[appearance.mode]} · ${THEME_LABELS[appearance.theme]}</small></span>
        <i>›</i>
      </button>
      <button class="settings-menu-item" type="button" data-settings-view="api">
        <span class="settings-menu-item__icon">⌁</span>
        <span><b>识别接口</b><small>${native ? (custom ? '正在使用自定义接口' : '正在使用内置演示接口') : (webConfigured ? '接口密钥已保存在本机' : '尚未配置接口密钥')}</small></span>
        <i>›</i>
      </button>
    </div>`;

  const appearanceMarkup = `${backHeader('外观', '主题会立即应用并保存在当前设备')}
    <section class="appearance-section">
      <h3>模式</h3>
      <div class="appearance-mode" role="group" aria-label="模式">
        ${APPEARANCE_MODES.map((mode) => `<button type="button" data-appearance-mode="${mode}" aria-pressed="${appearance.mode === mode}">${MODE_LABELS[mode]}</button>`).join('')}
      </div>
    </section>
    <section class="appearance-section">
      <h3>主题</h3>
      <div class="theme-options">
        ${THEMES.map((theme) => `<button class="theme-option" type="button" data-selected-theme="${theme}" aria-pressed="${appearance.theme === theme}">
          <span class="theme-option__preview" aria-hidden="true">
            <i class="theme-option__sample" data-theme-preview="${theme}-light"><b></b><b></b><b></b><b></b></i>
            <i class="theme-option__sample" data-theme-preview="${theme}-dark"><b></b><b></b><b></b><b></b></i>
          </span>
          <span>${THEME_LABELS[theme]}</span>
          <b>${appearance.theme === theme ? '✓' : ''}</b>
        </button>`).join('')}
      </div>
      <p class="settings-note">每个色块左侧为浅色版本，右侧为深色版本；模式切换时会使用同一主题的对应版本。</p>
    </section>`;

  const apiMarkup = `${backHeader('识别接口', native ? (custom ? '正在使用自定义接口' : '正在使用内置演示接口') : (webConfigured ? '接口密钥已保存在本机' : '尚未配置接口密钥'))}
    ${native ? `<form class="settings-form" id="api-settings-form">
      <label class="settings-field"><span>接口地址</span>
        <input name="apiBase" type="url" inputmode="url" value="${escapeHtml(custom?.apiBase || API_BASE)}" autocomplete="off">
        <small>填写与通用对话补全格式兼容的基础地址</small>
      </label>
      <label class="settings-field"><span>模型名称</span>
        <input name="model" type="text" value="${escapeHtml(custom?.model || MODEL)}" autocomplete="off">
      </label>
      <label class="settings-field"><span>接口密钥</span>
        <input name="apiKey" type="password" value="${escapeHtml(custom?.apiKey || '')}" placeholder="输入接口密钥" autocomplete="off">
        <small>仅保存在当前设备，保存后下次识别生效</small>
      </label>
      <div class="settings-actions">
        <button class="button button--secondary" id="default-api-button" type="button" ${custom ? '' : 'disabled'}>恢复内置</button>
        <button class="button button--primary" id="save-api-button" type="submit">保存设置</button>
      </div>
    </form>
    <p class="settings-note">自定义接口需要兼容 <code>/chat/completions</code>，并支持图片输入。</p>` : `<div class="settings-form">
      <p class="settings-note">接口密钥由本机服务保存，网页不会显示或读回已保存的密钥。</p>
      <button class="button button--primary" id="web-api-key-button" type="button">${webConfigured ? '更新接口密钥' : '填写接口密钥'}</button>
    </div>`}`;

  const content = ui.settingsView === 'appearance'
    ? appearanceMarkup
    : ui.settingsView === 'api'
      ? apiMarkup
      : menuMarkup;
  settingsRoot.innerHTML = `<div class="settings-scrim" data-settings-close></div>
    <aside class="settings-drawer" aria-label="设置" aria-hidden="${!ui.settingsOpen}">
      <div class="settings-drawer__handle"></div>
      ${content}
    </aside>`;

  settingsRoot.querySelector('[data-settings-close]').addEventListener('click', closeSettingsDrawer);
  settingsRoot.querySelectorAll('[data-settings-view]').forEach((button) => button.addEventListener('click', async () => {
    ui.settingsView = button.dataset.settingsView;
    await renderSettingsDrawer();
  }));
  settingsRoot.querySelectorAll('[data-appearance-mode]').forEach((button) => button.addEventListener('click', async () => {
    await setAppearanceMode(button.dataset.appearanceMode);
    await renderSettingsDrawer();
  }));
  settingsRoot.querySelectorAll('[data-selected-theme]').forEach((button) => button.addEventListener('click', async () => {
    await setSelectedTheme(button.dataset.selectedTheme);
    await renderSettingsDrawer();
  }));
  settingsRoot.querySelector('#api-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const apiBase = String(data.get('apiBase') || '').trim();
    const model = String(data.get('model') || '').trim();
    const apiKey = String(data.get('apiKey') || '').trim();
    let url;
    try {
      url = new URL(apiBase);
    } catch {
      await showNotice('请输入完整有效的接口地址，例如 https://api.example.com/v1。');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol) || !model || !apiKey) {
      await showNotice('接口地址、模型名称和接口密钥都需要填写完整。');
      return;
    }
    const button = settingsRoot.querySelector('#save-api-button');
    setActionBusy('api-saving', button, '保存中…');
    await saveCustomApiConfig({ apiBase, model, apiKey });
    ui.actionBusy = null;
    await renderSettingsDrawer();
    showToast('已使用自定义接口');
  });
  settingsRoot.querySelector('#default-api-button')?.addEventListener('click', async () => {
    await clearCustomApiConfig();
    await renderSettingsDrawer();
    showToast('已恢复内置接口');
  });
  settingsRoot.querySelector('#web-api-key-button')?.addEventListener('click', async () => {
    closeSettingsDrawer();
    await wait(250);
    if (await openWebApiKeyDialog()) {
      showToast('接口密钥已保存');
    }
  });

  setupSettingsCloseGesture();
}

function setupSettingsCloseGesture() {
  if (settingsCloseGestureInstalled || !settingsRoot) return;
  settingsCloseGestureInstalled = true;
  const gestureSurface = settingsRoot;
  let gesture = null;

  gestureSurface.addEventListener('pointerdown', (event) => {
    if (!ui.settingsOpen || !event.isPrimary || event.button > 0) return;
    const drawer = settingsRoot.querySelector('.settings-drawer');
    if (!drawer || !(event.target instanceof Element) || !event.target.closest('.settings-drawer')) return;
    const interactive = event.target.closest('button, input, textarea, select, label');
    const directSurface = event.target.closest('.settings-drawer__handle');
    if (interactive || (!directSurface && drawer.scrollTop > 0)) return;
    gesture = {
      pointerId: event.pointerId,
      drawer,
      startX: event.clientX,
      startY: event.clientY,
      startProgress: readSettingsProgress(),
      directSurface: Boolean(directSurface),
      dragging: false,
      samples: [{ y: event.clientY, time: performance.now() }]
    };
    cancelSettingsAnimations();
    capturePointer(drawer, event.pointerId);
  });

  gestureSurface.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
    if (!gesture.dragging && horizontal && deltaX > 58) {
      gesture = null;
      void closeSettingsDrawer({ velocity: 0.8 });
      return;
    }
    if (!gesture.dragging && Math.abs(deltaY) > 7 && !horizontal
      && (gesture.directSurface || deltaY > 0)) {
      gesture.dragging = true;
      document.body.classList.add('settings-dragging');
    }
    if (!gesture.dragging) return;
    event.preventDefault();
    const height = Math.max(1, gesture.drawer.getBoundingClientRect().height);
    const progress = rubberBand(gesture.startProgress - deltaY / height, 0, 1, 0.16);
    setSettingsProgress(progress);
    const now = performance.now();
    gesture.samples.push({ y: event.clientY, time: now });
    gesture.samples = gesture.samples.filter((sample) => now - sample.time <= 90);
  });

  const finish = (event, cancelled = false) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = gesture;
    gesture = null;
    releasePointer(current.drawer, event.pointerId);
    document.body.classList.remove('settings-dragging');
    if (!current.dragging) return;
    const finishTime = performance.now();
    current.samples.push({ y: event.clientY, time: finishTime });
    current.samples = current.samples.filter((sample) => finishTime - sample.time <= 90);
    const first = current.samples[0];
    const last = current.samples[current.samples.length - 1] || first;
    const velocity = cancelled || last.time === first.time ? 0 : (last.y - first.y) / (last.time - first.time);
    const progress = readSettingsProgress();
    const projected = progress - velocity * 0.2;
    if (!cancelled && (velocity < -0.45 || (velocity <= 0.45 && projected >= 0.52))) {
      void animateSettingsProgress(1, velocity);
    } else {
      void closeSettingsDrawer({ velocity });
    }
  };
  gestureSurface.addEventListener('pointerup', (event) => finish(event));
  gestureSurface.addEventListener('pointercancel', (event) => finish(event, true));
}

function setupPressFeedback() {
  if (pressFeedbackInstalled) return;
  pressFeedbackInstalled = true;
  let pressed = null;
  let rippleTimer = null;

  const release = () => {
    const target = pressed;
    pressed = null;
    if (!target) return;
    target.classList.remove('is-pressed');
    window.clearTimeout(rippleTimer);
    rippleTimer = window.setTimeout(() => target.classList.remove('ripple-active'), 420);
  };

  document.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button > 0) return;
    const target = event.target instanceof Element
      ? event.target.closest('button:not(:disabled), [role="button"], .add-picker__button, .capture-button')
      : null;
    if (!target) return;
    release();
    pressed = target;
    target.classList.add('is-pressed');
    const bounds = target.getBoundingClientRect();
    target.style.setProperty('--ripple-x', `${event.clientX - bounds.left}px`);
    target.style.setProperty('--ripple-y', `${event.clientY - bounds.top}px`);
    target.classList.remove('ripple-active');
    void target.offsetWidth;
    target.classList.add('ripple-active');
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!pressed || !event.isPrimary) return;
    const bounds = pressed.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    pressed.classList.toggle('is-pressed', inside);
  }, true);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);
}

function settingsMotionElements() {
  return {
    drawer: settingsRoot?.querySelector('.settings-drawer') || null,
    scrim: settingsRoot?.querySelector('.settings-scrim') || null
  };
}

function readSettingsProgress() {
  const { drawer } = settingsMotionElements();
  if (!drawer) return 0;
  const height = Math.max(1, drawer.getBoundingClientRect().height);
  const transform = getComputedStyle(drawer).transform;
  if (!transform || transform === 'none') return ui.settingsOpen ? 1 : 0;
  try {
    return clamp(1 - new DOMMatrixReadOnly(transform).m42 / height);
  } catch {
    return ui.settingsOpen ? 1 : 0;
  }
}

function setSettingsProgress(progress) {
  const { drawer, scrim } = settingsMotionElements();
  if (!drawer || !scrim) return;
  const visualProgress = clamp(progress);
  const height = Math.max(1, drawer.getBoundingClientRect().height);
  drawer.style.transform = `translate(-50%, ${(1 - visualProgress) * height}px)`;
  drawer.style.opacity = String(0.82 + visualProgress * 0.18);
  scrim.style.opacity = String(visualProgress);
}

function cancelSettingsAnimations() {
  const progress = readSettingsProgress();
  settingsAnimation?.cancel();
  settingsScrimAnimation?.cancel();
  settingsAnimation = null;
  settingsScrimAnimation = null;
  document.body.classList.remove('settings-closing');
  setSettingsProgress(progress);
  return progress;
}

async function animateSettingsProgress(target, velocity = 0) {
  const { drawer, scrim } = settingsMotionElements();
  if (!drawer || !scrim) return false;
  const start = cancelSettingsAnimations();
  const distance = Math.abs(target - start);
  if (distance < 0.005) {
    setSettingsProgress(target);
    return true;
  }
  const height = Math.max(1, drawer.getBoundingClientRect().height);
  const duration = clamp(Math.round(170 + distance * 150 - Math.min(Math.abs(velocity), 1.5) * 45), 150, 300);
  const fromTransform = `translate(-50%, ${(1 - start) * height}px)`;
  const toTransform = `translate(-50%, ${(1 - target) * height}px)`;
  settingsAnimation = drawer.animate([
    { transform: fromTransform, opacity: 0.82 + start * 0.18 },
    { transform: toTransform, opacity: 0.82 + target * 0.18 }
  ], { duration, easing: motionEasing(), fill: 'forwards' });
  settingsScrimAnimation = scrim.animate([
    { opacity: start },
    { opacity: target }
  ], { duration: Math.min(duration, 220), easing: motionEasing('--motion-direct'), fill: 'forwards' });
  try {
    await settingsAnimation.finished;
  } catch {
    return false;
  }
  settingsAnimation = null;
  settingsScrimAnimation = null;
  drawer.getAnimations().forEach((animation) => animation.cancel());
  scrim.getAnimations().forEach((animation) => animation.cancel());
  setSettingsProgress(target);
  return true;
}

async function prepareSettingsDrawer(initialProgress = 0) {
  if (ui.settingsOpen || closeActiveDialog) return false;
  ui.settingsOpen = true;
  ui.settingsView = 'menu';
  document.body.classList.remove('settings-open');
  await renderSettingsDrawer();
  await nextPaint();
  document.body.classList.add('settings-open');
  setSettingsProgress(initialProgress);
  return true;
}

async function openSettingsDrawer() {
  if (!await prepareSettingsDrawer(0)) return;
  await animateSettingsProgress(1);
}

async function closeSettingsDrawer({ velocity = 0 } = {}) {
  if (!ui.settingsOpen) return;
  document.body.classList.add('settings-closing');
  const completed = await animateSettingsProgress(0, velocity);
  if (!completed) return;
  ui.settingsOpen = false;
  document.body.classList.remove('settings-open');
  document.body.classList.remove('settings-closing');
  settingsRoot?.querySelector('.settings-drawer')?.setAttribute('aria-hidden', 'true');
}

function setupSettingsGesture() {
  if (settingsGestureInstalled) return;
  settingsGestureInstalled = true;
  let gesture = null;
  let suppressNextClick = false;

  const canStart = (target) => {
    if (ui.settingsOpen || closeActiveDialog) return false;
    if (!(target instanceof Element)) return true;
    return !target.closest('.app-dialog, .settings-drawer, .event-card-row--open');
  };

  document.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button > 0 || !canStart(event.target)) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      preparing: null,
      ready: false,
      horizontal: false,
      samples: [{ x: event.clientX, time: performance.now() }]
    };
  });
  document.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.latestX = event.clientX;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.horizontal && (Math.abs(deltaX) > 9 || Math.abs(deltaY) > 9)) {
      if (deltaX <= 0 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) {
        gesture = null;
        return;
      }
      gesture.horizontal = true;
    }
    if (!gesture.horizontal) return;
    if (event.cancelable) event.preventDefault();
    if (!gesture.preparing) {
      const preparingGesture = gesture;
      gesture.preparing = prepareSettingsDrawer(0).then((ready) => {
        if (!ready) return false;
        preparingGesture.ready = true;
        const progress = rubberBand((preparingGesture.latestX - preparingGesture.startX) / 220, 0, 1, 0.16);
        setSettingsProgress(progress);
        return true;
      });
    }
    if (gesture.ready) setSettingsProgress(rubberBand(deltaX / 220, 0, 1, 0.16));
    const now = performance.now();
    gesture.samples.push({ x: event.clientX, time: now });
    gesture.samples = gesture.samples.filter((sample) => now - sample.time <= 90);
  }, { passive: false });

  const finish = async (event, cancelled = false) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = gesture;
    gesture = null;
    if (!current.horizontal || !current.preparing) return;
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 350);
    if (!await current.preparing) return;
    const finishTime = performance.now();
    current.samples.push({ x: event.clientX, time: finishTime });
    current.samples = current.samples.filter((sample) => finishTime - sample.time <= 90);
    const first = current.samples[0];
    const last = current.samples[current.samples.length - 1] || first;
    const velocity = cancelled || last.time === first.time ? 0 : (last.x - first.x) / (last.time - first.time);
    const progress = readSettingsProgress();
    const projected = progress + velocity * 0.2;
    if (!cancelled && (velocity > 0.45 || projected >= 0.42)) await animateSettingsProgress(1, velocity);
    else await closeSettingsDrawer({ velocity });
  };
  document.addEventListener('pointerup', (event) => { void finish(event); });
  document.addEventListener('pointercancel', (event) => { void finish(event, true); });
  document.addEventListener('click', (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(value, allDay = false) {
  if (!value) return '时间待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', allDay
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  ).format(date);
}

function statusLabel(status) {
  return { interested: '感兴趣', registered: '已报名', skipped: '不参加' }[status] || '感兴趣';
}

function categoryOf(event) {
  return EVENT_CATEGORIES.includes(event.category) ? event.category : '其他';
}

function calendarSuccessMessage(event) {
  return '已加入日历';
}

function parseRoute() {
  if (location.hash === '#/add') return { name: 'add' };
  const editMatch = location.hash.match(/^#\/edit\/([^/]+)$/);
  if (editMatch) return { name: 'edit', id: editMatch[1] };
  return { name: 'list' };
}

async function refresh() {
  [events, pendingEvents] = await Promise.all([loadEvents(), loadPendingEvents()]);
}

async function bootstrap() {
  await initializeTheme();
  const mode = getIntroMode();
  const themeBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (isNative()) {
    void SplashScreen.hide({ fadeOutDuration: 0 });
  }

  const [data] = await Promise.all([
    Promise.all([loadEvents(), loadPendingEvents()]),
    playIntro({ mode, app, themeBg })
  ]);
  [events, pendingEvents] = data;
  ui.activeDraftId = pendingEvents[0]?.id || null;
  ui.booting = false;
  if (!['#/list', '#/add'].includes(location.hash) && !location.hash.startsWith('#/edit/')) {
    history.replaceState(null, '', '#/list');
  } else if (!location.hash) {
    history.replaceState(null, '', '#/list');
  }
  ui.pageAnimation = 'page--fade-in';
  await renderRoute();
  setupPressFeedback();
  await ensureWebApiKey();
  setupSettingsGesture();
  setupAndroidBackButton();
}

function pageClass(extra = '') {
  const animation = ui.pageAnimation;
  ui.pageAnimation = '';
  return `page ${animation} ${extra}`.trim();
}

function cancelActivePageAnimation() {
  if (!activePageAnimation) return;
  const { animation, page } = activePageAnimation;
  const computed = getComputedStyle(page);
  page.style.transform = computed.transform === 'none' ? 'translateX(0)' : computed.transform;
  page.style.opacity = computed.opacity;
  animation.cancel();
  activePageAnimation = null;
}

async function animatePage(page, target, { duration = 250, easing = motionEasing() } = {}) {
  if (!page) return false;
  cancelActivePageAnimation();
  const computed = getComputedStyle(page);
  const from = {
    transform: computed.transform === 'none' ? 'translateX(0)' : computed.transform,
    opacity: computed.opacity
  };
  const animation = page.animate([from, target], { duration, easing, fill: 'forwards' });
  activePageAnimation = { animation, page };
  try {
    await animation.finished;
  } catch {
    return false;
  }
  if (activePageAnimation?.animation !== animation) return false;
  activePageAnimation = null;
  page.style.transform = target.transform || '';
  page.style.opacity = target.opacity ?? '';
  return true;
}

async function transitionRoute(hash, direction = 'forward', updateHistory = true) {
  const sequence = ++navigationSequence;
  const currentPage = document.querySelector('.page');
  if (direction === 'back' && currentPage) {
    const completed = await animatePage(currentPage, {
      transform: 'translateX(34px)',
      opacity: 0
    }, { duration: 240 });
    if (!completed || sequence !== navigationSequence) return;
  } else {
    cancelActivePageAnimation();
  }

  if (updateHistory && location.hash !== hash) history.pushState(null, '', hash);
  ui.pageAnimation = '';
  await renderRoute();
  if (sequence !== navigationSequence) return;
  const nextPage = document.querySelector('.page');
  if (!nextPage) return;
  if (direction === 'forward') {
    nextPage.style.transform = 'translateX(34px)';
    nextPage.style.opacity = '0.72';
    await animatePage(nextPage, { transform: 'translateX(0)', opacity: 1 }, { duration: 260 });
  } else {
    nextPage.style.transform = 'translateX(0)';
    nextPage.style.opacity = '0';
    await animatePage(nextPage, { transform: 'translateX(0)', opacity: 1 }, {
      duration: 190,
      easing: motionEasing('--motion-direct')
    });
  }
  if (sequence === navigationSequence && nextPage) {
    nextPage.style.transform = '';
    nextPage.style.opacity = '';
  }
}

function navigateTo(hash, animation = 'page--enter-right') {
  const direction = animation === 'page--enter-right' ? 'forward' : 'back';
  void transitionRoute(hash, direction, true);
}

async function navigateBackToList() {
  await transitionRoute('#/list', 'back', true);
}

async function handleBack() {
  if (closeActiveDialog) {
    closeActiveDialog(false);
    return;
  }
  if (ui.settingsOpen) {
    closeSettingsDrawer();
    return;
  }
  const route = parseRoute();
  if (route.name === 'add') {
    if (WORKING_STATES.includes(ui.recognitionStatus)) {
      if (!await confirmAction('当前通知仍在识别，返回后将终止本次识别。', { title: '放弃本次识别？', confirmLabel: '放弃', danger: true })) return;
      cancelRecognition();
    }
    await navigateBackToList();
    return;
  }
  if (route.name === 'edit') {
    await navigateBackToList();
    return;
  }
  if (ui.selectionMode) {
    await exitSelectionMode();
    return;
  }
  CapacitorApp.exitApp();
}

function setupAndroidBackButton() {
  if (!isNative()) return;
  void CapacitorApp.addListener('backButton', handleBack);
}

function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast = message;
  renderToast();
  toastTimer = setTimeout(() => {
    document.querySelector('.toast')?.classList.add('toast--leaving');
    setTimeout(() => {
      ui.toast = '';
      renderToast();
    }, 180);
  }, 2_000);
}

function toastMarkup() {
  return `<div id="toast-root" aria-live="polite">${ui.toast
    ? `<div class="toast"><span>✓</span>${escapeHtml(ui.toast)}</div>`
    : ''}</div>`;
}

function renderToast() {
  const root = document.querySelector('#toast-root');
  if (root) root.innerHTML = ui.toast
    ? `<div class="toast"><span>✓</span>${escapeHtml(ui.toast)}</div>`
    : '';
}

function setActionBusy(action, button, label) {
  ui.actionBusy = action;
  if (!button) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.classList.add('is-loading');
  button.innerHTML = `<span class="button-spinner"></span>${escapeHtml(label)}`;
}

function clearActionBusy(button, label) {
  ui.actionBusy = null;
  if (!button) return;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  button.classList.remove('is-loading');
  button.textContent = label;
}

function deadlineBadge(event, now = new Date()) {
  if (!event.deadline) return '';
  const deadline = new Date(event.deadline);
  const difference = deadline.getTime() - now.getTime();
  if (Number.isNaN(deadline.getTime()) || difference < 0 || difference > 24 * 60 * 60 * 1000) return '';
  const label = localDateKey(deadline) === localDateKey(now) ? '今天截止' : '明天截止';
  return `<span class="deadline-badge">${label}</span>`;
}

function isUrgentDeadline(event, now = new Date()) {
  if (!event.deadline) return false;
  const difference = new Date(event.deadline).getTime() - now.getTime();
  return Number.isFinite(difference) && difference >= 0 && difference <= 24 * 60 * 60 * 1000;
}

function eventDateParts(event) {
  if (!event.start) return { month: '日期', day: '—', weekday: '待定' };
  const date = new Date(event.start);
  if (Number.isNaN(date.getTime())) return { month: '日期', day: '—', weekday: '待定' };
  return {
    month: `${date.getMonth() + 1}月`,
    day: String(date.getDate()).padStart(2, '0'),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function termWeekNumber(date = new Date()) {
  const month = date.getMonth() + 1;
  const startYear = month < 6 ? date.getFullYear() - 1 : date.getFullYear();
  const termStart = new Date(startYear, TERM_CONFIG.startMonth - 1, TERM_CONFIG.startDay);
  const termEnd = new Date(termStart);
  termEnd.setDate(termEnd.getDate() + TERM_CONFIG.totalWeeks * 7);
  const today = startOfLocalDay(date);
  if (today < termStart || today >= termEnd) return null;
  return Math.floor((today.getTime() - termStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function todayCalendarMarkup(now = new Date()) {
  const week = termWeekNumber(now);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now);
  return `<section class="today-calendar" aria-label="今天">
    <span class="today-calendar__binding" aria-hidden="true"><i></i><i></i></span>
    <div class="today-calendar__date">
      <span>今天</span>
      <strong>${String(now.getDate()).padStart(2, '0')}</strong>
    </div>
    <div class="today-calendar__detail">
      <b>${weekday}</b>
      <span>${now.getMonth() + 1}月${now.getDate()}日</span>
      ${week ? `<small>${TERM_CONFIG.label}第${week}周</small>` : ''}
    </div>
  </section>`;
}

function groupUpcomingEvents(items, now = new Date()) {
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
  const weekEnd = new Date(today);
  const mondayIndex = (today.getDay() + 6) % 7;
  weekEnd.setDate(weekEnd.getDate() + (7 - mondayIndex));
  const groups = [
    { label: '今天', events: [] },
    { label: '明天', events: [] },
    { label: '本周', events: [] },
    { label: '以后', events: [] }
  ];
  for (const event of items) {
    const start = event.start ? new Date(event.start) : null;
    if (!start || Number.isNaN(start.getTime()) || start >= weekEnd) groups[3].events.push(event);
    else if (start >= dayAfterTomorrow) groups[2].events.push(event);
    else if (start >= tomorrow) groups[1].events.push(event);
    else groups[0].events.push(event);
  }
  return groups.filter((group) => group.events.length);
}

function activityGroupsMarkup(items, now) {
  return groupUpcomingEvents(items, now).map((group) => `<section class="activity-group">
    <h2 class="activity-group__title">${group.label}</h2>
    <div class="event-list">${group.events.map((event) => listCard(event)).join('')}</div>
  </section>`).join('');
}

function isEnded(event, now = new Date()) {
  const endValue = event.end || event.start;
  if (!endValue) return false;
  const end = new Date(endValue);
  if (Number.isNaN(end.getTime())) return false;
  if (!event.end && !event.allDay) end.setHours(end.getHours() + 1);
  return end.getTime() < now.getTime();
}

function sortByStart(left, right) {
  const leftTime = left.start ? new Date(left.start).getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right.start ? new Date(right.start).getTime() : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function listCard(event, ended = false, endedIndex = 0) {
  const isNew = ui.newItemIds.includes(event.id);
  const selected = ui.selectedEventIds.has(event.id);
  const date = eventDateParts(event);
  const urgent = isUrgentDeadline(event);
  const calendarSuccess = ui.calendarSuccessIds.has(event.id);
  const dateClass = urgent ? 'event-date--urgent' : '';
  const cardAttribute = ui.selectionMode ? `data-select-id="${event.id}"` : `data-event-id="${event.id}"`;
  return `<div class="event-card-row ${ui.selectionMode ? 'event-card-row--selection' : ''} ${ended ? 'event-card-row--ended' : ''} ${ui.openSwipeId === event.id ? 'event-card-row--open' : ''}" data-row-id="${event.id}" ${ended ? `style="--ended-index:${endedIndex}"` : ''}>
  ${ui.selectionMode ? '' : `<div class="event-card-actions" aria-label="活动快捷操作">
    <button class="event-swipe-action event-swipe-action--calendar" type="button" data-calendar-id="${event.id}">加入日历</button>
    <button class="event-swipe-action event-swipe-action--delete" type="button" data-delete-id="${event.id}">删除</button>
  </div>`}
  <button class="event-card ${ended ? 'event-card--ended' : ''} ${isNew ? 'event-card--new' : ''} ${selected ? 'event-card--selected' : ''}" ${cardAttribute}>
    ${ui.selectionMode ? `<span class="selection-check" aria-hidden="true">${selected ? '✓' : ''}</span>` : ''}
    <span class="event-date ${dateClass} ${calendarSuccess ? 'event-date--tear' : ''}" data-date-id="${event.id}" aria-hidden="true">
      <span class="event-date__success">✓</span>
      <span class="event-date__page">
        <span class="event-date__month">${date.month}</span>
        <strong class="event-date__day">${date.day}</strong>
        <span class="event-date__weekday">${date.weekday}</span>
      </span>
      <span class="event-date__tear-sheet"></span>
    </span>
    <span class="event-card__content">
      <span class="event-card__title">${escapeHtml(event.title || '未命名活动')}</span>
      <span class="event-card__meta">${escapeHtml(formatDateTime(event.start, event.allDay))}</span>
      <span class="event-card__meta">${escapeHtml(event.location || '地点待确认')}</span>
      <span class="event-card__status-row">
        <span class="event-category">${categoryOf(event)}</span>
        <span class="pill pill--${event.status}">${statusLabel(event.status)}</span>
        ${deadlineBadge(event)}
      </span>
    </span>
  </button>
  </div>`;
}

async function deleteSavedEvents(ids) {
  for (const id of ids) await deleteEvent(id);
  await refresh();
}

function updateBulkToolbar() {
  const count = ui.selectedEventIds.size;
  const label = document.querySelector('#selection-count');
  const buttons = document.querySelectorAll('#bulk-delete-button, #bulk-calendar-button');
  if (label) label.textContent = `已选择 ${count} 项`;
  buttons.forEach((button) => { button.disabled = count === 0; });
}

function queueCalendarTear(ids) {
  ids.forEach((id) => ui.calendarSuccessIds.add(id));
}

async function exitSelectionMode() {
  const toolbar = document.querySelector('.bulk-toolbar');
  if (toolbar) {
    toolbar.classList.add('bulk-toolbar--leaving');
    await wait(220);
  }
  ui.selectionMode = false;
  ui.selectedEventIds.clear();
  await renderListPage();
}

async function animateListDeletion(ids) {
  ids.forEach((id) => document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.classList.add('event-card-row--deleting'));
  await wait(260);
}

function setSwipeVisual(row, offset) {
  const card = row?.querySelector('.event-card');
  const actions = row?.querySelector('.event-card-actions');
  if (!card || !actions) return;
  card.style.transform = `translateX(${offset}px)`;
  actions.style.opacity = String(clamp(Math.abs(Math.min(0, offset)) / 136));
}

function animateSwipeRow(row, target, velocity = 0) {
  const card = row?.querySelector('.event-card');
  const actions = row?.querySelector('.event-card-actions');
  if (!card || !actions) return Promise.resolve();
  const start = transformTranslateX(card);
  card.getAnimations().forEach((animation) => animation.cancel());
  actions.getAnimations().forEach((animation) => animation.cancel());
  const open = target < 0;
  row.classList.toggle('event-card-row--open', open);
  const distance = Math.abs(target - start) / 136;
  const duration = clamp(Math.round(165 + distance * 95 - Math.min(Math.abs(velocity), 1.5) * 35), 150, 270);
  const animation = card.animate([
    { transform: `translateX(${start}px)` },
    { transform: `translateX(${target}px)` }
  ], { duration, easing: motionEasing(), fill: 'forwards' });
  const actionAnimation = actions.animate([
    { opacity: clamp(Math.abs(Math.min(0, start)) / 136) },
    { opacity: open ? 1 : 0 }
  ], { duration: Math.min(duration, 210), easing: motionEasing('--motion-direct'), fill: 'forwards' });
  return animation.finished.catch(() => null).then(() => {
    if (!card.isConnected || card.getAnimations().includes(animation) === false) return;
    animation.cancel();
    actionAnimation.cancel();
    card.style.transform = '';
    actions.style.opacity = '';
  });
}

function closeOpenSwipeRow(exceptRow = null) {
  const openRow = document.querySelector('.event-card-row--open');
  if (openRow && openRow !== exceptRow) void animateSwipeRow(openRow, 0);
  if (!exceptRow || openRow !== exceptRow) ui.openSwipeId = null;
}

function bindSwipeCards() {
  const revealWidth = 136;
  document.querySelectorAll('.event-card-row:not(.event-card-row--selection)').forEach((row) => {
    const card = row.querySelector('[data-event-id]');
    if (!card) return;
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let currentOffset = 0;
    let dragging = false;
    let suppressClick = false;
    let directionLocked = false;
    let samples = [];
    let activePointerId = null;

    card.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button > 0) return;
      const running = card.getAnimations();
      if (running.length) {
        const interruptedOffset = transformTranslateX(card);
        running.forEach((animation) => animation.cancel());
        row.querySelector('.event-card-actions')?.getAnimations().forEach((animation) => animation.cancel());
        setSwipeVisual(row, interruptedOffset);
      }
      startX = event.clientX;
      startY = event.clientY;
      startOffset = transformTranslateX(card);
      if (!startOffset) startOffset = row.classList.contains('event-card-row--open') ? -revealWidth : 0;
      currentOffset = startOffset;
      dragging = false;
      directionLocked = false;
      samples = [{ x: event.clientX, time: performance.now() }];
      activePointerId = event.pointerId;
      capturePointer(card, event.pointerId);
    });

    card.addEventListener('pointermove', (event) => {
      if (activePointerId !== event.pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!directionLocked && (Math.abs(deltaX) > 9 || Math.abs(deltaY) > 9)) {
        directionLocked = true;
        if (Math.abs(deltaY) >= Math.abs(deltaX) * 0.92) {
          releasePointer(card, event.pointerId);
          activePointerId = null;
          return;
        }
        dragging = true;
        card.classList.remove('is-pressed');
        closeOpenSwipeRow(row);
        row.classList.add('event-card-row--dragging');
        card.classList.add('event-card--dragging');
      }
      if (!dragging) return;
      event.preventDefault();
      const desired = startOffset + deltaX;
      if (desired > 0) currentOffset = desired * 0.18;
      else if (desired < -revealWidth) currentOffset = -revealWidth + (desired + revealWidth) * 0.18;
      else currentOffset = desired;
      setSwipeVisual(row, currentOffset);
      const now = performance.now();
      samples.push({ x: event.clientX, time: now });
      samples = samples.filter((sample) => now - sample.time <= 90);
    });

    const finishSwipe = (event, cancelled = false) => {
      if (activePointerId !== event.pointerId) return;
      releasePointer(card, event.pointerId);
      activePointerId = null;
      if (!dragging) return;
      row.classList.remove('event-card-row--dragging');
      card.classList.remove('event-card--dragging');
      const finishTime = performance.now();
      samples.push({ x: event.clientX, time: finishTime });
      samples = samples.filter((sample) => finishTime - sample.time <= 90);
      const first = samples[0];
      const last = samples[samples.length - 1] || first;
      const velocity = cancelled || last.time === first.time ? 0 : (last.x - first.x) / (last.time - first.time);
      const projected = currentOffset + velocity * 140;
      const shouldOpen = !cancelled && (velocity < -0.45 || (velocity <= 0.45 && projected < -revealWidth / 2));
      ui.openSwipeId = shouldOpen ? row.dataset.rowId : null;
      void animateSwipeRow(row, shouldOpen ? -revealWidth : 0, velocity);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 320);
      dragging = false;
    };
    card.addEventListener('pointerup', finishSwipe);
    card.addEventListener('pointercancel', (event) => finishSwipe(event, true));
    card.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (row.classList.contains('event-card-row--open')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ui.openSwipeId = null;
        void animateSwipeRow(row, 0);
      }
    });
  });
}

async function createAppReturnWaiter() {
  let leftApp = false;
  let resolved = false;
  let resolveWait;
  const promise = new Promise((resolve) => { resolveWait = resolve; });
  const listener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) leftApp = true;
    if (isActive && leftApp && !resolved) {
      resolved = true;
      clearTimeout(timeout);
      void listener.remove();
      resolveWait();
    }
  });
  const timeout = setTimeout(() => {
    if (resolved) return;
    resolved = true;
    void listener.remove();
    resolveWait();
  }, 5 * 60 * 1000);
  return {
    promise,
    cancel() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      void listener.remove();
      resolveWait();
    }
  };
}

async function launchCalendarStep(action, waitForReturn) {
  const waiter = waitForReturn && isNative() ? await createAppReturnWaiter() : null;
  try {
    await action();
    if (waiter) await waiter.promise;
  } catch (error) {
    waiter?.cancel();
    throw error;
  }
}

async function openSavedEventInCalendar(event, waitForReturn = false) {
  const hasDeadline = hasDeadlineCalendarEntry(event);
  await launchCalendarStep(() => addToCalendar(event), hasDeadline || waitForReturn);
  if (hasDeadline) {
    await launchCalendarStep(() => addDeadlineToCalendar(event), waitForReturn);
  }
  await updateEvent(event.id, { status: 'registered' });
}

function setFabHidden(hidden) {
  if (ui.fabHidden === hidden) return;
  ui.fabHidden = hidden;
  document.querySelector('.fab')?.classList.toggle('fab--hidden', hidden);
}

function bindListScroll() {
  if (listScrollHandler) window.removeEventListener('scroll', listScrollHandler);
  let previousY = window.scrollY;
  listScrollHandler = () => {
    const currentY = window.scrollY;
    if (currentY > previousY + 5 && currentY > 70) setFabHidden(true);
    if (currentY < previousY - 5 || currentY < 20) setFabHidden(false);
    previousY = currentY;
  };
  window.addEventListener('scroll', listScrollHandler, { passive: true });
}

async function renderListPage() {
  const now = new Date();
  const upcoming = events.filter((event) => !isEnded(event, now)).sort(sortByStart);
  const ended = events.filter((event) => isEnded(event, now)).sort((a, b) => sortByStart(b, a));
  ui.fabHidden = false;
  ui.openSwipeId = null;
  ui.selectedEventIds = new Set([...ui.selectedEventIds].filter((id) => events.some((event) => event.id === id)));

  app.innerHTML = `<main class="${pageClass(`list-page ${ui.selectionMode ? 'list-page--manage' : ''}`)}">
    <header class="compact-header">
      <h1>活动</h1>
      <div class="compact-header__actions">
        <span class="count-badge">${events.length} 项</span>
        ${events.length ? `<button class="manage-button" id="manage-button" type="button">${ui.selectionMode ? '完成' : '管理'}</button>` : ''}
        <button class="icon-button app-bar-action" id="settings-button" type="button" aria-label="打开菜单">⋮</button>
      </div>
    </header>

    ${todayCalendarMarkup(now)}

    ${pendingEvents.length ? `<button class="pending-resume" id="resume-pending">
      <span>有 ${pendingEvents.length} 个活动等待确认</span><b>继续 →</b>
    </button>` : ''}

    <section class="activity-list">
      ${upcoming.length
        ? activityGroupsMarkup(upcoming, now)
        : `<div class="empty-state empty-state--list">
            <img src="${emptyCalendarUrl}" alt="空白台历页">
            <p>还没有活动，点右下角的加号，添加一张通知截图</p>
          </div>`}
    </section>

    ${ended.length ? `<section class="ended-group">
      <button class="ended-summary" id="ended-toggle" type="button" aria-expanded="${ui.endedExpanded}">
        <span>已结束</span><span class="ended-summary__right"><b>${ended.length}</b><i>⌄</i></span>
      </button>
      <div class="ended-list-wrap ${ui.endedExpanded ? 'is-open' : ''}" id="ended-list-wrap">
        <div class="ended-list-inner"><div class="event-list">${ended.map((event, index) => listCard(event, true, index)).join('')}</div></div>
      </div>
    </section>` : ''}

    ${ui.selectionMode ? `<div class="bulk-toolbar">
      <span id="selection-count">已选择 ${ui.selectedEventIds.size} 项</span>
      <button class="button button--secondary" id="cancel-selection" type="button">取消</button>
      <button class="button button--calendar-compact" id="bulk-calendar-button" type="button" ${ui.selectedEventIds.size ? '' : 'disabled'}>加入日历</button>
      <button class="button button--danger" id="bulk-delete-button" type="button" ${ui.selectedEventIds.size ? '' : 'disabled'}>删除所选</button>
    </div>` : '<button class="fab" id="add-button" aria-label="添加活动">＋</button>'}
    ${toastMarkup()}
  </main>`;

  document.querySelector('#add-button')?.addEventListener('click', () => navigateTo('#/add'));
  document.querySelector('#settings-button')?.addEventListener('click', openSettingsDrawer);
  document.querySelector('#ended-toggle')?.addEventListener('click', () => {
    ui.endedExpanded = !ui.endedExpanded;
    const button = document.querySelector('#ended-toggle');
    const wrap = document.querySelector('#ended-list-wrap');
    button?.setAttribute('aria-expanded', String(ui.endedExpanded));
    wrap?.classList.toggle('is-open', ui.endedExpanded);
  });
  document.querySelector('#manage-button')?.addEventListener('click', async () => {
    await wait(90);
    if (ui.selectionMode) {
      await exitSelectionMode();
    } else {
      ui.selectionMode = true;
      ui.selectedEventIds.clear();
      await renderListPage();
    }
  });
  document.querySelector('#cancel-selection')?.addEventListener('click', exitSelectionMode);
  document.querySelector('#resume-pending')?.addEventListener('click', () => {
    ui.activeDraftId = pendingEvents[0]?.id || null;
    navigateTo('#/add');
  });
  bindSwipeCards();
  document.querySelectorAll('[data-event-id]').forEach((card) => card.addEventListener('click', async () => {
    await wait(90);
    formError = '';
    navigateTo(`#/edit/${card.dataset.eventId}`);
  }));
  document.querySelectorAll('[data-select-id]').forEach((card) => card.addEventListener('click', () => {
    const id = card.dataset.selectId;
    if (ui.selectedEventIds.has(id)) ui.selectedEventIds.delete(id);
    else ui.selectedEventIds.add(id);
    card.classList.toggle('event-card--selected', ui.selectedEventIds.has(id));
    const check = card.querySelector('.selection-check');
    if (check) check.textContent = ui.selectedEventIds.has(id) ? '✓' : '';
    updateBulkToolbar();
  }));
  document.querySelectorAll('[data-delete-id]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.deleteId;
    const event = events.find((item) => item.id === id);
    if (!event || !await confirmAction(`“${event.title || '未命名活动'}”将从活动列表中移除，此操作无法撤销。`, { title: '删除这个活动？', confirmLabel: '删除', danger: true })) return;
    button.disabled = true;
    await animateListDeletion([id]);
    await deleteSavedEvents([id]);
    await renderListPage();
    showToast('已删除');
  }));
  document.querySelectorAll('[data-calendar-id]').forEach((button) => button.addEventListener('click', async () => {
    const event = events.find((item) => item.id === button.dataset.calendarId);
    if (!event) return;
    if (!event.start) {
      showToast('请先补全活动时间');
      return;
    }
    setActionBusy('calendar', button, isNative() ? '打开中…' : '生成中…');
    try {
      await openSavedEventInCalendar(event);
      await refresh();
      queueCalendarTear([event.id]);
      ui.actionBusy = null;
      await renderListPage();
      showToast(calendarSuccessMessage(event));
    } catch (error) {
      ui.actionBusy = null;
      await renderListPage();
      showToast(error.message || '无法打开系统日历');
    }
  }));
  document.querySelector('#bulk-calendar-button')?.addEventListener('click', async () => {
    const selected = [...ui.selectedEventIds].map((id) => events.find((event) => event.id === id)).filter(Boolean);
    const missingTime = selected.filter((event) => !event.start);
    if (!selected.length) return;
    if (missingTime.length) {
      await showNotice(`有 ${missingTime.length} 个活动缺少开始时间，请先补全后再加入日历。`);
      return;
    }
    const deadlineCount = selected.filter(hasDeadlineCalendarEntry).length;
    const totalEntries = selected.length + deadlineCount;
    const calendarPrompt = isNative()
      ? `活动日期与报名截止将分开处理，共依次打开 ${totalEntries} 个系统日历页面。每保存一条并返回后，会继续下一条。`
      : `活动日期与报名截止将分开处理，共下载 ${totalEntries} 个日历文件。如浏览器询问，请允许下载多个文件。`;
    if (!await confirmAction(calendarPrompt, { title: '批量加入日历？', confirmLabel: '开始' })) return;
    setActionBusy('calendar', document.querySelector('#bulk-calendar-button'), '处理中…');
    try {
      for (let index = 0; index < selected.length; index += 1) {
        await openSavedEventInCalendar(selected[index], index < selected.length - 1);
      }
      await refresh();
      queueCalendarTear(selected.map((event) => event.id));
      ui.actionBusy = null;
      await exitSelectionMode();
      showToast(`已处理 ${selected.length} 个活动`);
    } catch (error) {
      await refresh();
      ui.actionBusy = null;
      await renderListPage();
      showToast(error.message || '无法打开系统日历');
    }
  });
  document.querySelector('#bulk-delete-button')?.addEventListener('click', async () => {
    const ids = [...ui.selectedEventIds];
    if (!ids.length || !await confirmAction(`选中的 ${ids.length} 个活动将被永久移除。`, { title: '批量删除活动？', confirmLabel: `删除 ${ids.length} 项`, danger: true })) return;
    setActionBusy('deleting', document.querySelector('#bulk-delete-button'), '删除中…');
    await animateListDeletion(ids);
    await deleteSavedEvents(ids);
    ui.actionBusy = null;
    await exitSelectionMode();
    showToast(`已删除 ${ids.length} 个活动`);
  });
  bindListScroll();
  if (ui.calendarSuccessIds.size) {
    const animatedIds = [...ui.calendarSuccessIds];
    setTimeout(() => {
      animatedIds.forEach((id) => {
        document.querySelector(`[data-date-id="${CSS.escape(id)}"]`)?.classList.remove('event-date--tear');
        ui.calendarSuccessIds.delete(id);
      });
    }, 430);
  }
  if (ui.newItemIds.length) setTimeout(() => { ui.newItemIds = []; }, 400);
}

function clearRecognitionTimers() {
  clearTimeout(slowTimer);
  clearInterval(statusTextTimer);
  slowTimer = null;
  statusTextTimer = null;
}

function setRecognitionStatus(status, patch = {}) {
  if (!RECOGNITION_STATES.includes(status)) throw new Error('未知识别状态：' + status);
  const previous = ui.recognitionStatus;
  clearRecognitionTimers();
  Object.assign(ui, patch, {
    recognitionStatus: status,
    errorStage: status === 'error' ? (patch.errorStage || previous) : null
  });

  if (status === 'compressing') ui.startedAt = Date.now();
  if (WORKING_STATES.includes(status)) {
    const slowDelay = Math.max(0, 15_000 - (Date.now() - ui.startedAt));
    slowTimer = setTimeout(() => {
      ui.slow = true;
      if (parseRoute().name === 'add') renderAddPage();
    }, slowDelay);
  }
  if (status === 'recognizing') {
    statusTextTimer = setInterval(() => {
      ui.statusTextIndex = (ui.statusTextIndex + 1) % STATUS_MESSAGES.length;
      const label = document.querySelector('[data-status-message]');
      if (label) label.textContent = STATUS_MESSAGES[ui.statusTextIndex];
    }, 2_000);
  }
  if (status === 'idle') {
    ui.error = '';
    ui.slow = false;
    ui.statusTextIndex = 0;
    ui.resultIds = [];
    ui.compressedImage = '';
    ui.startedAt = 0;
  }
  if (parseRoute().name === 'add' && !ui.booting) renderAddPage();
}

function stageIndicator() {
  const labels = ui.recognitionSource === 'text'
    ? ['整理文字', '上传', '识别中', '完成']
    : ['压缩图片', '上传', '识别中', '完成'];
  const stage = ui.recognitionStatus === 'error' ? ui.errorStage : ui.recognitionStatus;
  const activeIndex = Math.max(0, STAGE_STATES.indexOf(stage));
  return `<ol class="stage-indicator" aria-label="识别进度">
    ${labels.map((label, index) => {
      const complete = ui.recognitionStatus === 'done' || index < activeIndex;
      const active = ui.recognitionStatus !== 'error' && index === activeIndex;
      return `<li class="${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}">
        <span class="stage-dot">${complete ? '✓' : index + 1}</span>
        <span class="stage-label">${label}</span>
      </li>`;
    }).join('')}
  </ol>`;
}

function skeletonCard() {
  return `<div class="skeleton-card" aria-hidden="true">
    <div class="skeleton-line skeleton-line--title"></div>
    <div class="skeleton-field"><i></i><div class="skeleton-line"></div></div>
    <div class="skeleton-field"><i></i><div class="skeleton-line skeleton-line--medium"></div></div>
    <div class="skeleton-field"><i></i><div class="skeleton-line skeleton-line--short"></div></div>
    <div class="skeleton-field"><i></i><div class="skeleton-line"></div></div>
  </div>`;
}

function recognitionPanel() {
  const isWorking = WORKING_STATES.includes(ui.recognitionStatus);
  const statusText = ui.recognitionStatus === 'compressing'
    ? '正在压缩图片…'
    : ui.recognitionStatus === 'uploading'
      ? `正在上传${ui.recognitionSource === 'text' ? '文字' : '图片'}…`
      : STATUS_MESSAGES[ui.statusTextIndex];

  return `<section class="recognition-panel">
    ${ui.recognitionSource === 'image' ? `<input id="replace-image-input" data-image-input class="visually-hidden" type="file" accept="image/*">
      <div class="preview-card">
        <img src="${escapeHtml(ui.previewUrl)}" alt="所选通知截图缩略图">
        <div><strong>${escapeHtml(ui.selectedFile?.name || '所选截图')}</strong><small>请确认截图内容正确</small></div>
        <label for="replace-image-input">更换</label>
      </div>` : `<div class="preview-card preview-card--text">
        <span class="text-preview-icon">文</span>
        <div><strong>文字通知</strong><small>${escapeHtml(ui.selectedText.slice(0, 80))}</small></div>
      </div>`}
    ${stageIndicator()}
    ${isWorking ? `${skeletonCard()}
      <div class="recognition-status">
        <span data-status-message>${escapeHtml(statusText)}</span>
        ${ui.slow ? '<div class="slow-row"><b>识别时间较长</b><button id="cancel-recognition">取消</button></div>' : ''}
      </div>` : ''}
    ${ui.recognitionStatus === 'error' ? `<div class="error-card">
      <span>!</span><div><h2>没有识别成功</h2><p>${escapeHtml(ui.error)}</p></div>
      <button id="retry-recognition">重试</button>
    </div>` : ''}
  </section>`;
}

function selectInputPanel() {
  return `<section class="add-picker add-methods">
    <input id="add-image-input" data-image-input class="visually-hidden" type="file" accept="image/*">
    <label class="add-picker__button" for="add-image-input">
      <span class="capture-button__icon">＋</span>
      <span><strong>选择通知截图</strong><small>支持海报、群聊和公众号截图</small></span>
    </label>
    <form class="text-extract-card" id="text-extract-form">
      <div class="text-extract-card__heading"><span class="text-preview-icon">文</span><div><strong>粘贴通知文字</strong><small>适合群消息、公众号正文或邮件</small></div></div>
      <textarea name="noticeText" maxlength="10000" placeholder="在这里粘贴活动通知内容…" aria-label="活动通知文字"></textarea>
      <button class="button button--primary" type="submit">从文字提取</button>
    </form>
    <p>图片和文字只用于识别本次活动信息</p>
  </section>`;
}

function fieldClass(event, field, flash) {
  const uncertain = event.uncertain?.includes(field);
  return `field ${uncertain ? 'field--uncertain' : ''} ${uncertain && flash ? 'uncertain-flash' : ''}`;
}

function editorField(label, name, value, event, type = 'text', flash = false) {
  const uncertain = event.uncertain?.includes(name);
  return `<label class="${fieldClass(event, name, flash)}"><span>${label}${uncertain ? '<b>请核对</b>' : ''}</span>
    <input name="${name}" type="${type}" value="${escapeHtml(value || '')}">
  </label>`;
}

function eventFormMarkup(event, options) {
  const { mode, index = 0, total = 1 } = options;
  const isAdd = mode === 'add';
  const timeType = event.allDay ? 'date' : 'datetime-local';
  const inputTime = (value) => event.allDay && value ? value.slice(0, 10) : (value || '');
  const flash = !seenUncertainIds.has(event.id);

  return `<section class="activity-editor ${isAdd ? 'activity-editor--recognized' : ''}">
    ${isAdd ? `<div class="recognized-heading"><span>识别到 ${total} 个活动</span><b>${index + 1} / ${total}</b></div>` : ''}
    <form id="event-form" class="editor-form" data-mode="${mode}" data-id="${event.id}">
      ${editorField('活动名称', 'title', event.title, event, 'text', flash)}
      <label class="${fieldClass(event, 'category', flash)}"><span>活动类型${event.uncertain?.includes('category') ? '<b>请核对</b>' : ''}</span><select name="category">
        ${EVENT_CATEGORIES.map((category) => `<option value="${category}" ${categoryOf(event) === category ? 'selected' : ''}>${category}</option>`).join('')}
      </select></label>
      <label class="toggle-row"><span><strong>全天活动</strong><small>通知只给出日期时开启</small></span><input name="allDay" type="checkbox" ${event.allDay ? 'checked' : ''}></label>
      <div class="time-grid">
        ${editorField('开始', 'start', inputTime(event.start), event, timeType, flash)}
        ${editorField('结束', 'end', inputTime(event.end), event, timeType, flash)}
      </div>
      ${editorField('地点', 'location', event.location, event, 'text', flash)}
      ${editorField('报名截止', 'deadline', event.deadline, event, 'datetime-local', flash)}
      <label class="${fieldClass(event, 'signup', flash)}"><span>报名方式${event.uncertain?.includes('signup') ? '<b>请核对</b>' : ''}</span><textarea name="signup" rows="3">${escapeHtml(event.signup || '')}</textarea></label>
      <label class="${fieldClass(event, 'description', flash)}"><span>日历描述${event.uncertain?.includes('description') ? '<b>请核对</b>' : ''}</span><textarea name="description" rows="6">${escapeHtml(event.description || '')}</textarea></label>
      <label class="field"><span>状态</span><select name="status">
        <option value="interested" ${event.status === 'interested' ? 'selected' : ''}>感兴趣</option>
        <option value="registered" ${event.status === 'registered' ? 'selected' : ''}>已报名</option>
        <option value="skipped" ${event.status === 'skipped' ? 'selected' : ''}>不参加</option>
      </select></label>
      ${formError ? `<div class="message message--error">${escapeHtml(formError)}</div>` : ''}
      <div class="editor-actions ${isAdd ? 'editor-actions--add' : ''}">
        ${isAdd
          ? `<button class="button button--secondary" type="button" id="discard-draft-button">放弃</button>
             <button class="button button--primary" type="submit" id="save-button">保存</button>`
          : `<button class="button button--secondary" type="button" id="delete-button">删除</button>
             <button class="button button--primary" type="submit" id="save-button">保存</button>
             <button class="button button--calendar" type="button" id="calendar-button">加入日历</button>`}
      </div>
    </form>
  </section>`;
}

function getFormPatch(form, original) {
  const data = new FormData(form);
  const allDay = data.get('allDay') === 'on';
  const valueOrNull = (name) => String(data.get(name) || '').trim() || null;
  const touched = new Set([...form.querySelectorAll('[data-touched="true"]')].map((element) => element.name));
  let start = valueOrNull('start');
  let end = valueOrNull('end');
  if (allDay) {
    if (start) start = start.slice(0, 10) + 'T00:00';
    if (end) end = end.slice(0, 10) + 'T00:00';
  } else {
    if (start && !start.includes('T')) start += original.start?.startsWith(start + 'T') ? original.start.slice(10) : 'T00:00';
    if (end && !end.includes('T')) end += original.end?.startsWith(end + 'T') ? original.end.slice(10) : 'T00:00';
  }
  return {
    title: String(data.get('title') || '').trim(),
    start,
    end,
    allDay,
    location: valueOrNull('location'),
    deadline: valueOrNull('deadline'),
    signup: valueOrNull('signup'),
    description: valueOrNull('description'),
    category: EVENT_CATEGORIES.includes(data.get('category')) ? String(data.get('category')) : '其他',
    status: String(data.get('status') || original.status || 'interested'),
    uncertain: (original.uncertain || []).filter((field) => !touched.has(field))
  };
}

async function persistFormEvent(mode, event, patch) {
  if (mode === 'add') await updatePendingEvent(event.id, patch);
  else await updateEvent(event.id, patch);
  await refresh();
}

async function confirmDraft(event, patch) {
  const confirmed = { ...event, ...patch, status: patch.status || 'interested' };
  await addEvents([confirmed]);
  await deletePendingEvent(event.id);
  await refresh();
  ui.newItemIds.push(confirmed.id);
  return confirmed;
}

function bindEventForm(event, options) {
  const { mode } = options;
  const form = document.querySelector('#event-form');
  if (!form) return;
  seenUncertainIds.add(event.id);
  form.querySelectorAll('input, textarea, select').forEach((control) => control.addEventListener('input', () => {
    control.dataset.touched = 'true';
  }));

  form.elements.allDay.addEventListener('change', async () => {
    await persistFormEvent(mode, event, getFormPatch(form, event));
    if (mode === 'add') await renderAddPage();
    else await renderEditPage(event.id);
  });

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (ui.actionBusy) return;
    const button = document.querySelector('#save-button');
    const patch = getFormPatch(form, event);
    if (!patch.title) {
      formError = '请填写活动名称';
      if (mode === 'add') await renderAddPage();
      else await renderEditPage(event.id);
      return;
    }

    setActionBusy('saving', button, '保存中…');
    try {
      if (mode === 'add') {
        await confirmDraft(event, patch);
        const nextDraft = pendingEvents.find((draft) => ui.resultIds.includes(draft.id)) || pendingEvents[0];
        ui.actionBusy = null;
        formError = '';
        showToast('已保存');
        if (nextDraft) {
          ui.activeDraftId = nextDraft.id;
          await renderAddPage();
        } else {
          ui.activeDraftId = null;
          setRecognitionStatus('idle');
          await navigateBackToList();
        }
      } else {
        await updateEvent(event.id, patch);
        await refresh();
        ui.actionBusy = null;
        formError = '';
        showToast('已保存');
        await navigateBackToList();
      }
    } catch {
      formError = '保存失败，请重试';
      clearActionBusy(button, '保存');
      if (mode === 'add') await renderAddPage();
      else await renderEditPage(event.id);
    }
  });

  if (mode === 'add') {
    document.querySelector('#discard-draft-button')?.addEventListener('click', async () => {
      if (ui.actionBusy || !await confirmAction('这个待确认活动将被移除，尚未保存的修改也会丢失。', { title: '放弃这个活动？', confirmLabel: '放弃', danger: true })) return;
      setActionBusy('discarding', document.querySelector('#discard-draft-button'), '正在放弃…');
      await deletePendingEvent(event.id);
      ui.resultIds = ui.resultIds.filter((id) => id !== event.id);
      await refresh();
      ui.actionBusy = null;
      formError = '';
      const nextDraft = pendingEvents.find((draft) => ui.resultIds.includes(draft.id)) || pendingEvents[0];
      if (nextDraft) {
        ui.activeDraftId = nextDraft.id;
        await renderAddPage();
      } else {
        ui.activeDraftId = null;
        setRecognitionStatus('idle');
        await navigateBackToList();
      }
    });
  }

  if (mode === 'edit') {
    document.querySelector('#calendar-button').addEventListener('click', async () => {
      if (ui.actionBusy) return;
      const button = document.querySelector('#calendar-button');
      const patch = getFormPatch(form, event);
      if (!patch.title || !patch.start) {
        formError = '加入日历前请补全活动名称和开始时间';
        await renderEditPage(event.id);
        return;
      }
      setActionBusy('calendar', button, isNative() ? '正在打开…' : '正在生成…');
      try {
        await updateEvent(event.id, patch);
        const saved = { ...event, ...patch };
        await openSavedEventInCalendar(saved);
        await refresh();
        queueCalendarTear([event.id]);
        ui.actionBusy = null;
        formError = '';
        showToast(calendarSuccessMessage(saved));
        await navigateBackToList();
      } catch (error) {
        ui.actionBusy = null;
        formError = error.message || '无法打开系统日历';
        await renderEditPage(event.id);
      }
    });

    document.querySelector('#delete-button').addEventListener('click', async () => {
      if (ui.actionBusy || !await confirmAction('这个活动将从活动列表中移除，此操作无法撤销。', { title: '删除这个活动？', confirmLabel: '删除', danger: true })) return;
      setActionBusy('deleting', document.querySelector('#delete-button'), '删除中…');
      await navigateBackToList();
      await nextPaint();
      await animateListDeletion([event.id]);
      await deleteSavedEvents([event.id]);
      ui.actionBusy = null;
      await renderListPage();
      showToast('已删除');
    });
  }
}

async function renderAddPage() {
  if (parseRoute().name !== 'add') return;
  const draft = pendingEvents.find((event) => event.id === ui.activeDraftId)
    || pendingEvents.find((event) => ui.resultIds.includes(event.id))
    || (ui.recognitionStatus === 'idle' ? pendingEvents[0] : null);
  if (draft) ui.activeDraftId = draft.id;
  const relatedDrafts = ui.resultIds.length
    ? pendingEvents.filter((event) => ui.resultIds.includes(event.id))
    : pendingEvents;
  const draftIndex = Math.max(0, relatedDrafts.findIndex((event) => event.id === draft?.id));

  app.innerHTML = `<main class="${pageClass('secondary-page add-page')}">
    <header class="secondary-header">
      <button class="icon-button" id="back-button" aria-label="返回">←</button>
      <h1>添加活动</h1>
    </header>
    <div class="secondary-content">
      ${draft
        ? eventFormMarkup(draft, { mode: 'add', index: draftIndex, total: relatedDrafts.length || 1 })
        : ui.recognitionStatus === 'idle'
          ? selectInputPanel()
          : recognitionPanel()}
    </div>
    ${toastMarkup()}
  </main>`;

  document.querySelector('#back-button').addEventListener('click', async () => {
    if (WORKING_STATES.includes(ui.recognitionStatus)) {
      if (!await confirmAction('当前通知仍在识别，返回后将终止本次识别。', { title: '放弃本次识别？', confirmLabel: '放弃', danger: true })) return;
      cancelRecognition();
    }
    await navigateBackToList();
  });
  bindImageInputs();
  bindTextInput();
  document.querySelector('#cancel-recognition')?.addEventListener('click', cancelRecognition);
  document.querySelector('#retry-recognition')?.addEventListener('click', () => {
    if (ui.recognitionSource === 'text') void startTextRecognition(ui.selectedText);
    else void startRecognition(ui.selectedFile, false);
  });
  if (draft) bindEventForm(draft, { mode: 'add' });
}

async function renderEditPage(id) {
  const event = events.find((item) => item.id === id);
  if (!event) {
    navigateTo('#/list', 'page--fade-in');
    return;
  }
  app.innerHTML = `<main class="${pageClass('secondary-page edit-page')}">
    <header class="secondary-header">
      <button class="icon-button" id="back-button" aria-label="返回">←</button>
      <h1>编辑活动</h1>
    </header>
    <div class="secondary-content">${eventFormMarkup(event, { mode: 'edit' })}</div>
    ${toastMarkup()}
  </main>`;
  document.querySelector('#back-button').addEventListener('click', navigateBackToList);
  bindEventForm(event, { mode: 'edit' });
}

function bindImageInputs() {
  document.querySelectorAll('input[type="file"][data-image-input]').forEach((input) => {
    input.addEventListener('change', handleImage);
  });
}

function bindTextInput() {
  document.querySelector('#text-extract-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('noticeText') || '').trim();
    if (!text) {
      event.currentTarget.querySelector('textarea')?.focus();
      showToast('请先粘贴通知文字');
      return;
    }
    await startTextRecognition(text);
  });
}

async function handleImage(inputEvent) {
  const file = inputEvent.target.files?.[0];
  if (!file) return;
  await startRecognition(file, true);
}

async function startRecognition(file, replacePreview) {
  if (!file) return;
  if (WORKING_STATES.includes(ui.recognitionStatus)) {
    window.dispatchEvent(new Event('campus:cancel-extraction'));
  }
  const runId = ++recognitionRunId;
  if (replacePreview) {
    if (ui.previewUrl) URL.revokeObjectURL(ui.previewUrl);
    ui.previewUrl = URL.createObjectURL(file);
  }
  ui.selectedFile = file;
  ui.selectedText = '';
  ui.recognitionSource = 'image';
  ui.activeDraftId = null;
  setRecognitionStatus('compressing', {
    error: '',
    slow: false,
    statusTextIndex: 0,
    resultIds: []
  });

  try {
    const imageDataUrl = await compressImage(file);
    if (runId !== recognitionRunId) return;
    ui.compressedImage = imageDataUrl;
    setRecognitionStatus('uploading', { slow: false });
    const extracted = await extractEvents(imageDataUrl, new Date());
    if (runId !== recognitionRunId) return;

    await storeExtractionResults(extracted, runId);
  } catch (error) {
    if (runId !== recognitionRunId || ui.recognitionStatus === 'error') return;
    setRecognitionStatus('error', {
      error: error.message || '识别失败，请重试',
      slow: false
    });
  }
}

async function startTextRecognition(text) {
  const content = String(text || '').trim();
  if (!content) return;
  if (WORKING_STATES.includes(ui.recognitionStatus)) {
    window.dispatchEvent(new Event('campus:cancel-extraction'));
  }
  const runId = ++recognitionRunId;
  if (ui.previewUrl) {
    URL.revokeObjectURL(ui.previewUrl);
    ui.previewUrl = '';
  }
  ui.selectedFile = null;
  ui.selectedText = content;
  ui.recognitionSource = 'text';
  ui.activeDraftId = null;
  setRecognitionStatus('uploading', {
    error: '',
    slow: false,
    startedAt: Date.now(),
    statusTextIndex: 0,
    resultIds: []
  });

  try {
    const extracted = await extractEventsFromText(content, new Date());
    if (runId !== recognitionRunId) return;
    await storeExtractionResults(extracted, runId);
  } catch (error) {
    if (runId !== recognitionRunId || ui.recognitionStatus === 'error') return;
    setRecognitionStatus('error', {
      error: error.message || '识别失败，请重试',
      slow: false
    });
  }
}

async function storeExtractionResults(extracted, runId) {
  if (runId !== recognitionRunId) return;
  const drafts = extracted.map((item) => ({
    ...item,
    id: makeId(),
    status: 'interested',
    createdAt: new Date().toISOString()
  }));
  await addPendingEvents(drafts);
  await refresh();
  document.querySelector('.skeleton-card')?.classList.add('skeleton-card--leaving');
  await wait(180);
  if (runId !== recognitionRunId) return;
  ui.activeDraftId = drafts[0]?.id || null;
  setRecognitionStatus('done', {
    resultIds: drafts.map((event) => event.id),
    slow: false
  });
}

function cancelRecognition() {
  recognitionRunId += 1;
  window.dispatchEvent(new Event('campus:cancel-extraction'));
  setRecognitionStatus('error', { error: '已取消识别', slow: false });
}

window.addEventListener('campus:extract-stage', (event) => {
  if (event.detail === 'recognizing' && ui.recognitionStatus === 'uploading') {
    setRecognitionStatus('recognizing', { slow: false, statusTextIndex: 0 });
  }
});

async function renderRoute() {
  if (ui.booting) return;
  if (listScrollHandler) {
    window.removeEventListener('scroll', listScrollHandler);
    listScrollHandler = null;
  }
  const route = parseRoute();
  if (route.name === 'add') await renderAddPage();
  else if (route.name === 'edit') await renderEditPage(route.id);
  else await renderListPage();
}

window.addEventListener('hashchange', () => {
  const direction = parseRoute().name === 'list' ? 'back' : 'forward';
  void transitionRoute(location.hash, direction, false);
});
bootstrap();
