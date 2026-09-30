import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform.js';

const CalendarIntent = registerPlugin('CalendarIntent');

function toTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function escapeIcs(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

function toIcsUtc(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('时间格式不正确');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function makeUid(prefix = 'event') {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}@campus-action.local`;
}

function eventLines({ uid, start, end, title, location, description }, stamp) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(`提醒：${title}`)}`,
    'END:VALARM',
    'END:VEVENT'
  ];
}

function safeFilename(value) {
  const name = String(value || '校园活动').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return `${name || '校园活动'}.ics`;
}

function downloadIcs(event, beginMs, endMs) {
  const stamp = toIcsUtc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Campus Action//Local Web//ZH-CN'];
  lines.push(...eventLines({
    uid: makeUid(event.id || 'event'),
    start: new Date(beginMs),
    end: new Date(endMs),
    title: event.title || '校园活动',
    location: event.location || '',
    description: event.description || ''
  }, stamp));

  if (event.deadline) {
    const deadlineMs = toTimestamp(event.deadline);
    if (deadlineMs !== null) {
      const deadlineTitle = `【报名截止】${event.title || '校园活动'}`;
      lines.push(...eventLines({
        uid: makeUid(`${event.id || 'event'}-deadline`),
        start: new Date(deadlineMs),
        end: new Date(deadlineMs + 60 * 60 * 1000),
        title: deadlineTitle,
        location: event.location || '',
        description: event.description || ''
      }, stamp));
    }
  }

  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename(event.title);
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function addToCalendar(event) {
  if (!event.start) throw new Error('请先补全活动日期和时间');

  const beginMs = toTimestamp(event.start);
  if (beginMs === null) throw new Error('开始时间格式不正确');
  const parsedEnd = event.end ? toTimestamp(event.end) : null;
  const defaultDuration = event.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const endMs = parsedEnd && parsedEnd > beginMs ? parsedEnd : beginMs + defaultDuration;

  if (!isNative()) {
    downloadIcs(event, beginMs, endMs);
    return;
  }

  await CalendarIntent.insert({
    title: event.title || '校园活动',
    beginMs,
    endMs,
    allDay: Boolean(event.allDay),
    location: event.location || '',
    description: event.description || ''
  });
}
