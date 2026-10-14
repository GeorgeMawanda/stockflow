import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMAGE_BYTES, parseImage } from '../src/images.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

test('accepts supported image bytes and returns their media type', () => {
  const result = parseImage({ contentType: 'image/png', data: png.toString('base64') });
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(result.bytes, png);
});

test('rejects unsupported, malformed, and mismatched image data', () => {
  assert.throws(() => parseImage({ contentType: 'image/svg+xml', data: png.toString('base64') }), /Invalid image/);
  assert.throws(() => parseImage({ contentType: 'image/png', data: 'not-base64' }), /Invalid image/);
  assert.throws(() => parseImage({ contentType: 'image/png', data: jpeg.toString('base64') }), /Invalid image/);
});

test('rejects empty and oversized images', () => {
  assert.throws(() => parseImage({ contentType: 'image/jpeg', data: '' }), /Invalid image/);
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff);
  assert.throws(() => parseImage({ contentType: 'image/jpeg', data: oversized.toString('base64') }), /Invalid image/);
});
