import { registerPlugin } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform.js';

const NoticeInput = registerPlugin('NoticeInput');
const IGNORED_KEY = 'ignored_notice_clipboard';

export function looksLikeNotice(value) {
  return [...String(value || '').trim()].length > 15
    && /月|日|周|点|楼|室|截止|\d{1,2}[:：]\d{2}|\d{4}[-/]\d{1,2}[-/]\d{1,2}/u.test(value);
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function clipboardNotice() {
  if (!isNative()) return '';
  try {
    const { type, value } = await Clipboard.read();
    const text = String(value || '').trim();
    if (type !== 'text/plain' || !looksLikeNotice(text)) return '';
    const { value: saved } = await Preferences.get({ key: IGNORED_KEY });
    const ignored = JSON.parse(saved || '[]');
    return ignored.includes(await digest(text)) ? '' : text;
  } catch { return ''; }
}

export async function ignoreClipboardNotice(text) {
  const { value } = await Preferences.get({ key: IGNORED_KEY });
  let hashes;
  try { hashes = JSON.parse(value || '[]'); } catch { hashes = []; }
  const hash = await digest(text);
  await Preferences.set({ key: IGNORED_KEY, value: JSON.stringify([...new Set([...hashes, hash])]) });
}

export const recentScreenshots = (request = false) => isNative()
  ? NoticeInput.recentScreenshots({ request }) : Promise.resolve({ allowed: false, images: [] });

export async function nativeImageFile(uri, index = 0) {
  const { dataUrl } = await NoticeInput.readImage({ uri, original: true });
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], `通知截图-${index + 1}`, { type: blob.type || 'image/jpeg' });
}

export const listenForSharedNotices = (handler) => isNative()
  ? NoticeInput.addListener('sharedNotice', handler) : Promise.resolve(null);
