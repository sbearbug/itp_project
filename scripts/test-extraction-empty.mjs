import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/extract.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let result = [], prompt;
class XHR {
  constructor() { this.listeners = {}; this.upload = { addEventListener() {} }; }
  open() {} setRequestHeader() {}
  addEventListener(name, callback) { this.listeners[name] = callback; }
  send(body) {
    prompt = JSON.parse(body).messages[0].content;
    queueMicrotask(() => {
      this.status = 200; this.responseText = JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] });
      this.listeners.load();
    });
  }
}
const context = vm.createContext({
  Date, Intl, JSON, XMLHttpRequest: XHR, isNative: () => false,
  getDefaultApiConfig: () => ({ apiUrl: 'https://example.com/chat', model: 'test', requestOptions: {} }),
  DESCRIPTION_TEMPLATE: '', prepareUserContent: (value) => value,
  parseJsonArray: JSON.parse, normalizeEvent: (value) => value,
  window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  CustomEvent: class {}
});
vm.runInContext(section('function hasActivityTitle(', 'function pureImageBase64(')
  + section('async function requestExtraction(', 'export async function extractEvents('), context);
const request = () => context.requestExtraction('测试通知', new Date(), '文字');
for (const empty of [[], [null], [{}], [{ title: '   ' }], [{ title: '未命名活动' }], [{ title: '活动名称' }]]) {
  result = empty; await assert.rejects(request(), /未识别到活动/);
}
result = [{ title: '' }, { title: '社团招新', start: null, location: null }, null, { title: '填写报名问卷' }];
const activities = await request();
assert.equal(activities.length, 2); assert.equal(activities[0].title, '社团招新');
assert.equal(activities[0].start, null);
assert.match(prompt, /没有有效事项时只输出 \[\]/); assert.match(prompt, /重复提及要合并/);
assert.match(prompt, /信息不全丢掉真实活动/);
assert.match(prompt, /单行 JSON 数组/);
assert.match(prompt, /全部 11 个字段/);
assert.match(prompt, /字符串中的换行必须编码/);
assert.match(prompt, /不能在双引号内部写实际换行/);
assert.match(prompt, /最后活动日的次日 00:00/);
assert.match(prompt, /不得输出示例内容/);
assert.match(prompt, /唯一正确输出为 \[\]/);
console.log('通过：空数组/空对象/空标题/占位项拒绝，混合结果过滤，缺时间的真实活动保留');
