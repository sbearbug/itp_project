import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { normalizeActions, mergeActions, textLinkActions, mergeTextLinks, safeUrl, isWechatValue } from '../src/actions.js';
import { qrBounds, mergeQrActions } from '../src/qr.js';

// Small test-only Version 1-L QR encoder; no runtime or test dependency is added.
export function fixtureQr(text) {
  const bytes = [...new TextEncoder().encode(text)]; assert(bytes.length <= 17);
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(4, 4); push(bytes.length, 8); bytes.forEach((byte) => push(byte, 8)); push(0, 4);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  while (data.length < 19) data.push(data.length % 2 === Math.ceil(bits.length / 8) % 2 ? 0xec : 0x11);
  const multiply = (x, y) => {
    let z = 0; for (let i = 7; i >= 0; i--) z = (z << 1 ^ (z >>> 7) * 0x11d) ^ ((y >>> i & 1) * x); return z;
  };
  const divisor = Array(7).fill(0); divisor[6] = 1; let root = 1;
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) divisor[j] = multiply(divisor[j], root) ^ (j < 6 ? divisor[j + 1] : 0);
    root = multiply(root, 2);
  }
  const remainder = Array(7).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift(); remainder.push(0);
    for (let i = 0; i < 7; i++) remainder[i] ^= multiply(divisor[i], factor);
  }
  const matrix = Array.from({ length: 21 }, () => Array(21).fill(false));
  const reserved = Array.from({ length: 21 }, () => Array(21).fill(false));
  const set = (x, y, black) => { if (x >= 0 && x < 21 && y >= 0 && y < 21) { matrix[y][x] = !!black; reserved[y][x] = true; } };
  for (const [cx, cy] of [[3, 3], [17, 3], [3, 17]]) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
    const distance = Math.max(Math.abs(x), Math.abs(y)); set(cx + x, cy + y, distance !== 2 && distance !== 4);
  }
  for (let i = 8; i < 13; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const format = 0x77c4; // Level L, mask 0.
  for (let i = 0; i < 6; i++) set(8, i, format >>> i & 1);
  set(8, 7, format >>> 6 & 1); set(8, 8, format >>> 7 & 1); set(7, 8, format >>> 8 & 1);
  for (let i = 9; i < 15; i++) set(14 - i, 8, format >>> i & 1);
  for (let i = 0; i < 8; i++) set(20 - i, 8, format >>> i & 1);
  for (let i = 8; i < 15; i++) set(8, 6 + i, format >>> i & 1);
  set(8, 13, true);
  const stream = [...data, ...remainder].flatMap((byte) => Array.from({ length: 8 }, (_, i) => byte >>> (7 - i) & 1));
  let index = 0;
  for (let right = 20; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < 21; vertical++) {
      const y = (right + 1 & 2) === 0 ? 20 - vertical : vertical;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!reserved[y][x]) matrix[y][x] = !!((stream[index++] || 0) ^ ((x + y) % 2 === 0));
      }
    }
  }
  return matrix;
}

const scale = 8, width = 29 * scale;
for (const content of ['https://a.co', 'weixin://g/1']) {
  const matrix = fixtureQr(content), pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - 4, col = Math.floor(x / scale) - 4;
    const value = row >= 0 && row < 21 && col >= 0 && col < 21 && matrix[row][col] ? 0 : 255;
    pixels.set([value, value, value, 255], (y * width + x) * 4);
  }
  const code = jsQR(pixels, width, width); assert.equal(code?.data, content);
  const bounds = qrBounds(code.location, width, width);
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.x + bounds.width <= width);
}
assert.equal(safeUrl('javascript:alert(1)'), null);
assert.equal(safeUrl('https://name:password@example.com'), null);
assert.equal(normalizeActions(undefined).length, 0);
assert.equal(isWechatValue('https://u.wechat.com/abc'), true);
assert.equal(isWechatValue('https://mp.weixin.qq.com/s/article'), false);
assert.equal(textLinkActions('报名：https://example.com/apply。问卷 https://example.com/form，').length, 2);
assert.equal(mergeActions([{ type: 'url', label: '去报名', value: 'https://a.co' }], [{ type: 'url', label: '详情', value: 'https://a.co/' }]).length, 1);
const merged = mergeQrActions([{ actions: [{ type: 'url', label: '查看详情', value: 'https://a.co' }] }],
  [{ data: 'https://a.co', image: 'data:image/png;base64,YQ==' }, { data: 'weixin://g/1', image: 'data:image/png;base64,YQ==' }]);
assert.equal(merged[0].actions.length, 2); assert.equal(merged[0].actions[1].type, 'wechat_qr');
assert.equal(mergeTextLinks([{ title: '活动' }], '报名链接 https://example.com')[0].actions.length, 1);
console.log('通过：真实 QR 解码、微信码分类、裁剪边界、链接兜底去重、非法协议过滤、旧数据兼容');
