// 日期网格只负责日期展示与选择；活动、路由和筛选状态由调用方管理。
export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  const date = new Date(+match[1], +match[2] - 1, +match[3]);
  return dateKey(date) === key ? date : null;
}

export function calendarDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return date;
  });
}

export class CalendarGrid {
  constructor({ month, today = new Date(), selected = null, marks = {}, onSelect = () => {} }) {
    Object.assign(this, { month, today, selected, marks, onSelect });
  }

  markup() {
    const today = dateKey(this.today);
    const range = typeof this.selected === 'string'
      ? { start: this.selected, end: this.selected } : this.selected;
    return `<div class="calendar-grid" role="group" aria-label="日期选择">
      <div class="calendar-grid__week" aria-hidden="true">${['一', '二', '三', '四', '五', '六', '日'].map((day) => `<span>${day}</span>`).join('')}</div>
      <div class="calendar-grid__days">${calendarDays(this.month).map((date) => {
        const key = dateKey(date);
        const inRange = !!range && key >= range.start && key <= range.end;
        const selected = inRange && (key === range.start || key === range.end);
        const mark = this.marks[key];
        return `<button type="button" class="calendar-day ${date.getMonth() !== this.month.getMonth() ? 'calendar-day--outside' : ''} ${key === today ? 'calendar-day--today' : ''} ${selected ? 'calendar-day--selected' : ''} ${inRange && typeof this.selected !== 'string' ? 'calendar-day--in-range' : ''} ${key === range?.start ? 'calendar-day--range-start' : ''} ${key === range?.end ? 'calendar-day--range-end' : ''}" data-calendar-date="${key}" aria-pressed="${inRange}" ${key === today ? 'aria-current="date"' : ''} aria-label="${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${mark ? '，有活动' : ''}"><span>${date.getDate()}</span><i class="calendar-day__dot ${mark === 'urgent' ? 'calendar-day__dot--urgent' : ''}" ${mark ? '' : 'hidden'}></i></button>`;
      }).join('')}</div>
    </div>`;
  }

  bind(root) {
    root.querySelectorAll('[data-calendar-date]').forEach((button) => {
      button.addEventListener('click', () => this.onSelect(button.dataset.calendarDate));
    });
  }
}
