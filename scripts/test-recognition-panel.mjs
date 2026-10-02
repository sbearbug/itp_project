import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const classes = () => ({ names: new Set(), toggle(name, active) { if (active) this.names.add(name); else this.names.delete(name); } });
const dots = Array.from({ length: 4 }, () => ({ textContent: '' }));
const items = dots.map((dot) => ({ classList: classes(), querySelector: () => dot }));
const label = { textContent: '' }, slow = { hidden: true }, progress = {}, input = {};
const feedback = { querySelector: (selector) => ({ '[data-status-message]': label, '.slow-row': slow })[selector] || null };
Object.defineProperty(feedback, 'innerHTML', { set() { throw new Error('工作阶段不应替换反馈内容'); } });
const panel = {
  dataset: { recognitionRun: '1', recognitionSource: 'image' }, classList: classes(),
  setAttribute() {}, querySelectorAll: () => items,
  querySelector: (selector) => ({ '.batch-progress': progress, '#replace-image-input': input, '[data-recognition-feedback]': feedback })[selector]
};
const ui = { recognitionStatus: 'uploading', recognitionSource: 'image', batchActive: false,
  resultIds: [], showingRecognitionCompletion: false, statusTextIndex: 0, slow: false };
const context = vm.createContext({
  ui, recognitionRunId: 1, pendingEvents: [],
  WORKING_STATES: ['compressing', 'uploading', 'recognizing'], STAGE_STATES: ['compressing', 'uploading', 'recognizing', 'done'],
  STATUS_MESSAGES: ['正在读取文字…'], parseRoute: () => ({ name: 'add' }),
  document: { querySelector: () => panel }
});
vm.runInContext(slice('function recognitionStatusText(', 'function selectInputPanel(')
  + slice('async function renderAddPage(', '  app.innerHTML = `<main class="${pageClass(\'secondary-page add-page\')}')
  + '\nthrow new Error("不应重建添加页");\n}', context);
await context.renderAddPage(); assert.equal(label.textContent, '正在上传图片…');
ui.recognitionStatus = 'recognizing'; await context.renderAddPage();
assert.equal(label.textContent, '正在读取文字…'); assert.equal(dots[0].textContent, '✓');
assert.equal(items[2].classList.names.has('is-active'), true);
ui.slow = true; await context.renderAddPage(); assert.equal(slow.hidden, false);
ui.recognitionStatus = 'done'; ui.showingRecognitionCompletion = true;
await context.renderAddPage(); assert.equal(slow.hidden, true);
assert.equal(dots.every((dot) => dot.textContent === '✓'), true);
assert.equal(panel.classList.names.has('recognition-panel--complete'), true);
assert.equal(feedback.querySelector('[data-status-message]'), label);
console.log('通过：阶段/慢提示/完成局部更新，不重建页面或反馈节点');
