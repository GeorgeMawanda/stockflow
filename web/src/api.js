const KEY = 'stockflow-token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));
export const fmt = (n) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-US');

const authHeaders = () => getToken() ? { Authorization: 'Bearer ' + getToken() } : {};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) { setToken(null); location.reload(); }
  if (!res.ok) throw new Error(data.error === 'validation' ? 'Please check the fields and try again.' : data.error || 'Something went wrong');
  return data;
}

export async function apiBlob(path) {
  const res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  if (res.status === 401 && getToken()) { setToken(null); location.reload(); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Unable to load image');
  }
  return res.blob();
}

export async function prepareImage(file, maxDimension = 960) {
  const supported = ['image/jpeg', 'image/png', 'image/webp'];
  if (!supported.includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photo smaller than 12 MB.');

  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This image could not be opened. Try another photo.'); }

  try {
    let scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height);
    let blob;
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Photo processing is unavailable in this browser.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82 - attempt * 0.07));
      if (!blob) throw new Error('This photo could not be compressed. Try another image.');
      if (blob.size <= 512 * 1024) break;
      scale *= 0.8;
    }
    if (!blob || blob.size > 512 * 1024) throw new Error('This photo is too detailed to upload. Choose a smaller image.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('This photo could not be read.'));
      reader.readAsDataURL(blob);
    });
    return { contentType: 'image/jpeg', data };
  } finally {
    bitmap.close();
  }
}
