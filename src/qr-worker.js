import jsQR from 'jsqr';
self.onmessage = ({ data }) => {
  try {
    const code = jsQR(new Uint8ClampedArray(data.pixels), data.width, data.height, { inversionAttempts: 'attemptBoth' });
    self.postMessage({ id: data.id, code: code ? { data: code.data, location: code.location } : null });
  } catch { self.postMessage({ id: data.id, code: null }); }
};
