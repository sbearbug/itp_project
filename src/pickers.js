import { BottomSheet } from './overlays.js';
import { CalendarGrid, dateKey, parseDateKey } from './CalendarGrid.js';

const actions = '<div class="ui-modal__actions"><button class="button button--secondary" type="button" data-picker-cancel>取消</button><button class="button button--primary" type="button" data-picker-confirm>确定</button></div>';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function bindActions(sheet, confirm) {
  sheet.panel.querySelector('[data-picker-cancel]').onclick = () => { void sheet.close(null); };
  sheet.panel.querySelector('[data-picker-confirm]').onclick = () => { void sheet.close(confirm()); };
}

export async function pickDate({ value = null, mode = 'single', title = '选择日期', trigger } = {}) {
  const rangeMode = mode === 'range';
  let selected = rangeMode ? (value?.start ? { start: value.start, end: value.end || value.start } : null) : value;
  let selectingEnd = false;
  let month = parseDateKey(rangeMode ? selected?.start : selected) || new Date();
  month = new Date(month.getFullYear(), month.getMonth(), 1);
  const sheet = new BottomSheet({ title, trigger, content: `<div class="picker-shortcuts"><button type="button" data-shortcut="today">今天</button><button type="button" data-shortcut="tomorrow">明天</button><button type="button" data-shortcut="saturday">本周六</button></div><div class="picker-calendar"></div><p class="picker-date-hint" aria-live="polite"></p>${actions}` });
  const select = (key) => {
    if (!rangeMode) selected = key;
    else if (!selectingEnd) { selected = { start: key, end: key }; selectingEnd = true; }
    else { selected = { start: selected.start < key ? selected.start : key, end: selected.start > key ? selected.start : key }; selectingEnd = false; }
    render();
    sheet.panel.querySelector(`[data-calendar-date="${key}"]`)?.focus({ preventScroll: true });
  };
  const render = () => {
    const root = sheet.panel.querySelector('.picker-calendar');
    const grid = new CalendarGrid({ month, selected, onSelect: select });
    root.innerHTML = `<div class="month-calendar__toolbar"><button class="icon-button" type="button" data-date-prev aria-label="上个月">‹</button><b class="month-calendar__title">${month.getFullYear()}年${month.getMonth() + 1}月</b><button class="icon-button" type="button" data-date-next aria-label="下个月">›</button></div>${grid.markup()}`;
    grid.bind(root);
    for (const [selector, delta] of [['[data-date-prev]', -1], ['[data-date-next]', 1]]) {
      root.querySelector(selector).onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + delta, 1); render(); root.querySelector(selector)?.focus({ preventScroll: true }); };
    }
    sheet.panel.querySelector('.picker-date-hint').textContent = rangeMode
      ? selectingEnd ? '请选择结束日期' : selected ? `${selected.start} 至 ${selected.end}` : '请选择开始日期'
      : selected || '请选择日期';
    sheet.panel.querySelector('[data-picker-confirm]').disabled = !selected || (rangeMode && selectingEnd);
  };
  sheet.panel.querySelectorAll('[data-shortcut]').forEach((button) => {
    button.onclick = () => {
      const date = new Date();
      if (button.dataset.shortcut === 'tomorrow') date.setDate(date.getDate() + 1);
      // 本周的周六（星期日时回到昨天）。
      if (button.dataset.shortcut === 'saturday') date.setDate(date.getDate() + 5 - (date.getDay() + 6) % 7);
      month = new Date(date.getFullYear(), date.getMonth(), 1);
      select(dateKey(date));
    };
  });
  bindActions(sheet, () => selected);
  render(); sheet.show();
  return sheet.result;
}

export async function pickTime({ value = null, title = '选择时间', trigger } = {}) {
  const [hour, minute] = /^\d{2}:\d{2}$/.test(value || '') ? value.split(':').map(Number) : [9, 0];
  const sheet = new BottomSheet({ title, trigger, content: `<div class="time-wheels"><div class="time-wheels__band" aria-hidden="true"></div>${[24, 60].map((count, column) => `<div class="time-wheel" role="listbox" tabindex="0" aria-label="${column ? '分钟' : '小时'}"><div class="time-wheel__spacer" aria-hidden="true"></div>${Array.from({ length: count }, (_, index) => `<button class="time-wheel__row" type="button" role="option" data-wheel-index="${index}" aria-selected="false">${String(index).padStart(2, '0')}</button>`).join('')}<div class="time-wheel__spacer" aria-hidden="true"></div></div>`).join('<span class="time-wheels__colon" aria-hidden="true">:</span>')}</div><button class="button button--secondary time-pending" type="button">时间待定</button>${actions}` });
  const cleanups = [];
  const wheels = [...sheet.panel.querySelectorAll('.time-wheel')];
  const states = wheels.map((column, columnIndex) => {
    const rows = [...column.querySelectorAll('[data-wheel-index]')];
    const state = { value: columnIndex ? minute : hour, pending: null, timer: null };
    const read = () => Math.max(0, Math.min(rows.length - 1, Math.round(column.scrollTop / 42)));
    const update = (value) => {
      state.value = value;
      rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === value)));
    };
    const settle = () => { update(state.pending ?? read()); state.pending = null; };
    const flush = () => {
      clearTimeout(state.timer); update(state.pending ?? read()); state.pending = null;
      column.scrollTo({ top: state.value * 42, behavior: 'instant' });
      return state.value;
    };
    column.addEventListener('scroll', () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(settle, 'onscrollend' in column ? 220 : 140);
    }, { passive: true });
    if ('onscrollend' in column) column.addEventListener('scrollend', settle);
    column.addEventListener('pointerdown', () => { state.pending = null; });
    column.addEventListener('wheel', () => { state.pending = null; }, { passive: true });
    rows.forEach((row, index) => row.onclick = () => {
      state.pending = index;
      column.scrollTo({ top: index * 42, behavior: reduced() ? 'instant' : 'smooth' });
    });
    column.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, (state.pending ?? read()) + (event.key === 'ArrowDown' ? 1 : -1)));
      state.pending = target; column.scrollTo({ top: target * 42, behavior: reduced() ? 'instant' : 'smooth' });
    });
    update(state.value);
    cleanups.push(() => clearTimeout(state.timer));
    return { state, flush };
  });
  bindActions(sheet, () => states.map((state) => String(state.flush()).padStart(2, '0')).join(':'));
  sheet.panel.querySelector('.time-pending').onclick = () => { void sheet.close(''); };
  sheet.show();
  wheels.forEach((column, index) => { column.scrollTop = states[index].state.value * 42; });
  const result = await sheet.result;
  cleanups.forEach((cleanup) => cleanup());
  return result;
}

export async function pickOption({ value, options, title = '选择选项', trigger } = {}) {
  const sheet = new BottomSheet({ title, trigger, content: '<div class="option-picker"></div>' });
  const root = sheet.panel.querySelector('.option-picker');
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'option-picker__row';
    button.setAttribute('aria-pressed', String(option.value === value));
    const label = document.createElement('span'); label.textContent = option.label;
    const mark = document.createElement('b'); mark.textContent = option.value === value ? '✓' : '';
    button.append(label, mark); root.appendChild(button);
    button.onclick = () => { void sheet.close(option.value); };
  }
  sheet.show();
  return sheet.result;
}
