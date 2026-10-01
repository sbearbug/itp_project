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

function withoutDeadlineLine(description) {
  return String(description || '')
    .split(/\r?\n/)
    .filter((line) => !/^报名截止[：:]/.test(line.trim()))
    .join('\n')
    .trim();
}

function deadlineDescription(event) {
  return event.signup ? `报名方式：${event.signup}` : '请在截止时间前完成报名。';
}

function downloadIcs({ uidPrefix, title, startMs, endMs, location, description, filename }) {
  const stamp = toIcsUtc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Campus Action//Local Web//ZH-CN'];
  lines.push(...eventLines({
    uid: makeUid(uidPrefix),
    start: new Date(startMs),
    end: new Date(endMs),
    title,
    location,
    description
  }, stamp));
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename(filename);
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
    downloadIcs({
      uidPrefix: event.id || 'event',
      title: event.title || '校园活动',
      startMs: beginMs,
      endMs,
      location: event.location || '',
      description: withoutDeadlineLine(event.description),
      filename: event.title || '校园活动'
    });
    return;
  }

  await CalendarIntent.insert({
    title: event.title || '校园活动',
    beginMs,
    endMs,
    allDay: Boolean(event.allDay),
    location: event.location || '',
    description: withoutDeadlineLine(event.description)
  });
}

export function hasDeadlineCalendarEntry(event) {
  return Boolean(event?.deadline && toTimestamp(event.deadline) !== null);
}

export async function addDeadlineToCalendar(event) {
  const deadlineMs = toTimestamp(event?.deadline);
  if (deadlineMs === null) throw new Error('报名截止时间格式不正确');
  const baseTitle = event.title || '校园活动';
  const title = `【报名截止】${baseTitle}`;
  const endMs = deadlineMs + 60 * 60 * 1000;
  const description = deadlineDescription(event);

  if (!isNative()) {
    downloadIcs({
      uidPrefix: `${event.id || 'event'}-deadline`,
      title,
      startMs: deadlineMs,
      endMs,
      location: '',
      description,
      filename: `报名截止_${baseTitle}`
    });
    return;
  }

  await CalendarIntent.insert({
    title,
    beginMs: deadlineMs,
    endMs,
    allDay: false,
    location: '',
    description
  });
}
