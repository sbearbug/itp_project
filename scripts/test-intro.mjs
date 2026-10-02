import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/intro.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const saved = new Map(), dates = new Map();
let now = '2026-10-02T12:00:00', fail = false;
const appClasses = new Set(['app-root--intro-pending']), overlayClasses = new Set();
const app = { classList: { remove: (name) => appClasses.delete(name) }, style: { opacity: '0', transform: 'scale(.96)' } };
const context = vm.createContext({
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
  localStorage: { getItem: (key) => dates.get(key), setItem: (key, value) => dates.set(key, value) },
  Preferences: {
    get: async ({ key }) => ({ value: saved.get(key) ?? null }),
    set: async ({ key, value }) => { if (fail) throw new Error('storage'); saved.set(key, value); }
  },
  document: { getElementById: () => ({ classList: { add: (name) => overlayClasses.add(name) } }) }
});
vm.runInContext(source, context);
const setting = () => vm.runInContext('getIntroSetting()', context);
await context.loadIntroSetting(); assert.equal(setting(), 'daily');
assert.equal(context.getIntroMode(), 'full'); assert.equal(context.getIntroMode(), 'off');
now = '2026-10-03T12:00:00'; assert.equal(context.getIntroMode(), 'full');
await context.setIntroSetting('off'); const marker = dates.get('intro:lastFullDate');
assert.equal(context.getIntroMode(), 'off'); assert.equal(dates.get('intro:lastFullDate'), marker);
await context.playIntro({ mode: 'off', app });
assert.equal(overlayClasses.has('is-done'), true); assert.equal(appClasses.size, 0); assert.equal(app.style.opacity, '');
await context.setIntroSetting('always'); assert.equal(context.getIntroMode(), 'full'); assert.equal(context.getIntroMode(), 'full');
await context.loadIntroSetting(); assert.equal(setting(), 'always');
fail = true; await assert.rejects(context.setIntroSetting('off')); assert.equal(setting(), 'always');
fail = false; await assert.rejects(context.setIntroSetting('invalid'));
saved.set('intro:frequency', 'invalid'); await context.loadIntroSetting(); assert.equal(setting(), 'daily');
assert.equal(context.getIntroMode(), 'off');
console.log('通过：默认/每日首启与再启/跨日/关闭不动画/始终开启/持久化/保存失败/旧标记兼容');
