import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = readFileSync(new URL('../src/extract.js', import.meta.url), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

for (const native of [true, false]) {
  const events = [];
  class XHR {
    constructor() { this.listeners = {}; this.upload = { addEventListener: (name, callback) => { this.uploadDone = callback; } }; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    open() {} setRequestHeader() {}
    send() {
      queueMicrotask(() => {
        // 原生模拟不提供 upload 事件，与 Capacitor bridge 行为一致。
        if (!native) this.uploadDone();
        this.readyState = 4; this.status = 200;
        this.responseText = JSON.stringify({ choices: [{ message: { content: '[]' } }] });
        this.listeners.readystatechange(); this.listeners.load();
      });
    }
  }
  const config = { apiUrl: 'https://example.com/chat', apiKey: 'test', model: 'test', requestOptions: {} };
  const context = vm.createContext({
    Date, Intl, JSON, XMLHttpRequest: XHR, isNative: () => native,
    getApiConfig: async () => config, getDefaultApiConfig: () => config,
    DESCRIPTION_TEMPLATE: '', prepareUserContent: (value) => value,
    parseJsonArray: () => [{ title: '测试' }], normalizeEvent: (value) => value,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent: (event) => events.push(event.detail), addEventListener() {}, removeEventListener() {} }
  });
  vm.runInContext(section(extract, 'async function requestExtraction(', 'export async function extractEvents('), context);
  vm.runInContext(section(extract, 'function hasActivityTitle(', 'function pureImageBase64('), context);
  await context.requestExtraction('测试通知', new Date(), '文字');
  assert.deepEqual(events, ['recognizing']);
}

let time = 0, stages = [], stored = [], cancelAt = 0;
const context = vm.createContext({
  Date: class extends Date { static now() { return time; } },
  ui: { recognitionStatus: 'uploading', batchActive: false, resultIds: [] },
  recognitionRunId: 1, recognitionStageStartedAt: 0,
  wait: async (duration) => { time += duration; if (duration === cancelAt) context.recognitionRunId++; },
  setRecognitionStatus(status, patch) {
    stages.push({ status, time, completing: patch?.showingRecognitionCompletion });
    context.recognitionStageStartedAt = time;
    Object.assign(context.ui, patch, { recognitionStatus: status });
  },
  makeId: () => 'test', addPendingEvents: async (items) => stored.push(...items), refresh: async () => {},
  document: { querySelector: () => ({ classList: { add() {} } }) }
});
vm.runInContext(section(main, 'async function enterRecognizing(', 'function cancelRecognition('), context);
await context.storeExtractionResults([{ title: '测试' }], 1);
assert.deepEqual(stages.map((stage) => stage.status), ['recognizing', 'done', 'done']);
assert.equal(stages[0].time, 250); assert.equal(stages[1].time, 650);
assert.equal(stages[1].completing, true); assert.equal(stages[2].completing, false);
assert.equal(stages[2].time - stages[1].time, 730); assert.equal(stored.length, 1);
assert.equal(context.ui.activeDraftId, 'test');
time = 0; stages = []; stored = []; cancelAt = 250;
context.recognitionRunId = 2; context.recognitionStageStartedAt = 0;
context.ui.recognitionStatus = 'uploading';
await context.storeExtractionResults([{ title: '晚到' }], 2);
assert.equal(stored.length, 0); assert.equal(stages.length, 0);
console.log('通过：原生无上传事件兜底、Web 阶段去重、完整识别/完成展示、取消后不保存晚到结果');
