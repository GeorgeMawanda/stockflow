import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMomoSms, normalizePhone } from '../src/momo.js';

test('parses an MTN style message', () => {
  const r = parseMomoSms('You have received UGX 50,000 from +256772123456. TID: 12345678AB');
  assert.deepEqual(r, { amount: 50000, phone: '0772123456', ref: '12345678AB', method: 'mtn_momo' });
});
test('detects Airtel', () => {
  assert.equal(parseMomoSms('Airtel Money: received Ush 8,000 from 0701987654').method, 'airtel_money');
});
test('rejects text without an amount', () => assert.equal(parseMomoSms('hello'), null));
test('normalizes phones', () => {
  assert.equal(normalizePhone('256 772 123 456'), '0772123456');
  assert.equal(normalizePhone('12345'), null);
});
