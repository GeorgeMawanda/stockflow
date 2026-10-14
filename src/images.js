export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

const signatures = {
  'image/jpeg': (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  'image/png': (data) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (data) => data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
};

export function parseImage({ contentType, data }) {
  if (!IMAGE_TYPES.includes(contentType) || typeof data !== 'string' || data.length > MAX_IMAGE_BASE64
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new TypeError('Invalid image payload');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !signatures[contentType](bytes)) {
    throw new TypeError('Invalid image content');
  }
  return { bytes, contentType };
}
