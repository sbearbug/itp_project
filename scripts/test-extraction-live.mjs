// Explicitly opt-in: sends synthetic fixtures to the configured API, never real notices.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), 'VITE_');
const source = readFileSync('src/extract.js', 'utf8');
const configSource = readFileSync('src/config.js', 'utf8').replace(/^import .*;\n/m, '').replaceAll('export ', '').replaceAll('import.meta.env', 'env');
const configContext = vm.createContext({ env, Preferences: {} });
vm.runInContext(configSource + '\n globalThis.config = getDefaultApiConfig();', configContext);
const config = configContext.config;
if (!config.apiKey) throw new Error('Missing configured API key');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let captured;
class CaptureXHR {
  constructor() { this.upload = { addEventListener() {} }; }
  open() {} setRequestHeader() {} addEventListener() {}
  send(body) { captured = JSON.parse(body); }
}
const context = vm.createContext({
  Date, Intl, JSON, XMLHttpRequest: CaptureXHR, isNative: () => true,
  getApiConfig: async () => config, getDefaultApiConfig: () => config,
  prepareUserContent: value => value, CustomEvent: class {},
  window: { addEventListener() {}, dispatchEvent() {} },
});
vm.runInContext(source.slice(source.indexOf('const DESCRIPTION_TEMPLATE'), source.indexOf('function normalizeEvent'))
  + section('async function requestExtraction(', 'export async function extractEvents('), context);
const fixtures = [
  ['single', '讲座《人工智能与校园生活》，2026年10月20日19:00至20:30，图书馆报告厅。报名截止10月18日18:00，报名：https://example.org/register?id=1&source=campus'],
  ['multiple', '2026年10月10日大狗叫俱乐部招新，地点大狗叫楼。2026年10月20日哈基米俱乐部招新，地点南北绿豆楼，报名截止10月10日。新宿决战招人，时间地点待通知。'],
  ['escaping', '读书会“他说：你好”，2026年10月22日14:00-16:00，三教201室。\n主题：书名《A [B] 与 C》；介绍含双引号"交流"、反斜杠\\和换行。\n详情 https://example.org/book?q=hello&lang=zh'],
  ['missing', '摄影社秋季招新正式开始！感兴趣请联系负责人，活动时间和集合地点稍后公布。'],
  ['empty', '早上好哈哈哈，今天食堂好吃，回头再聊。设置 首页 返回 上传图片'],
  ['range', '校园志愿服务周：2026年10月20日至23日，校内各楼。2026年10月18日截止报名。另请在2026年10月16日17:00前填写问卷：https://example.org/form。'],
];
const selected = process.argv[3]?.split(',');
const cases = selected ? fixtures.filter(([name]) => selected.includes(name)) : fixtures;
const results = [];
console.log(`Testing ${config.model}: ${cases.length} synthetic text fixtures (sequential)`);
for (const [name, text] of cases) {
  captured = undefined;
  void context.requestExtraction(text, new Date('2026-10-02T12:00:00+08:00'), '校园通知文字');
  await new Promise(resolve => setImmediate(resolve));
  if (!captured) throw new Error('Failed to capture the App request');
  const started = Date.now();
  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(captured), signal: AbortSignal.timeout(60000),
    });
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content;
    const record = { name, status: response.status, ms: Date.now() - started,
      finishReason: body.choices?.[0]?.finish_reason, error: body.error, content };
    if (response.ok) {
      try {
        const value = context.parseJsonArray(content || ''); record.parsed = Array.isArray(value); record.count = value.length;
        const fields = ['title', 'start', 'end', 'allDay', 'location', 'deadline', 'signup', 'description', 'category', 'uncertain', 'actions'];
        record.schemaIssues = value.flatMap((event, index) => {
          const issues = fields.filter(field => !Object.hasOwn(event, field)).map(field => `${index}: missing ${field}`);
          if (typeof event.allDay !== 'boolean') issues.push(`${index}: allDay is not boolean`);
          if (!Array.isArray(event.actions) || !Array.isArray(event.uncertain)) issues.push(`${index}: invalid array fields`);
          for (const field of ['start', 'end', 'deadline', 'location', 'signup']) {
            if (event[field] !== null && typeof event[field] !== 'string') issues.push(`${index}: invalid ${field}`);
          }
          return issues;
        });
      }
      catch (error) { record.parsed = false; record.parseError = error.message; }
      try { JSON.parse(content); record.strictJSON = true; } catch { record.strictJSON = false; }
    }
    results.push(record);
    console.log(JSON.stringify({ ...record, content: undefined }));
  } catch (error) { results.push({ name, error: error.message }); console.log(`${name}: ${error.message}`); }
  // Keep this diagnostic low-rate; do not amplify busy-service errors with rapid retries.
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const output = process.argv[2] || '/tmp/luojian-extraction-live.json';
writeFileSync(output, JSON.stringify(results, null, 2));
console.log(`Synthetic responses saved to ${output}; no key saved.`);
