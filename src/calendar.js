import { Capacitor, registerPlugin } from '@capacitor/core';

const CalendarIntent = registerPlugin('CalendarIntent');

function toTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export async function addToCalendar(event) {
  if (!event.start) throw new Error('请先补全活动日期和时间');
  if (!Capacitor.isNativePlatform()) throw new Error('加入系统日历功能需要在 Android App 中使用');

  const beginMs = toTimestamp(event.start);
  if (beginMs === null) throw new Error('开始时间格式不正确');
  const parsedEnd = event.end ? toTimestamp(event.end) : null;
  const defaultDuration = event.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const endMs = parsedEnd && parsedEnd > beginMs ? parsedEnd : beginMs + defaultDuration;

  await CalendarIntent.insert({
    title: event.title || '校园活动',
    beginMs,
    endMs,
    allDay: Boolean(event.allDay),
    location: event.location || '',
    description: event.description || ''
  });
}
