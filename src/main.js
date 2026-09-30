import './style.css';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform.js';
import { extractEvents, compressImage } from './extract.js';
import { addToCalendar } from './calendar.js';
import {
  API_BASE,
  MODEL,
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
const FULL_LAUNCH_DATE_KEY = 'full_launch_animation_date';
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

const ui = {
  booting: true,
  pageAnimation: 'page--fade-in',
  recognitionStatus: 'idle',
  errorStage: null,
  error: '',
  slow: false,
  statusTextIndex: 0,
  selectedFile: null,
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
  openSwipeId: null,
  endedExpanded: false,
  settingsOpen: false
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
      }, 180);
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
      <h2 id="api-key-dialog-title">配置识别 API</h2>
      <p>API Key 只会发送给本机服务器，并保存在当前文件夹的 <code>config.json</code> 中，不会写入网页代码。</p>
      <label class="settings-field"><span>DEEPSEEK API KEY</span>
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
      }, 180);
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
        errorRoot.textContent = '请填写 API Key';
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
  if (!settingsRoot) {
    settingsRoot = document.createElement('div');
    settingsRoot.id = 'settings-root';
    document.body.appendChild(settingsRoot);
  }
  settingsRoot.innerHTML = `<div class="settings-scrim" data-settings-close></div>
    <aside class="settings-drawer" aria-label="设置" aria-hidden="${!ui.settingsOpen}">
      <div class="settings-drawer__handle"></div>
      <header class="settings-header">
        <span>SETTINGS</span>
        <h2>识别设置</h2>
        <p>${native ? (custom ? '正在使用你的自定义 API' : '正在使用内置 Demo API') : (webConfigured ? 'API Key 已保存在本机' : '尚未配置 API Key')}</p>
      </header>
      ${native ? `<form class="settings-form" id="api-settings-form">
        <label class="settings-field"><span>API 地址</span>
          <input name="apiBase" type="url" inputmode="url" value="${escapeHtml(custom?.apiBase || API_BASE)}" autocomplete="off">
          <small>填写 OpenAI 兼容接口的基础地址</small>
        </label>
        <label class="settings-field"><span>模型名称</span>
          <input name="model" type="text" value="${escapeHtml(custom?.model || MODEL)}" autocomplete="off">
        </label>
        <label class="settings-field"><span>API Key</span>
          <input name="apiKey" type="password" value="${escapeHtml(custom?.apiKey || '')}" placeholder="输入你的 API Key" autocomplete="off">
          <small>仅保存在当前设备，保存后下次识别生效</small>
        </label>
        <div class="settings-actions">
          <button class="button button--secondary" id="default-api-button" type="button" ${custom ? '' : 'disabled'}>恢复内置</button>
          <button class="button button--primary" id="save-api-button" type="submit">保存设置</button>
        </div>
      </form>
      <p class="settings-note">自定义接口需要兼容 <code>/chat/completions</code>，并支持图片输入。</p>` : `<div class="settings-form">
        <p class="settings-note">API Key 由本地 Python 服务器保存，网页不会显示或读回已保存的 Key。</p>
        <button class="button button--primary" id="web-api-key-button" type="button">${webConfigured ? '更新 API Key' : '填写 API Key'}</button>
      </div>`}
    </aside>`;

  settingsRoot.querySelector('[data-settings-close]').addEventListener('click', closeSettingsDrawer);
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
      await showNotice('请输入完整有效的 API 地址，例如 https://api.example.com/v1。');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol) || !model || !apiKey) {
      await showNotice('API 地址、模型名称和 API Key 都需要填写完整。');
      return;
    }
    const button = settingsRoot.querySelector('#save-api-button');
    setActionBusy('api-saving', button, '保存中…');
    await saveCustomApiConfig({ apiBase, model, apiKey });
    ui.actionBusy = null;
    await renderSettingsDrawer();
    showToast('已使用自定义 API');
  });
  settingsRoot.querySelector('#default-api-button')?.addEventListener('click', async () => {
    await clearCustomApiConfig();
    await renderSettingsDrawer();
    showToast('已恢复内置 API');
  });
  settingsRoot.querySelector('#web-api-key-button')?.addEventListener('click', async () => {
    closeSettingsDrawer();
    if (await openWebApiKeyDialog()) {
      showToast('API Key 已保存');
    }
  });

  const drawer = settingsRoot.querySelector('.settings-drawer');
  let startX = 0;
  let startY = 0;
  drawer.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
  });
  drawer.addEventListener('pointerup', (event) => {
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) closeSettingsDrawer();
  });
}

async function openSettingsDrawer() {
  if (ui.settingsOpen || closeActiveDialog) return;
  ui.settingsOpen = true;
  await renderSettingsDrawer();
  requestAnimationFrame(() => document.body.classList.add('settings-open'));
}

function closeSettingsDrawer() {
  if (!ui.settingsOpen) return;
  ui.settingsOpen = false;
  document.body.classList.remove('settings-open');
  settingsRoot?.querySelector('.settings-drawer')?.setAttribute('aria-hidden', 'true');
}

function setupSettingsGesture() {
  if (settingsGestureInstalled) return;
  settingsGestureInstalled = true;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let suppressNextClick = false;

  const canStart = (target) => {
    if (ui.settingsOpen || closeActiveDialog) return false;
    if (!(target instanceof Element)) return true;
    return !target.closest('.app-dialog, .settings-drawer, .event-card-row--open');
  };

  const begin = (target, x, y) => {
    tracking = canStart(target);
    startX = x;
    startY = y;
  };

  const tryOpen = (x, y, event) => {
    if (!tracking || ui.settingsOpen) return;
    const deltaX = x - startX;
    const deltaY = y - startY;
    if (deltaX > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15 && event?.cancelable) {
      event.preventDefault();
    }
    if (deltaX < 58 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    tracking = false;
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 350);
    void openSettingsDrawer();
  };

  document.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (touch) begin(event.target, touch.clientX, touch.clientY);
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    const touch = event.touches[0];
    if (touch) tryOpen(touch.clientX, touch.clientY, event);
  }, { passive: false });
  document.addEventListener('touchend', () => { tracking = false; }, { passive: true });
  document.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') begin(event.target, event.clientX, event.clientY);
  });
  document.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'mouse') return;
    tryOpen(event.clientX, event.clientY, event);
    tracking = false;
  });
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

function calendarSuccessMessage() {
  return isNative() ? '已打开系统日历' : '已下载日历文件';
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

function launchMarkup() {
  return `<div class="launch-screen" id="launch-screen">
    <div class="launch-title">
      <div class="launch-kicker">CAMPUS ACTION</div>
      <div class="launch-line launch-line--one">把通知，</div>
      <div class="launch-line launch-line--two">变成行动<span class="launch-period">。</span></div>
    </div>
  </div>`;
}

function playLaunchAnimation(full) {
  return new Promise((resolve) => {
    const screen = document.querySelector('#launch-screen');
    if (!screen) {
      resolve();
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      screen.classList.add('launch-screen--skip');
      setTimeout(resolve, 160);
    };
    screen.classList.add(full ? 'launch-screen--full' : 'launch-screen--quick');
    screen.addEventListener('click', finish, { once: true });
    const timer = setTimeout(() => {
      finished = true;
      resolve();
    }, full ? 1500 : 500);
  });
}

async function bootstrap() {
  app.innerHTML = launchMarkup();
  if (isNative()) {
    void SplashScreen.hide({ fadeOutDuration: 0 });
  }

  const dataPromise = Promise.all([loadEvents(), loadPendingEvents()]);
  const today = localDateKey();
  const { value: lastFullDate } = await Preferences.get({ key: FULL_LAUNCH_DATE_KEY });
  const playFull = lastFullDate !== today;
  const animationPromise = playLaunchAnimation(playFull);
  if (playFull) {
    await Preferences.set({ key: FULL_LAUNCH_DATE_KEY, value: today });
  }

  [[events, pendingEvents]] = await Promise.all([dataPromise, animationPromise]);
  ui.activeDraftId = pendingEvents[0]?.id || null;
  ui.booting = false;
  if (!['#/list', '#/add'].includes(location.hash) && !location.hash.startsWith('#/edit/')) {
    history.replaceState(null, '', '#/list');
  } else if (!location.hash) {
    history.replaceState(null, '', '#/list');
  }
  ui.pageAnimation = 'page--fade-in';
  await renderRoute();
  await ensureWebApiKey();
  setupSettingsGesture();
  setupAndroidBackButton();
}

function pageClass(extra = '') {
  const animation = ui.pageAnimation;
  ui.pageAnimation = '';
  return `page ${animation} ${extra}`.trim();
}

function navigateTo(hash, animation = 'page--enter-right') {
  ui.pageAnimation = animation;
  if (location.hash === hash) {
    renderRoute();
  } else {
    location.hash = hash;
  }
}

async function navigateBackToList() {
  const page = document.querySelector('.page');
  page?.classList.add('page--exit-right');
  await wait(250);
  navigateTo('#/list', 'page--fade-in');
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
      if (!await confirmAction('当前图片仍在识别，返回后将终止本次识别。', { title: '放弃本次识别？', confirmLabel: '放弃', danger: true })) return;
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
    ui.selectionMode = false;
    ui.selectedEventIds.clear();
    await renderListPage();
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
  button.classList.add('is-loading');
  button.innerHTML = `<span class="button-spinner"></span>${escapeHtml(label)}`;
}

function clearActionBusy(button, label) {
  ui.actionBusy = null;
  if (!button) return;
  button.disabled = false;
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
  const cardAttribute = ui.selectionMode ? `data-select-id="${event.id}"` : `data-event-id="${event.id}"`;
  return `<div class="event-card-row ${ui.selectionMode ? 'event-card-row--selection' : ''} ${ended ? 'event-card-row--ended' : ''} ${ui.openSwipeId === event.id ? 'event-card-row--open' : ''}" data-row-id="${event.id}" ${ended ? `style="--ended-index:${endedIndex}"` : ''}>
  ${ui.selectionMode ? '' : `<div class="event-card-actions" aria-label="活动快捷操作">
    <button class="event-swipe-action event-swipe-action--calendar" type="button" data-calendar-id="${event.id}">加入日历</button>
    <button class="event-swipe-action event-swipe-action--delete" type="button" data-delete-id="${event.id}">删除</button>
  </div>`}
  <button class="event-card ${ended ? 'event-card--ended' : ''} ${isNew ? 'event-card--new' : ''} ${selected ? 'event-card--selected' : ''}" ${cardAttribute}>
    <span class="event-card__top">
      ${ui.selectionMode ? `<span class="selection-check" aria-hidden="true">${selected ? '✓' : ''}</span>` : ''}
      <span class="event-card__title">${escapeHtml(event.title || '未命名活动')}</span>
      <span class="pill pill--${event.status}">${statusLabel(event.status)}</span>
    </span>
    <span class="event-card__meta">${escapeHtml(formatDateTime(event.start, event.allDay))}</span>
    <span class="event-card__bottom">
      <span class="event-card__meta">${escapeHtml(event.location || '地点待确认')}</span>
      ${deadlineBadge(event)}
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

async function animateListDeletion(ids) {
  ids.forEach((id) => document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.classList.add('event-card-row--deleting'));
  await wait(260);
}

function closeOpenSwipeRow() {
  document.querySelector('.event-card-row--open')?.classList.remove('event-card-row--open');
  ui.openSwipeId = null;
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

    card.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary) return;
      startX = event.clientX;
      startY = event.clientY;
      startOffset = row.classList.contains('event-card-row--open') ? -revealWidth : 0;
      currentOffset = startOffset;
      dragging = false;
      card.setPointerCapture?.(event.pointerId);
    });

    card.addEventListener('pointermove', (event) => {
      if (!card.hasPointerCapture?.(event.pointerId)) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!dragging && Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        dragging = true;
        closeOpenSwipeRow();
        row.classList.add('event-card-row--dragging');
        card.classList.add('event-card--dragging');
      }
      if (!dragging) return;
      event.preventDefault();
      currentOffset = Math.max(-revealWidth, Math.min(0, startOffset + deltaX));
      card.style.transform = `translateX(${currentOffset}px)`;
    });

    const finishSwipe = (event) => {
      if (!dragging) return;
      card.releasePointerCapture?.(event.pointerId);
      row.classList.remove('event-card-row--dragging');
      card.classList.remove('event-card--dragging');
      card.style.transform = '';
      const shouldOpen = currentOffset < -revealWidth / 2;
      row.classList.toggle('event-card-row--open', shouldOpen);
      ui.openSwipeId = shouldOpen ? row.dataset.rowId : null;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      dragging = false;
    };
    card.addEventListener('pointerup', finishSwipe);
    card.addEventListener('pointercancel', finishSwipe);
    card.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (row.classList.contains('event-card-row--open')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOpenSwipeRow();
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

async function openSavedEventInCalendar(event, waitForReturn = false) {
  const waiter = waitForReturn && isNative() ? await createAppReturnWaiter() : null;
  try {
    await addToCalendar(event);
    await updateEvent(event.id, { status: 'registered' });
    if (waiter) await waiter.promise;
  } catch (error) {
    waiter?.cancel();
    throw error;
  }
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
      <h1>我的活动</h1>
      <div class="compact-header__actions">
        <span class="count-badge">${events.length}</span>
        ${events.length ? `<button class="manage-button" id="manage-button" type="button">${ui.selectionMode ? '完成' : '管理'}</button>` : ''}
      </div>
    </header>

    ${pendingEvents.length ? `<button class="pending-resume" id="resume-pending">
      <span>有 ${pendingEvents.length} 个活动等待确认</span><b>继续 →</b>
    </button>` : ''}

    <section class="activity-list">
      ${upcoming.length
        ? upcoming.map((event) => listCard(event)).join('')
        : `<div class="empty-state empty-state--list">
            <p>选择校园通知截图，确认信息后写入系统日历</p>
            <small>点击右下角的加号开始</small>
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
  document.querySelector('#ended-toggle')?.addEventListener('click', () => {
    ui.endedExpanded = !ui.endedExpanded;
    const button = document.querySelector('#ended-toggle');
    const wrap = document.querySelector('#ended-list-wrap');
    button?.setAttribute('aria-expanded', String(ui.endedExpanded));
    wrap?.classList.toggle('is-open', ui.endedExpanded);
  });
  document.querySelector('#manage-button')?.addEventListener('click', async () => {
    ui.selectionMode = !ui.selectionMode;
    ui.selectedEventIds.clear();
    await renderListPage();
  });
  document.querySelector('#cancel-selection')?.addEventListener('click', async () => {
    ui.selectionMode = false;
    ui.selectedEventIds.clear();
    await renderListPage();
  });
  document.querySelector('#resume-pending')?.addEventListener('click', () => {
    ui.activeDraftId = pendingEvents[0]?.id || null;
    navigateTo('#/add');
  });
  bindSwipeCards();
  document.querySelectorAll('[data-event-id]').forEach((card) => card.addEventListener('click', () => {
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
      ui.actionBusy = null;
      await renderListPage();
      showToast(calendarSuccessMessage());
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
    const calendarPrompt = isNative()
      ? `将依次打开 ${selected.length} 个活动的系统日历页面。每保存一条并返回后，会继续下一条。`
      : `将为选中的 ${selected.length} 个活动依次下载日历文件。如浏览器询问，请允许下载多个文件。`;
    if (!await confirmAction(calendarPrompt, { title: '批量加入日历？', confirmLabel: '开始' })) return;
    setActionBusy('calendar', document.querySelector('#bulk-calendar-button'), '处理中…');
    try {
      for (let index = 0; index < selected.length; index += 1) {
        await openSavedEventInCalendar(selected[index], index < selected.length - 1);
      }
      await refresh();
      ui.selectionMode = false;
      ui.selectedEventIds.clear();
      ui.actionBusy = null;
      await renderListPage();
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
    ui.selectionMode = false;
    ui.selectedEventIds.clear();
    ui.actionBusy = null;
    await renderListPage();
    showToast(`已删除 ${ids.length} 个活动`);
  });
  bindListScroll();
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
  const labels = ['压缩图片', '上传', '识别中', '完成'];
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
      ? '正在上传图片…'
      : STATUS_MESSAGES[ui.statusTextIndex];

  return `<section class="recognition-panel">
    <input id="replace-image-input" data-image-input class="visually-hidden" type="file" accept="image/*">
    <div class="preview-card">
      <img src="${escapeHtml(ui.previewUrl)}" alt="所选通知截图缩略图">
      <div><strong>${escapeHtml(ui.selectedFile?.name || '所选截图')}</strong><small>请确认截图内容正确</small></div>
      <label for="replace-image-input">更换</label>
    </div>
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

function selectImagePanel() {
  return `<section class="add-picker">
    <input id="add-image-input" data-image-input class="visually-hidden" type="file" accept="image/*">
    <label class="add-picker__button" for="add-image-input">
      <span class="capture-button__icon">＋</span>
      <span><strong>选择通知截图</strong><small>支持海报、群聊和公众号截图</small></span>
    </label>
    <p>图片只用于识别本次活动信息</p>
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
        await addToCalendar(saved);
        await updateEvent(event.id, { status: 'registered' });
        await refresh();
        ui.actionBusy = null;
        formError = '';
        showToast(calendarSuccessMessage());
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
          ? selectImagePanel()
          : recognitionPanel()}
    </div>
    ${toastMarkup()}
  </main>`;

  document.querySelector('#back-button').addEventListener('click', async () => {
    if (WORKING_STATES.includes(ui.recognitionStatus)) {
      if (!await confirmAction('当前图片仍在识别，返回后将终止本次识别。', { title: '放弃本次识别？', confirmLabel: '放弃', danger: true })) return;
      cancelRecognition();
    }
    await navigateBackToList();
  });
  bindImageInputs();
  document.querySelector('#cancel-recognition')?.addEventListener('click', cancelRecognition);
  document.querySelector('#retry-recognition')?.addEventListener('click', () => startRecognition(ui.selectedFile, false));
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
    ui.activeDraftId = drafts[0]?.id || null;
    setRecognitionStatus('done', {
      resultIds: drafts.map((event) => event.id),
      slow: false
    });
  } catch (error) {
    if (runId !== recognitionRunId || ui.recognitionStatus === 'error') return;
    setRecognitionStatus('error', {
      error: error.message || '识别失败，请重试',
      slow: false
    });
  }
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

window.addEventListener('hashchange', renderRoute);
bootstrap();
