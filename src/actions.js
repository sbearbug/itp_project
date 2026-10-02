import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform.js';
const NoticeInput = registerPlugin('NoticeInput');

export function isWechatValue(value) {
  return /^(?:weixin|wechat):\/\//i.test(value || '')
    || /^https?:\/\/(?:u\.wechat\.com|weixin\.qq\.com|wxp\.qq\.com)(?:[/:?#]|$)/i.test(value || '');
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function normalizeActions(actions = []) {
  if (!Array.isArray(actions)) return [];
  const result = [], seen = new Set();
  for (const action of actions) {
    let value = String(action?.value || '').trim(), type = action?.type;
    if (type === 'url') { value = safeUrl(value); if (!value) continue; if (isWechatValue(value)) type = 'wechat_qr'; }
    else if (type !== 'wechat_qr') continue;
    if (type === 'wechat_qr' && !isWechatValue(value) && !/^data:image\/(?:png|jpeg);base64,[a-z0-9+/=]+$/i.test(value)) continue;
    const key = type + ':' + value;
    if (seen.has(key)) continue; seen.add(key);
    result.push({ type, label: String(action.label || (type === 'url' ? '去报名' : '微信二维码')).trim().slice(0, 12) || '去报名', value });
  }
  return result;
}

export function textLinkActions(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>「」『』“”"'，。；！？、）】]+/gi) || [];
  return normalizeActions(matches.map((value) => ({
    type: 'url', label: '去报名', value: value.replace(/[.,;!?\])}]+$/g, '')
  })));
}

export const mergeActions = (...groups) => normalizeActions(groups.flat());

// Fallback links belong to the supplied notice; users can remove unrelated entries before confirming.
export function mergeTextLinks(events, text) {
  const fallback = textLinkActions(text);
  return events.map((event) => ({
    ...event, actions: mergeActions(event.actions, fallback)
  }));
}

export async function openActionUrl(value) {
  const url = safeUrl(value);
  if (!url || isWechatValue(url)) throw new Error('请输入可在浏览器打开的 http/https 链接');
  if (isNative()) await NoticeInput.openUrl({ url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function saveQrImage(value) {
  if (!/^data:image\/(?:png|jpeg);base64,/i.test(value || '')) throw new Error('没有可保存的二维码图片，请在编辑页添加二维码图片');
  if (isNative()) await NoticeInput.saveQrImage({ dataUrl: value });
  else {
    const link = document.createElement('a'); link.href = value; link.download = '微信二维码.png'; link.click();
  }
}
