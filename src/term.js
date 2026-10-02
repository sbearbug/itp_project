import { Preferences } from '@capacitor/preferences';
import { TERM_CONFIG } from './config.js';
import { dateKey, parseDateKey } from './CalendarGrid.js';

const KEY = 'semester_settings';
let settings;

function defaults() {
  const now = new Date();
  const year = now.getMonth() < 5 ? now.getFullYear() - 1 : now.getFullYear();
  return { name: TERM_CONFIG.label, start: dateKey(new Date(year, TERM_CONFIG.startMonth - 1, TERM_CONFIG.startDay)) };
}

export function getTermSettings() {
  return settings || defaults();
}

export async function loadTermSettings() {
  const { value } = await Preferences.get({ key: KEY });
  try {
    const saved = JSON.parse(value);
    if (saved?.name && parseDateKey(saved.start)) settings = saved;
  } catch { /* 未保存或旧偏好损坏时使用默认学期。 */ }
}

export async function saveTermSettings({ name, start }) {
  if (!name.trim() || !parseDateKey(start)) throw new Error('请填写学期名称和有效的开学日期');
  const next = { name: name.trim(), start };
  await Preferences.set({ key: KEY, value: JSON.stringify(next) });
  settings = next;
}

export function termWeek(date = new Date()) {
  const start = parseDateKey(getTermSettings().start);
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const elapsed = (day - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000;
  return elapsed >= 0 && elapsed < TERM_CONFIG.totalWeeks * 7 ? Math.floor(elapsed / 7) + 1 : null;
}
