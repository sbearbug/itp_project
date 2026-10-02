// In-scope logic tests: actual recognition functions with local, non-network dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const inputs = readFileSync(new URL('../src/notice-inputs.js', import.meta.url), 'utf8');
function between(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
let stored = [], calls = [], inFlight = 0, maximum = 0, id = 0;
const context = vm.createContext({
  ui: { recognitionStatus: 'idle', resultIds: [], batchActive: false, previewUrl: '' },
  WORKING_STATES: ['compressing', 'uploading', 'recognizing'], batchRunId: 0, recognitionRunId: 0,
  Date, Event, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  window: { dispatchEvent() {} }, document: { querySelector: () => null },
  makeId: () => 'draft-' + ++id,
  compressImage: async (file) => file.name,
  scanImageQr: async (file) => ({ maskedFile: file, hits: [] }),
  mergeQrActions: (events) => events,
  nativeImageFile: async (uri) => ({ name: uri }),
  setRecognitionStatus(status, patch = {}) { Object.assign(context.ui, patch, { recognitionStatus: status }); },
  addPendingEvents: async (events) => stored.push(...events), refresh: async () => {},
  wait: async () => {},
  async extractEvents(name) {
    calls.push(name); maximum = Math.max(maximum, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5)); inFlight--;
    if (name === 'bad') throw new Error('限流测试');
    return [{ title: name, start: null, end: null, allDay: true, uncertain: [] }];
  }
});
vm.runInContext(
  between(main, 'async function startImageBatch(', 'async function startTextRecognition(')
  + between(main, 'async function storeExtractionResults(', "window.addEventListener('campus:extract-stage'")
  + between(inputs, 'export function looksLikeNotice(', 'async function digest(').replace('export ', ''), context
);
const sources = ['one', 'bad', 'three'].map((name) => ({ file: { name } }));
await context.startImageBatch(sources);
assert.deepEqual(calls, ['one', 'bad', 'three']);
assert.equal(maximum, 1); assert.equal(stored.length, 2);
assert.equal(context.ui.resultIds.length, 2); assert.equal(context.ui.batchFailed.length, 1);
assert.equal(context.ui.recognitionStatus, 'done'); assert.equal(context.ui.batchActive, false);
await context.startImageBatch([{ file: { name: 'retry' } }], true);
assert.equal(stored.length, 3); assert.equal(context.ui.resultIds.length, 3);
await context.startImageBatch([{ file: { name: 'bad' } }]);
assert.equal(context.ui.recognitionStatus, 'error');
assert.equal(context.ui.batchFailed.length, 1);
context.extractEvents = async () => { context.cancelRecognition(); return [{ title: 'late' }]; };
const before = stored.length;
await context.startImageBatch([{ file: { name: 'cancel' } }]);
assert.equal(stored.length, before); assert.equal(context.ui.batchActive, false);
assert.equal(context.looksLikeNotice('请于10月20日下午三点到教学楼参加报名宣讲会'), true);
assert.equal(context.looksLikeNotice('这是一段长度超过十五个字但是并不包含任何特征的闲聊内容'), false);
assert.equal(context.looksLikeNotice('明天三点'), false);
console.log('通过：顺序批量、局部失败、合并重试、全部失败、取消晚到结果、剪贴板特征与长度');
