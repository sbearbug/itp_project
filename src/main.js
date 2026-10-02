import './style.css';
import './intro.css';
import emptyCalendarUrl from '../material/empty-calendar.svg?url';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { isNative } from './platform.js';
import { CalendarGrid, calendarDays, parseDateKey } from './CalendarGrid.js';
import { getTermSettings, loadTermSettings, saveTermSettings, termWeek } from './term.js';
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
let activeSettingsViewAnimation = null;
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
  settingsView: 'menu',
  monthExpanded: false,
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: null
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

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 滑块位移：3 列 + 4px 间隙，列间距换算成滑块自身宽度就是 100% + 4px
function modeThumbTransform(index) {
  return `translateX(calc(${index} * (100% + 4px)))`;
}

// 设置弹层内部的视图切换（菜单 ↔ 外观 / 识别接口）。
// 时长与方向和页面路由保持一致：进入从右侧滑入，返回先向右滑出再淡入，
// 让“进入和退出沿同一路径”的规则在弹层里同样成立。
async function animateSettingsView(element, target, duration, easingName) {
  if (!element) return;
  const computed = getComputedStyle(element);
  const from = {
    transform: computed.transform === 'none' ? 'translateX(0)' : computed.transform,
    opacity: computed.opacity
  };
  const animation = element.animate([from, target], {
    duration,
    easing: motionEasing(easingName),
    fill: 'forwards'
  });
  activeSettingsViewAnimation = { animation, element };
  try {
    await animation.finished;
  } catch {
    return;
  }
  if (activeSettingsViewAnimation?.animation !== animation) return;
  activeSettingsViewAnimation = null;
  animation.cancel();
  element.style.transform = target.transform || '';
  element.style.opacity = target.opacity ?? '';
}

// 模式选择是“同一控件内的状态变化”，不能整块重绘：重绘会让滑块瞬移。
// 另外 transform 必须直接写在滑块的行内样式上：只改它引用的自定义属性
// 不会触发 CSS 过渡（浏览器不把 var 代入结果的变化当作可过渡变化），滑块会瞬移。
function applyModeSelection(mode) {
  const group = settingsRoot?.querySelector('.appearance-mode');
  if (!group) return;
  const thumb = group.querySelector('.appearance-mode__thumb');
  if (thumb) thumb.style.transform = modeThumbTransform(Math.max(0, APPEARANCE_MODES.indexOf(mode)));
  group.querySelectorAll('[data-appearance-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.appearanceMode === mode));
  });
}

function applyThemeSelection(theme) {
  settingsRoot?.querySelectorAll('[data-selected-theme]').forEach((button) => {
    const selected = button.dataset.selectedTheme === theme;
    button.setAttribute('aria-pressed', String(selected));
    const mark = button.querySelector('b');
    if (mark) mark.textContent = selected ? '✓' : '';
  });
}

async function renderSettingsDrawer({ transition = null } = {}) {
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
      <p>调整外观、识别接口或批量管理活动</p>
    </header>
    <div class="settings-menu">
      ${events.length ? `<button class="settings-menu-item" type="button" data-settings-action="manage">
        <span class="settings-menu-item__icon">☑</span>
        <span><b>${ui.selectionMode ? '完成管理' : '管理活动'}</b><small>${ui.selectionMode ? '退出批量选择' : '批量加入日历或删除'}</small></span>
        <i>›</i>
      </button>` : ''}
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
      <button class="settings-menu-item" type="button" data-settings-view="term">
        <span class="settings-menu-item__icon">▦</span>
        <span><b>学期设置</b><small>${escapeHtml(getTermSettings().name)} · ${escapeHtml(getTermSettings().start)}</small></span><i>›</i>
      </button>
    </div>`;

  const appearanceMarkup = `${backHeader('外观', '主题会立即应用并保存在当前设备')}
    <section class="appearance-section">
      <h3>模式</h3>
      <div class="appearance-mode" role="group" aria-label="模式">
        <span class="appearance-mode__thumb" aria-hidden="true" style="transform:${modeThumbTransform(Math.max(0, APPEARANCE_MODES.indexOf(appearance.mode)))}"></span>
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

  const term = getTermSettings();
  const termMarkup = `${backHeader('学期设置', '修改后重新计算教学周')}
    <form class="settings-form" id="term-settings-form">
      <label class="settings-field"><span>学期名称</span><input name="name" value="${escapeHtml(term.name)}" maxlength="24" required></label>
      <label class="settings-field"><span>开学日期</span><input name="start" type="date" value="${term.start}" required></label>
      <p class="settings-note">教学周期为 ${TERM_CONFIG.totalWeeks} 周，学期外不显示教学周。</p>
      <button class="button button--primary" type="submit">保存学期</button>
    </form>`;
  const content = ui.settingsView === 'term' ? termMarkup : ui.settingsView === 'appearance'
    ? appearanceMarkup
    : ui.settingsView === 'api'
      ? apiMarkup
      : menuMarkup;

  // 返回时先让当前视图向右滑出，再重建内容；这与页面返回的顺序一致。
  const outgoing = transition === 'back' && !prefersReducedMotion()
    ? settingsRoot?.querySelector('.settings-view')
    : null;
  activeSettingsViewAnimation?.animation.cancel();
  activeSettingsViewAnimation = null;
  if (outgoing) {
    await animateSettingsView(outgoing, { transform: 'translateX(34px)', opacity: 0 }, 340);
  }

  settingsRoot.innerHTML = `<div class="settings-scrim" data-settings-close></div>
    <aside class="settings-drawer" aria-label="设置" aria-hidden="${!ui.settingsOpen}">
      <div class="settings-drawer__handle"></div>
      <div class="settings-view">${content}</div>
    </aside>`;

  settingsRoot.querySelector('[data-settings-close]').addEventListener('click', closeSettingsDrawer);
  settingsRoot.querySelectorAll('[data-settings-action]').forEach((button) => button.addEventListener('click', async () => {
    if (button.dataset.settingsAction !== 'manage') return;
    // 先收起菜单再切换管理模式，避免两次重绘打架
    await closeSettingsDrawer();
    await toggleSelectionMode();
  }));
  settingsRoot.querySelectorAll('[data-settings-view]').forEach((button) => button.addEventListener('click', async () => {
    const nextView = button.dataset.settingsView;
    if (nextView === ui.settingsView) return;
    ui.settingsView = nextView;
    await renderSettingsDrawer({ transition: nextView === 'menu' ? 'back' : 'forward' });
  }));
  settingsRoot.querySelectorAll('[data-appearance-mode]').forEach((button) => button.addEventListener('click', async () => {
    const mode = button.dataset.appearanceMode;
    await setAppearanceMode(mode);
    // 就地更新，不重绘，滑块才能从旧位置滑过去
    applyModeSelection(mode);
  }));
  settingsRoot.querySelectorAll('[data-selected-theme]').forEach((button) => button.addEventListener('click', async () => {
    const theme = button.dataset.selectedTheme;
    await setSelectedTheme(theme);
    applyThemeSelection(theme);
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
  settingsRoot.querySelector('#term-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
    try {
      await saveTermSettings({ name: String(data.get('name')), start: String(data.get('start')) });
      await closeSettingsDrawer();
      if (parseRoute().name === 'list') await renderListPage();
      showToast('学期设置已保存');
    } catch (error) {
      button.disabled = false;
      await showNotice(error.message || '保存失败，请重试');
    }
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

  // 监听器绑定完再播入场动画，动画期间仍然可以点击
  const view = settingsRoot.querySelector('.settings-view');
  if (transition === 'forward' && view && !prefersReducedMotion()) {
    view.style.transform = 'translateX(34px)';
    view.style.opacity = '0.72';
    await animateSettingsView(view, { transform: 'translateX(0)', opacity: 1 }, 380);
  } else if (transition === 'back' && view && !prefersReducedMotion()) {
    view.style.opacity = '0';
    await animateSettingsView(view, { transform: 'translateX(0)', opacity: 1 }, 300, '--motion-direct');
  }
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

// 按下反馈的唯一入口：指针与键盘共用一套状态。
// - 卡片类（活动卡片 / 今日台历 / 主题色块）加 .is-pressed 后由 CSS 做缩放回弹；
// - 其余可点元素加同一个类后由 CSS 铺状态底色。
const PRESS_CARD_SELECTOR = '.event-card, .today-calendar__summary, .theme-option';
const PRESS_BACKGROUND_SELECTOR = 'button:not(:disabled), [role="button"]';
// 列表里的卡片在按下约 60ms 后才进入按下态；这段时间内一旦开始滚动就整轮放弃，
// 避免滑动列表时卡片闪一下。
const PRESS_DELAYED_SELECTOR = '.event-card';
const PRESS_DELAY = 60;
const PRESS_SCROLL_TOLERANCE = 8;
// 必须与 style.css 里 .is-pressed 的 scale 过渡时长一致（90ms ease-out）。
// 卡片在指针抬起时会先补足这段时长再回弹，所以无论点按多快，下压深度都一致。
const PRESS_DEPTH_DURATION = 90;
// 再多留约一帧：如果取消按下态的时刻正好等于过渡结束时刻，“触底”那一帧可能
// 落在两次渲染之间而永远看不到，深度就会随帧率轻微漂移。
const PRESS_DEPTH_HOLD = PRESS_DEPTH_DURATION + 16;

function pressTargetFor(node) {
  if (!(node instanceof Element)) return null;
  // 优先命中最近的控件，不能让台历父容器吞掉内部按钮的反馈。
  return node.closest(`${PRESS_CARD_SELECTOR}, ${PRESS_BACKGROUND_SELECTOR}`);
}

function setupPressFeedback() {
  if (pressFeedbackInstalled) return;
  pressFeedbackInstalled = true;
  let active = null;
  // 卡片为了凑满下压深度而推迟的“松开”动作
  let pendingRelease = null;

  const cancelDelay = (state) => {
    if (state.delayTimer === null) return;
    window.clearTimeout(state.delayTimer);
    state.delayTimer = null;
  };

  // 立即撤销按压视觉：取消、失焦，以及已经压满深度的正常释放
  const dropPress = (state) => {
    if (!state) return;
    cancelDelay(state);
    state.element.classList.remove('is-pressed');
  };

  const flushPendingRelease = () => {
    if (!pendingRelease) return;
    window.clearTimeout(pendingRelease.timer);
    pendingRelease.element.classList.remove('is-pressed');
    pendingRelease = null;
  };

  const showPress = (state) => {
    if (active !== state || state.pressed) return;
    state.pressed = true;
    state.pressStartedAt = performance.now();
    state.element.classList.add('is-pressed');
  };

  const abortPress = () => {
    const state = active;
    active = null;
    dropPress(state);
  };

  // 点按结束。卡片先补足 PRESS_DEPTH_DURATION：即使几十毫秒就抬手，
  // 也会先压到 0.965 再走 420ms 回弹，保证每次动画深度相同。
  const endPress = () => {
    const state = active;
    active = null;
    if (!state) return;
    cancelDelay(state);
    if (!state.card || state.abandoned) {
      dropPress(state);
      return;
    }
    if (!state.pressed) {
      state.pressed = true;
      state.pressStartedAt = performance.now();
      state.element.classList.add('is-pressed');
    }
    const remaining = PRESS_DEPTH_HOLD - (performance.now() - state.pressStartedAt);
    if (remaining <= 0) {
      dropPress(state);
      return;
    }
    pendingRelease = {
      element: state.element,
      timer: window.setTimeout(() => {
        pendingRelease = null;
        state.element.classList.remove('is-pressed');
      }, remaining)
    };
  };

  const isInside = (element, x, y) => {
    const bounds = element.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  };

  document.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button > 0) return;
    const element = pressTargetFor(event.target);
    if (!element) return;
    abortPress();
    flushPendingRelease();
    const state = {
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pressed: false,
      pressStartedAt: 0,
      abandoned: false,
      keyboard: false,
      card: element.matches(PRESS_CARD_SELECTOR),
      delayed: element.matches(PRESS_DELAYED_SELECTOR),
      delayTimer: null
    };
    active = state;
    if (state.delayed) state.delayTimer = window.setTimeout(() => showPress(state), PRESS_DELAY);
    else showPress(state);
  }, true);

  document.addEventListener('pointermove', (event) => {
    const state = active;
    if (!state || state.keyboard || state.abandoned || event.pointerId !== state.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    // 卡片：按下过程中只要开始滚动，本轮就彻底不再显示按下效果
    if (state.delayed && Math.hypot(dx, dy) > PRESS_SCROLL_TOLERANCE) {
      state.abandoned = true;
      active = null;
      dropPress(state);
      return;
    }
    if (state.delayed) return;
    // 其余元素：移出撤销、移回恢复
    state.element.classList.toggle('is-pressed', isInside(state.element, event.clientX, event.clientY));
  }, true);

  document.addEventListener('pointerup', endPress, true);
  document.addEventListener('pointercancel', abortPress, true);
  document.addEventListener('pointerleave', (event) => {
    const state = active;
    if (!state || state.keyboard || state.abandoned || event.target !== state.element) return;
    if (state.delayed) {
      state.abandoned = true;
      active = null;
      dropPress(state);
      return;
    }
    state.element.classList.remove('is-pressed');
  }, true);

  const isActivationKey = (event) => event.key === ' ' || event.key === 'Enter';

  document.addEventListener('keydown', (event) => {
    if (!isActivationKey(event) || event.repeat) return;
    const element = pressTargetFor(event.target);
    if (!element) return;
    abortPress();
    flushPendingRelease();
    active = {
      element,
      pointerId: null,
      startX: 0,
      startY: 0,
      pressed: true,
      pressStartedAt: performance.now(),
      abandoned: false,
      keyboard: true,
      card: element.matches(PRESS_CARD_SELECTOR),
      delayed: false,
      delayTimer: null
    };
    element.classList.add('is-pressed');
  }, true);

  document.addEventListener('keyup', (event) => {
    if (!isActivationKey(event)) return;
    const state = active;
    if (!state?.keyboard || event.target !== state.element) return;
    endPress();
  }, true);

  document.addEventListener('focusout', (event) => {
    if (!active?.keyboard || event.target !== active.element) return;
    abortPress();
  }, true);

  window.addEventListener('blur', () => {
    flushPendingRelease();
    abortPress();
  });
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
    return !target.closest('.app-dialog, .settings-drawer, .event-card-row--open, .month-calendar');
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
    Promise.all([loadEvents(), loadPendingEvents(), loadTermSettings()]),
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

async function animatePage(page, target, { duration = 360, easing = motionEasing() } = {}) {
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
    }, { duration: 340 });
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
    await animatePage(nextPage, { transform: 'translateX(0)', opacity: 1 }, { duration: 380 });
  } else {
    nextPage.style.transform = 'translateX(0)';
    nextPage.style.opacity = '0';
    await animatePage(nextPage, { transform: 'translateX(0)', opacity: 1 }, {
      duration: 300,
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
  if (ui.selectedDate) {
    ui.selectedDate = null;
    await renderListPage();
    return;
  }
  if (ui.monthExpanded) {
    setMonthExpanded(false);
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

// 调用方必须把它放在 <main class="page"> 之外：.toast 是 position: fixed，而 .page 的
// will-change: transform 会为 fixed 后代创建包含块，导致它相对整页定位。
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

function eventDateParts(event, now = new Date()) {
  if (!event.start) return { month: '日期', day: '—', weekday: '待定' };
  const date = new Date(event.start);
  if (Number.isNaN(date.getTime())) return { month: '日期', day: '—', weekday: '待定' };
  return {
    // 年份只在不是今年时出现，所有活动用同一套规则
    month: date.getFullYear() === now.getFullYear()
      ? `${date.getMonth() + 1}月`
      : `${date.getFullYear()}年${date.getMonth() + 1}月`,
    day: String(date.getDate()).padStart(2, '0'),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  };
}

// 活动跨度的本地起止“日”。缺结束时间时按开始日算，两者都无效时返回 null。
// 日期的取值与比较一律走 localDateKey，不使用 toISOString 等 UTC 方法。
function eventDayRange(event) {
  const rawStart = event.start ? new Date(event.start) : null;
  const start = rawStart && !Number.isNaN(rawStart.getTime()) ? rawStart : null;
  const rawEnd = event.end ? new Date(event.end) : null;
  const end = rawEnd && !Number.isNaN(rawEnd.getTime()) ? rawEnd : null;
  if (!start && !end) return null;
  const startDay = startOfLocalDay(start || end);
  const endDay = startOfLocalDay(end || start);
  return endDay < startDay ? { start: startDay, end: startDay } : { start: startDay, end: endDay };
}

function isMultiDay(event) {
  const range = eventDayRange(event);
  return !!range && localDateKey(range.start) !== localDateKey(range.end);
}

// 跨天活动且今天落在区间内时，在状态胶囊前提示进度。
function ongoingBadge(event, now = new Date()) {
  const range = eventDayRange(event);
  if (!range || !isMultiDay(event)) return '';
  const todayKey = localDateKey(now);
  if (localDateKey(range.start) > todayKey || localDateKey(range.end) < todayKey) return '';
  const remaining = Math.round((range.end.getTime() - startOfLocalDay(now).getTime()) / 86400000);
  return remaining <= 0
    ? '<span class="ongoing-badge ongoing-badge--last">今天结束</span>'
    : `<span class="ongoing-badge">进行中 · 还剩${remaining}天</span>`;
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(date, now = new Date(), forceYear = false) {
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  return forceYear || date.getFullYear() !== now.getFullYear()
    ? `${date.getFullYear()}年${base}`
    : base;
}

// 卡片右侧第二行：单日活动给“时间 · 地点”，跨天活动给“日期区间 · 地点”。
// 没有地点时只留前半段，没有时间时用“时间待定”。
function cardScheduleText(event, now = new Date()) {
  const range = eventDayRange(event);
  let primary;
  if (range && isMultiDay(event)) {
    // 跨年区间两端都带年份，否则“12月30日–1月2日”看不出跨了年
    const crossYear = range.start.getFullYear() !== range.end.getFullYear();
    primary = `${formatDayLabel(range.start, now, crossYear)}–${formatDayLabel(range.end, now, crossYear)}`;
  } else if (!event.start) {
    primary = '时间待定';
  } else if (event.allDay) {
    primary = '全天';
  } else {
    primary = formatClock(event.start) || '时间待定';
  }
  const location = String(event.location || '').trim();
  return location ? `${primary} · ${location}` : primary;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function termWeekNumber(date = new Date()) {
  return termWeek(date);
}

function todayCalendarMarkup(now = new Date()) {
  const week = termWeekNumber(now);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now);
  return `<section class="today-calendar ${ui.monthExpanded ? 'today-calendar--expanded' : ''}" aria-label="今天">
    <div class="today-calendar__summary" id="today-calendar-toggle" role="button" tabindex="0" aria-expanded="${ui.monthExpanded}" aria-label="${ui.monthExpanded ? '收起月历' : '展开月历'}">
    <span class="today-calendar__binding" aria-hidden="true"><i></i><i></i></span>
    <div class="today-calendar__date">
      <span>今天</span>
      <strong>${String(now.getDate()).padStart(2, '0')}</strong>
    </div>
    <div class="today-calendar__detail">
      <b>${now.getMonth() + 1}月 · ${weekday}</b>
      ${week ? `<button type="button" class="term-week-button" id="term-week-button">${escapeHtml(getTermSettings().name)}第${week}周</button>` : ''}
    </div>
    </div>
    <div class="month-calendar-wrap ${ui.monthExpanded ? 'is-open' : ''}" id="month-calendar-wrap" aria-hidden="${!ui.monthExpanded}" ${ui.monthExpanded ? '' : 'inert'}><div class="month-calendar-inner"><div class="month-calendar" id="month-calendar">${monthCalendarMarkup(now)}</div></div></div>
  </section>`;
}

function eventsOnDate(key) {
  return events.filter((event) => {
    const range = eventDayRange(event);
    return range && localDateKey(range.start) <= key && localDateKey(range.end) >= key;
  }).sort(sortByStart);
}

function createCalendarGrid(now = new Date()) {
  const marks = {};
  for (const date of calendarDays(ui.calendarMonth)) {
    const key = localDateKey(date);
    const overlapping = eventsOnDate(key);
    if (overlapping.length) marks[key] = overlapping.some((event) => isUrgentDeadline(event, now)) ? 'urgent' : 'activity';
    if (events.some((event) => isUrgentDeadline(event, now)
      && localDateKey(new Date(event.deadline)) === key)) marks[key] = 'urgent';
  }
  return new CalendarGrid({ month: ui.calendarMonth, today: now, selected: ui.selectedDate, marks,
    onSelect: (key) => { ui.selectedDate = key; void renderListPage(); } });
}

function monthCalendarMarkup(now = new Date()) {
  const month = ui.calendarMonth;
  const current = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  return `<div class="month-calendar__toolbar">
    <button class="icon-button" type="button" data-month-shift="-1" aria-label="上个月">‹</button>
    <button class="month-calendar__title" type="button" id="month-collapse">${month.getFullYear()}年${month.getMonth() + 1}月</button>
    ${current ? '' : '<button class="month-calendar__today" type="button" id="month-today">今天</button>'}
    <button class="icon-button" type="button" data-month-shift="1" aria-label="下个月">›</button>
  </div>${createCalendarGrid(now).markup()}`;
}

function setMonthExpanded(expanded) {
  ui.monthExpanded = expanded;
  document.querySelector('.today-calendar')?.classList.toggle('today-calendar--expanded', expanded);
  document.querySelector('#month-calendar-wrap')?.classList.toggle('is-open', expanded);
  const wrap = document.querySelector('#month-calendar-wrap');
  wrap?.setAttribute('aria-hidden', String(!expanded));
  wrap?.toggleAttribute('inert', !expanded);
  const toggle = document.querySelector('#today-calendar-toggle');
  toggle?.setAttribute('aria-expanded', String(expanded));
  toggle?.setAttribute('aria-label', expanded ? '收起月历' : '展开月历');
}

function changeCalendarMonth(delta, today = false) {
  const now = new Date();
  ui.calendarMonth = today ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(ui.calendarMonth.getFullYear(), ui.calendarMonth.getMonth() + delta, 1);
  const root = document.querySelector('#month-calendar');
  if (!root) return;
  root.innerHTML = monthCalendarMarkup(now);
  bindMonthCalendar();
}

function bindMonthCalendar() {
  const root = document.querySelector('#month-calendar');
  if (!root) return;
  createCalendarGrid().bind(root);
  root.querySelectorAll('[data-month-shift]').forEach((button) => button.addEventListener('click', () => changeCalendarMonth(Number(button.dataset.monthShift))));
  root.querySelector('#month-today')?.addEventListener('click', () => changeCalendarMonth(0, true));
  root.querySelector('#month-collapse')?.addEventListener('click', () => setMonthExpanded(false));
  let gesture = null;
  // 属性监听器会覆盖旧视图的手势；月份重绘不会叠加监听器。
  root.onpointerdown = (event) => {
    if (!event.isPrimary || event.button > 0 || event.clientX <= 24 || event.clientX >= innerWidth - 24) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      inGrid: Boolean(event.target.closest('.calendar-grid')), moved: false };
  };
  root.onpointermove = (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 9) {
      gesture.moved = true;
      capturePointer(root, event.pointerId);
      if (event.cancelable) event.preventDefault();
    }
  };
  root.onpointerup = (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const current = gesture;
    gesture = null;
    releasePointer(root, event.pointerId);
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.moved) root.dataset.ignoreClickUntil = String(performance.now() + 350);
    if (current.inGrid && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      changeCalendarMonth(dx < 0 ? 1 : -1);
    } else if (dy < -45 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      setMonthExpanded(false);
    }
  };
  root.onpointercancel = () => { gesture = null; };
  if (!root.dataset.gestureInstalled) {
    root.dataset.gestureInstalled = 'true';
    root.addEventListener('click', (event) => {
      if (performance.now() < Number(root.dataset.ignoreClickUntil || 0)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  }
}

function bindTodayCalendar() {
  const toggle = document.querySelector('#today-calendar-toggle');
  toggle?.addEventListener('click', () => setMonthExpanded(!ui.monthExpanded));
  toggle?.addEventListener('keydown', (event) => {
    if (event.target !== toggle || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); setMonthExpanded(!ui.monthExpanded);
  });
  document.querySelector('#term-week-button')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!await prepareSettingsDrawer(0)) return;
    ui.settingsView = 'term';
    await renderSettingsDrawer();
    await animateSettingsProgress(1);
  });
  bindMonthCalendar();
}

function groupUpcomingEvents(items, now = new Date()) {
  const todayKey = localDateKey(now);
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = localDateKey(tomorrow);
  const weekEnd = new Date(today);
  const mondayIndex = (today.getDay() + 6) % 7;
  weekEnd.setDate(weekEnd.getDate() + (7 - mondayIndex));
  const weekEndKey = localDateKey(weekEnd);
  const groups = [
    { label: '今天', events: [] },
    { label: '明天', events: [] },
    { label: '本周', events: [] },
    { label: '以后', events: [] }
  ];
  for (const event of items) {
    const range = eventDayRange(event);
    // 没有可用日期的活动归入“以后”
    if (!range) {
      groups[3].events.push(event);
      continue;
    }
    const startKey = localDateKey(range.start);
    const endKey = localDateKey(range.end);
    // 已结束的由调用方单独筛出；这里按“今天是否落在区间内”归组
    if (startKey <= todayKey && todayKey <= endKey) groups[0].events.push(event);
    else if (startKey === tomorrowKey) groups[1].events.push(event);
    else if (startKey <= weekEndKey) groups[2].events.push(event);
    else groups[3].events.push(event);
  }
  return groups.filter((group) => group.events.length);
}

function activityGroupsMarkup(items, now) {
  return groupUpcomingEvents(items, now).map((group) => `<section class="activity-group">
    <h2 class="activity-group__title">${group.label}</h2>
    <div class="event-list">${group.events.map((event) => listCard(event)).join('')}</div>
  </section>`).join('');
}

// “已结束”只看日期的先后：结束日早于今天才算结束。
// 只有日期没有时间的单日活动，因此会在当天 23:59 之后自然落入“已结束”。
function isEnded(event, now = new Date()) {
  const range = eventDayRange(event);
  if (!range) return false;
  return localDateKey(range.end) < localDateKey(now);
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
      <span class="event-card__meta">${escapeHtml(cardScheduleText(event))}</span>
      <span class="event-card__status-row">
        <span class="event-category">${categoryOf(event)}</span>
        ${ongoingBadge(event)}
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

// “管理”现在放在右上角 ⋮ 菜单里，进入与退出走同一个入口。
async function toggleSelectionMode() {
  await wait(90);
  if (ui.selectionMode) {
    await exitSelectionMode();
    return;
  }
  ui.selectionMode = true;
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

// 系统日历有可能以半透明 Activity 盖在本应用之上，此时我们的 Activity 只会 onPause、
// 不会 onStop，而 Capacitor 仅在 onStop 时才发 appStateChange(isActive:false)。
// 只靠那个事件会让 leftApp 一直为 false，等待永远不结束，按钮就卡在“打开中”。
// 这里改用会在 onPause 触发的 pause / resume 事件判断返回，并保留 appStateChange 兜底；
// 再加一个宽限期，防止漏掉 pause 时彻底卡死。
const APP_RETURN_GRACE = 800;
const APP_RETURN_TIMEOUT = 5 * 60 * 1000;

async function createAppReturnWaiter() {
  let leftApp = false;
  let resolved = false;
  let resolveWait;
  const startedAt = performance.now();
  const promise = new Promise((resolve) => { resolveWait = resolve; });
  const handles = [];
  let timeout = null;

  const finish = () => {
    if (resolved) return;
    resolved = true;
    window.clearTimeout(timeout);
    handles.forEach((handle) => void handle.remove());
    resolveWait();
  };
  const markLeft = () => { leftApp = true; };
  const markReturned = () => {
    if (leftApp || performance.now() - startedAt >= APP_RETURN_GRACE) finish();
  };

  handles.push(await CapacitorApp.addListener('pause', markLeft));
  handles.push(await CapacitorApp.addListener('resume', markReturned));
  handles.push(await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) markReturned();
    else markLeft();
  }));
  timeout = window.setTimeout(finish, APP_RETURN_TIMEOUT);
  return { promise, cancel: finish };
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
  const filtered = ui.selectedDate ? eventsOnDate(ui.selectedDate) : null;
  ui.fabHidden = false;
  ui.openSwipeId = null;
  ui.selectedEventIds = new Set([...ui.selectedEventIds].filter((id) => events.some((event) => event.id === id)));

  // .fab / .bulk-toolbar / #toast-root 都是 position: fixed，必须渲染在 .page 之外。
  // .page 带 will-change: transform，会为 fixed 后代创建包含块，使它们相对整页而不是
  // 视口定位——列表一长，加号就落到文档底部，看起来像凭空消失。
  app.innerHTML = `<main class="${pageClass(`list-page ${ui.selectionMode ? 'list-page--manage' : ''} ${ui.selectedDate ? 'list-page--date-filtered' : ''}`)}">
    <header class="compact-header">
      <h1>活动<span class="compact-header__count">${events.length} 项</span></h1>
      <div class="compact-header__actions">
        <button class="icon-button app-bar-action" id="settings-button" type="button" aria-label="打开菜单">⋮</button>
      </div>
    </header>

    ${todayCalendarMarkup(now)}

    ${pendingEvents.length ? `<button class="pending-resume" id="resume-pending">
      <span>有 ${pendingEvents.length} 个活动等待确认</span><b>继续 →</b>
    </button>` : ''}

    <section class="activity-list ${ui.selectedDate ? 'activity-list--filtered' : ''}">
      ${filtered ? `<button class="date-filter" id="clear-date-filter" type="button">${formatDayLabel(parseDateKey(ui.selectedDate), now)} · 清除</button>
        ${filtered.length ? `<div class="event-list">${filtered.map((event) => listCard(event)).join('')}</div>` : '<div class="empty-state"><p>这天没有活动</p></div>'}` : upcoming.length
        ? activityGroupsMarkup(upcoming, now)
        : `<div class="empty-state empty-state--list">
            <img src="${emptyCalendarUrl}" alt="空白台历页">
            <p>还没有活动，点右下角的加号，添加一张通知截图</p>
          </div>`}
    </section>

    ${!filtered && ended.length ? `<section class="ended-group">
      <button class="ended-summary" id="ended-toggle" type="button" aria-expanded="${ui.endedExpanded}">
        <span>已结束</span><span class="ended-summary__right"><b>${ended.length}</b><i aria-hidden="true">${ui.endedExpanded ? '−' : '+'}</i></span>
      </button>
      <div class="ended-list-wrap ${ui.endedExpanded ? 'is-open' : ''}" id="ended-list-wrap">
        <div class="ended-list-inner"><div class="event-list">${ended.map((event, index) => listCard(event, true, index)).join('')}</div></div>
      </div>
    </section>` : ''}
  </main>
  ${ui.selectionMode ? `<div class="bulk-toolbar">
    <span id="selection-count">已选择 ${ui.selectedEventIds.size} 项</span>
    <button class="button button--secondary" id="cancel-selection" type="button">取消</button>
    <button class="button button--calendar-compact" id="bulk-calendar-button" type="button" ${ui.selectedEventIds.size ? '' : 'disabled'}>加入日历</button>
    <button class="button button--danger" id="bulk-delete-button" type="button" ${ui.selectedEventIds.size ? '' : 'disabled'}>删除所选</button>
  </div>` : '<button class="fab" id="add-button" aria-label="添加活动">＋</button>'}
  ${toastMarkup()}`;

  document.querySelector('#add-button')?.addEventListener('click', () => navigateTo('#/add'));
  document.querySelector('#settings-button')?.addEventListener('click', openSettingsDrawer);
  bindTodayCalendar();
  document.querySelector('#clear-date-filter')?.addEventListener('click', () => { ui.selectedDate = null; void renderListPage(); });
  document.querySelector('#ended-toggle')?.addEventListener('click', () => {
    ui.endedExpanded = !ui.endedExpanded;
    const button = document.querySelector('#ended-toggle');
    const wrap = document.querySelector('#ended-list-wrap');
    button?.setAttribute('aria-expanded', String(ui.endedExpanded));
    if (button?.querySelector('i')) button.querySelector('i').textContent = ui.endedExpanded ? '−' : '+';
    wrap?.classList.toggle('is-open', ui.endedExpanded);
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
      <span class="capture-button__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="3"></rect>
          <circle cx="8.5" cy="10" r="1.4"></circle>
          <path d="M20.6 15.4 15.8 10.6 6.4 20"></path>
        </svg>
      </span>
      <span><strong>选择通知截图</strong><small>支持海报、群聊和公众号截图</small></span>
    </label>
    <form class="text-extract-card" id="text-extract-form">
      <div class="text-extract-card__heading"><span class="text-preview-icon">文</span><div><strong>粘贴通知文字</strong><small>适合群消息、公众号正文或邮件</small></div></div>
      <textarea name="noticeText" maxlength="10000" placeholder="在这里粘贴活动通知内容…" aria-label="活动通知文字"></textarea>
      <button class="button button--extract" id="text-extract-button" type="submit" disabled>从文字提取</button>
    </form>
    <p>识别时，图片或文字会发送至智谱 AI，App 不会保存或上传到其他地方。</p>
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
  </main>
  ${toastMarkup()}`;

  // 顶部应用栏的返回与安卓返回键走同一个处理函数，保证行为一致
  // （识别中先确认、设置弹层与对话框优先关闭等）。
  document.querySelector('#back-button').addEventListener('click', handleBack);
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
  </main>
  ${toastMarkup()}`;
  document.querySelector('#back-button').addEventListener('click', handleBack);
  bindEventForm(event, { mode: 'edit' });
}

function bindImageInputs() {
  document.querySelectorAll('input[type="file"][data-image-input]').forEach((input) => {
    input.addEventListener('change', handleImage);
  });
}

const TEXTAREA_MAX_LINES = 8;

// 随内容自动增高，超过 maxLines 行后改为内部滚动（配合 CSS 的 resize: none）。
function autoGrowTextarea(textarea, maxLines = TEXTAREA_MAX_LINES) {
  if (!textarea) return;
  const styles = getComputedStyle(textarea);
  const fontSize = parseFloat(styles.fontSize) || 16;
  const lineHeight = parseFloat(styles.lineHeight) || fontSize * 1.6;
  const padding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  const border = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
  const maxHeight = lineHeight * maxLines + padding + border;
  textarea.style.height = 'auto';
  const needed = textarea.scrollHeight + border;
  textarea.style.height = `${Math.min(needed, maxHeight)}px`;
  textarea.style.overflowY = needed > maxHeight ? 'auto' : 'hidden';
}

function bindTextInput() {
  const form = document.querySelector('#text-extract-form');
  if (!form) return;
  const textarea = form.querySelector('textarea');
  const submitButton = form.querySelector('#text-extract-button');
  const syncSubmit = () => {
    if (submitButton) submitButton.disabled = textarea.value.trim().length === 0;
    autoGrowTextarea(textarea);
  };
  textarea.addEventListener('input', syncSubmit);
  syncSubmit();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('noticeText') || '').trim();
    if (!text) {
      textarea.focus();
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
