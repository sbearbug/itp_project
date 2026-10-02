const stack = [];
let bodyStyle = null;
let scrollY = 0;
const isolated = new Map();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easing = () => getComputedStyle(document.documentElement).getPropertyValue('--motion-spring-soft').trim() || 'ease-out';
const clamp = (value) => Math.min(1, Math.max(0, value));

export const hasOpenOverlay = () => stack.length > 0;
export function dismissTopOverlay() {
  const top = stack.at(-1);
  if (!top) return false;
  void top.close(null);
  return true;
}

function isolate() {
  for (const [element, wasInert] of isolated) element.inert = wasInert;
  isolated.clear();
  const top = stack.at(-1);
  if (!top) return;
  for (const element of document.body.children) {
    if (element === top.overlay || element.tagName === 'SCRIPT') continue;
    isolated.set(element, element.inert);
    element.inert = true;
  }
}

function lockScroll() {
  if (bodyStyle !== null) return;
  scrollY = window.scrollY;
  bodyStyle = document.body.getAttribute('style');
  // 使用属性快照保留主题或调用方原有行内样式。
  if (bodyStyle === null) bodyStyle = '';
  Object.assign(document.body.style, { position: 'fixed', top: `${-scrollY}px`, width: '100%', overflow: 'hidden' });
}

function unlockScroll() {
  if (stack.length || bodyStyle === null) return;
  if (bodyStyle) document.body.setAttribute('style', bodyStyle);
  else document.body.removeAttribute('style');
  bodyStyle = null;
  window.scrollTo(0, scrollY);
}

class Overlay {
  constructor({ title = '', content = '', kind, trigger = document.activeElement, onClose = null }) {
    this.kind = kind;
    this.trigger = trigger;
    this.onClose = onClose;
    this.closed = false;
    this.closing = false;
    this.animations = [];
    this.result = new Promise((resolve) => { this.resolve = resolve; });
    this.overlay = document.createElement('div');
    this.overlay.className = `ui-overlay ui-overlay--${kind}`;
    this.panel = document.createElement('section');
    this.panel.className = `ui-modal ui-${kind}`;
    this.panel.tabIndex = -1;
    this.panel.setAttribute('role', kind === 'dialog' ? 'alertdialog' : 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', title || (kind === 'sheet' ? '设置' : '提示'));
    this.panel.innerHTML = `${kind === 'sheet' ? '<div class="ui-sheet__handle" aria-label="向下拖动关闭"><i></i></div>' : ''}<div class="ui-modal__content">${title ? `<h2 class="ui-modal__title"></h2>` : ''}${content}</div>`;
    if (title) this.panel.querySelector('.ui-modal__title').textContent = title;
    this.content = this.panel.querySelector('.ui-modal__content');
    this.overlay.appendChild(this.panel);
    this.onKey = (event) => {
      if (stack.at(-1) !== this) return;
      if (event.key === 'Escape') { event.preventDefault(); void this.close(null); }
      if (event.key === 'Tab') {
        const controls = this.focusable();
        const first = controls[0]; const last = controls.at(-1);
        if (!first) { event.preventDefault(); this.panel.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    this.overlay.addEventListener('click', (event) => {
      if (kind === 'sheet' && event.target === this.overlay) void this.close(null);
    });
  }

  focusable() {
    return [...this.panel.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter((element) => element.getClientRects().length && !element.closest('[inert]'));
  }

  show({ animate = true } = {}) {
    document.body.appendChild(this.overlay);
    lockScroll();
    stack.push(this);
    isolate();
    document.addEventListener('keydown', this.onKey);
    this.setProgress(animate ? 0 : 1);
    (this.focusable()[0] || this.panel).focus({ preventScroll: true });
    if (animate) void this.animateTo(1);
    return this;
  }

  progress() {
    if (this.kind !== 'sheet') return Number(getComputedStyle(this.panel).opacity);
    const height = Math.max(1, this.panel.getBoundingClientRect().height);
    const transform = getComputedStyle(this.panel).transform;
    return transform === 'none' ? 1 : clamp(1 - new DOMMatrixReadOnly(transform).m42 / height);
  }

  setProgress(value) {
    const progress = clamp(value);
    this.overlay.style.backgroundColor = ''; // 遮罩由 ::before 独立控制，不降低内容透明度。
    this.overlay.style.setProperty('--overlay-progress', String(progress));
    this.panel.style.transform = this.kind === 'sheet' ? `translateY(${(1 - progress) * 100}%)` : `translateY(${(1 - progress) * 16}px) scale(${.98 + progress * .02})`;
    this.panel.style.opacity = String(this.kind === 'sheet' ? 1 : progress);
  }

  cancelAnimation() {
    const progress = this.progress();
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.setProgress(progress);
    return progress;
  }

  async animateTo(target) {
    const start = this.cancelAnimation();
    if (reduced()) { this.setProgress(target); return true; }
    const from = { transform: this.panel.style.transform, opacity: this.panel.style.opacity };
    this.setProgress(target);
    const to = { transform: this.panel.style.transform, opacity: this.panel.style.opacity };
    const animation = this.panel.animate([from, to], { duration: 340, easing: easing(), fill: 'forwards' });
    this.animations = [animation];
    // ::before 的 opacity 用 CSS transition，避免整层 opacity 影响表面与拖动进度。
    try { await animation.finished; } catch { return false; }
    if (this.animations[0] !== animation) return false;
    this.setProgress(target);
    animation.cancel(); this.animations = [];
    return true;
  }

  async close(value = null) {
    if (this.closed || this.closing) return this.result;
    this.closing = true;
    await this.animateTo(0);
    this.closed = true;
    this.overlay.remove();
    document.removeEventListener('keydown', this.onKey);
    const index = stack.indexOf(this); if (index >= 0) stack.splice(index, 1);
    isolate(); unlockScroll();
    this.onClose?.(value);
    if (this.trigger?.isConnected && !this.trigger.closest('[inert]')) this.trigger.focus({ preventScroll: true });
    else if (stack.at(-1)) (stack.at(-1).focusable()[0] || stack.at(-1).panel).focus({ preventScroll: true });
    this.resolve(value);
    return value;
  }
}

export class Dialog extends Overlay {
  constructor(options = {}) { super({ ...options, kind: 'dialog' }); }
}

export class BottomSheet extends Overlay {
  constructor(options = {}) {
    super({ ...options, kind: 'sheet' });
    const handle = this.panel.querySelector('.ui-sheet__handle');
    let gesture = null;
    handle.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button > 0 || this.closing) return;
      gesture = { id: event.pointerId, startY: event.clientY, progress: this.cancelAnimation(), samples: [{ y: event.clientY, t: performance.now() }] };
      handle.setPointerCapture(event.pointerId);
      this.overlay.classList.add('ui-overlay--dragging');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      event.preventDefault();
      const delta = event.clientY - gesture.startY;
      this.setProgress(gesture.progress - delta / Math.max(1, this.panel.getBoundingClientRect().height));
      const t = performance.now();
      gesture.samples.push({ y: event.clientY, t });
      gesture.samples = gesture.samples.filter((sample) => t - sample.t <= 90);
    });
    const finish = (event, cancelled = false) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture; gesture = null;
      const t = performance.now(); current.samples.push({ y: event.clientY, t });
      const samples = current.samples.filter((sample) => t - sample.t <= 90);
      const first = samples[0]; const last = samples.at(-1);
      const speed = last.t === first.t ? 0 : (last.y - first.y) / (last.t - first.t);
      this.overlay.classList.remove('ui-overlay--dragging');
      if (!cancelled && (this.progress() < .7 || speed > .5)) void this.close(null);
      else void this.animateTo(1);
    };
    handle.addEventListener('pointerup', (event) => finish(event));
    handle.addEventListener('pointercancel', (event) => finish(event, true));
  }
}
