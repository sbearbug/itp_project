/**
 * 启动动画模块。只使用 transform 与 opacity。
 *
 * 用法：
 *   import { getIntroMode, playIntro } from './intro.js';
 *   await loadIntroSetting();
 *   const mode = getIntroMode();              // 'full' | 'off'
 *   await Promise.all([playIntro({ mode, app: document.querySelector('#app') }), loadEvents()]);
 *
 * 约定：
 *   - 页面中已存在 intro-snippet.html 里的 #intro 结构；
 *   - 主界面根元素在动画开始前带有 app-root--intro-pending 类；
 *   - 若当前主题背景色与系统启动页不同，传入 themeBg，开头 150ms 内过渡过去。
 */

import { Preferences } from '@capacitor/preferences';

const STORAGE_KEY = 'intro:lastFullDate';
const SETTING_KEY = 'intro:frequency';
export const INTRO_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'daily', label: '每天一次' },
  { value: 'always', label: '保持开启' }
];
let introSetting = 'daily';
export const getIntroSetting = () => introSetting;
export async function loadIntroSetting() {
  try {
    const { value } = await Preferences.get({ key: SETTING_KEY });
    introSetting = INTRO_OPTIONS.some((option) => option.value === value) ? value : 'daily';
  } catch { introSetting = 'daily'; }
  return introSetting;
}
export async function setIntroSetting(value) {
  if (!INTRO_OPTIONS.some((option) => option.value === value)) throw new Error('无效的启动动画设置');
  await Preferences.set({ key: SETTING_KEY, value });
  introSetting = value;
}

// 近似无回弹的弹簧缓动；旧版 WebView 不支持 linear() 时回退到 cubic-bezier
const SPRING = 'linear(0, 0.07 4%, 0.25 10%, 0.5 19%, 0.72 30%, 0.86 42%, 0.94 55%, 0.98 70%, 1)';
const FALLBACK = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE = (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'))
  ? SPRING : FALLBACK;

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 关闭不播放；每日最多一次；保持开启每次冷启动播放。 */
export function getIntroMode() {
  if (introSetting === 'off') return 'off';
  try {
    const today = todayString();
    if (introSetting === 'daily' && localStorage.getItem(STORAGE_KEY) === today) return 'off';
    localStorage.setItem(STORAGE_KEY, today);
  } catch (_) { /* 存储不可用时按完整动画处理 */ }
  return 'full';
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 播放启动动画，结束后移除遮罩并显示主界面。
 * @param {{ mode?: 'full'|'quick'|'off', app: HTMLElement, themeBg?: string }} opts
 * @returns {Promise<void>}
 */
export function playIntro({ mode = 'full', app, themeBg } = {}) {
  const overlay = document.getElementById('intro');
  if (!overlay) { reveal(app); return Promise.resolve(); }
  if (mode === 'off') {
    overlay.classList.add('is-done');
    reveal(app);
    return Promise.resolve();
  }

  const base = overlay.querySelector('.intro-base');
  const page = overlay.querySelector('.intro-page');
  const reduced = prefersReducedMotion();
  const anims = [];
  const run = (el, keyframes, opts) => {
    const a = el.animate(keyframes, { fill: 'forwards', easing: EASE, ...opts });
    anims.push(a);
    return a;
  };

  // 背景色从系统启动页过渡到当前主题
  if (themeBg) {
    run(overlay, [{ backgroundColor: getComputedStyle(overlay).backgroundColor }, { backgroundColor: themeBg }],
      { duration: 150, easing: 'linear' });
  }

  let finished;
  if (reduced || mode === 'quick') {
    // 只做淡入淡出
    const d = reduced ? 200 : 300;
    run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: d, easing: 'linear' });
    if (app) run(app, [{ opacity: 0 }, { opacity: 1 }], { duration: d, easing: 'linear' });
    finished = Promise.all(anims.map((a) => a.finished));
  } else {
    // 1. 撕页：纸页带倾斜浮起，底座淡出（200ms）
    run(page, [
      { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
      { transform: 'translate(0, -6px) rotate(-6deg) scale(1.04)', opacity: 1 },
    ], { duration: 200 });
    run(base, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' });

    // 2. 穿过：回正、移到屏幕中央、放大约 3 倍并淡出（450ms，紧接撕页）
    // 纸页中心相对图标中心的偏移按图标尺寸换算，使纸页最终落在屏幕正中
    const size = page.getBoundingClientRect().width || 160;
    const toCenter = `translate(${(0.0117 * size).toFixed(1)}px, ${(-0.0758 * size).toFixed(1)}px)`;
    run(page, [
      { transform: 'translate(0, -6px) rotate(-6deg) scale(1.04)', opacity: 1 },
      { transform: `${toCenter} rotate(0deg) scale(3)`, opacity: 0 },
    ], { duration: 450, delay: 200 });

    // 遮罩背景同步变透明，让后方的主界面真正露出来
    const fromBg = themeBg || getComputedStyle(overlay).backgroundColor;
    run(overlay, [{ backgroundColor: fromBg }, { backgroundColor: 'rgba(0, 0, 0, 0)' }],
      { duration: 300, delay: 200, easing: 'linear' });

    // 3. 露出：主界面从 96% 迎上来
    if (app) {
      run(app, [
        { transform: 'scale(0.96)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ], { duration: 450, delay: 200 });
    }
    finished = Promise.all(anims.map((a) => a.finished));
  }

  // 点击任意位置立即跳过
  const skip = () => anims.forEach((a) => { try { a.finish(); } catch (_) {} });
  overlay.addEventListener('pointerdown', skip, { once: true });

  return Promise.resolve(finished).catch(() => {}).then(() => {
    overlay.classList.add('is-done');
    overlay.removeEventListener('pointerdown', skip);
    reveal(app);
    // 清理主界面上的动画残留，避免 transform 影响后续布局
    if (app) app.getAnimations().forEach((a) => a.cancel());
  });
}

function reveal(app) {
  if (!app) return;
  app.classList.remove('app-root--intro-pending');
  app.style.opacity = '';
  app.style.transform = '';
}
