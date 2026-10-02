import { isWechatValue, safeUrl, mergeActions } from './actions.js';
export function qrBounds(location, width, height, offsetX = 0, offsetY = 0) {
  const corners = ['topLeftCorner', 'topRightCorner', 'bottomLeftCorner', 'bottomRightCorner'].map((key) => location[key]);
  const left = Math.min(...corners.map((point) => point.x)) + offsetX;
  const top = Math.min(...corners.map((point) => point.y)) + offsetY;
  const right = Math.max(...corners.map((point) => point.x)) + offsetX;
  const bottom = Math.max(...corners.map((point) => point.y)) + offsetY;
  const margin = Math.max(8, (right - left) * .12);
  const x = Math.max(0, Math.floor(left - margin)), y = Math.max(0, Math.floor(top - margin));
  return { x, y, width: Math.min(width, Math.ceil(right + margin)) - x, height: Math.min(height, Math.ceil(bottom + margin)) - y };
}

export function cropImage(source, bounds) {
  const canvas = document.createElement('canvas'); canvas.width = bounds.width; canvas.height = bounds.height;
  canvas.getContext('2d').drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return canvas.toDataURL('image/png');
}

export async function scanImageQr(file) {
  const bitmap = await createImageBitmap(file), hits = [];
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
  const worker = new Worker(new URL('./qr-worker.js', import.meta.url), { type: 'module' });
  let timer, requestId = 0, stopped = false;
  const decode = (bounds) => new Promise((resolve) => {
    if (stopped) { resolve(null); return; }
    const id = ++requestId;
    const pixels = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    worker.onmessage = ({ data }) => { if (data.id === id) { clearTimeout(timer); resolve(data.code); } };
    worker.onerror = () => { stopped = true; clearTimeout(timer); resolve(null); };
    timer = setTimeout(() => { stopped = true; worker.terminate(); resolve(null); }, 8000);
    worker.postMessage({ id, pixels: pixels.data.buffer, width: pixels.width, height: pixels.height }, [pixels.data.buffer]);
  });
  const collect = (code, x = 0, y = 0) => {
    if (!code?.data) return;
    const bounds = qrBounds(code.location, bitmap.width, bitmap.height, x, y);
    hits.push({ data: code.data, bounds, image: cropImage(bitmap, bounds) });
    context.fillStyle = '#FFFFFF'; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  };
  try {
    // Scan at original resolution first, masking found codes to locate additional ones.
    for (let count = 0; count < 4; count++) {
      const code = await decode({ x: 0, y: 0, width: bitmap.width, height: bitmap.height });
      if (!code) break; collect(code);
    }
    // Only fall back to overlapping original-resolution tiles if the full image failed.
    if (!hits.length) for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
      const x = Math.floor(column * bitmap.width / 4), y = Math.floor(row * bitmap.height / 4);
      const width = Math.min(bitmap.width - x, Math.ceil(bitmap.width / 2));
      const height = Math.min(bitmap.height - y, Math.ceil(bitmap.height / 2));
      collect(await decode({ x, y, width, height }), x, y);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9));
    return { hits, maskedFile: hits.length && blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file };
  } finally { clearTimeout(timer); worker.terminate(); bitmap.close(); canvas.width = canvas.height = 0; }
}

export function mergeQrActions(events, hits) {
  const unique = [...new Map(hits.map((hit) => [hit.data, hit])).values()];
  const actions = unique.flatMap((hit) => isWechatValue(hit.data)
    ? [{ type: 'wechat_qr', label: '微信二维码', value: hit.image }]
    : safeUrl(hit.data) ? [{ type: 'url', label: '去报名', value: hit.data }] : []);
  const wechat = hits.filter((hit) => isWechatValue(hit.data)).map((hit) => hit.data);
  return events.map((event) => ({
    ...event, actions: mergeActions((event.actions || []).filter((action) => !wechat.includes(action.value)), actions)
  }));
}
