import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let choice = null, stored = [], fail = false, errorText = '';
class Dialog {
  constructor() {
    this.result = new Promise((resolve) => { this.resolve = resolve; });
    this.buttons = [{}, {}, {}];
    this.nodes = { '[data-stay]': this.buttons[0], '[data-discard]': this.buttons[1], '[data-save]': this.buttons[2], '[role="alert"]': { set textContent(value) { errorText = value; } } };
    this.panel = { querySelector: (key) => this.nodes[key], querySelectorAll: () => this.buttons };
    context.dialog = this;
  }
  show() { if (choice) queueMicrotask(() => this.nodes[choice].onclick()); }
  async close(value) { this.resolve(value); }
}
const context = vm.createContext({
  JSON, Boolean, Dialog, editorExitPrompt: null, ui: { actionBusy: null },
  getFormPatch: (form) => form.patch,
  updateEvent: async (id, patch) => { if (fail) throw new Error('storage'); stored.push({ id, patch }); },
  refresh: async () => {}, showToast() {},
  setActionBusy: () => { context.ui.actionBusy = 'saving'; },
  clearActionBusy: () => { context.ui.actionBusy = null; }
});
vm.runInContext(section('function editorHasChanges(', 'async function renderEditorDraft('), context);
const form = { patch: { title: '原活动', actions: [] }, dataset: { id: 'test' } };
form.savedPatch = JSON.stringify(form.patch);
assert.equal(context.editorHasChanges(form), false);
assert.equal(await context.allowEditorExit(form), true);
form.patch = { title: '修改活动', actions: [] };
assert.equal(context.editorHasChanges(form), true);
choice = '[data-stay]'; assert.equal(await context.allowEditorExit(form), false);
choice = '[data-discard]'; assert.equal(await context.allowEditorExit(form), true); assert.equal(stored.length, 0);
choice = '[data-save]'; assert.equal(await context.allowEditorExit(form), true); assert.equal(stored[0].patch.title, '修改活动');
assert.equal(context.editorHasChanges(form), false);
form.patch = { title: '修改活动', actions: [{ type: 'url', label: '去报名', value: 'https://example.com/' }] };
assert.equal(context.editorHasChanges(form), true);
fail = true; choice = null;
const failedExit = context.allowEditorExit(form);
await context.dialog.nodes['[data-save]'].onclick();
assert.match(errorText, /保存失败/); assert.equal(context.editorHasChanges(form), true);
await context.dialog.close(null); assert.equal(await failedExit, false);
fail = false; form.patch.title = '';
const invalidExit = context.allowEditorExit(form);
await context.dialog.nodes['[data-save]'].onclick(); assert.match(errorText, /活动名称/);
await context.dialog.close(null); assert.equal(await invalidExit, false);
form.patch = JSON.parse(form.savedPatch); assert.equal(context.editorHasChanges(form), false);
console.log('通过：无修改退出、继续编辑、不保存、保存、入口修改检测、失败保留、空标题验证、恢复原值');
