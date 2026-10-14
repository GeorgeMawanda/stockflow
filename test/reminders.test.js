import test from 'node:test';
import assert from 'node:assert/strict';
import { toIntl, reminderText } from '../src/reminders.js';

test('converts local numbers to international format', () => assert.equal(toIntl('0772123456'), '+256772123456'));
test('reminder text includes name, business and formatted amount', () => {
  const t = reminderText('Kikuubo Hardware', 'Okello', 120000);
  assert.match(t, /Okello/); assert.match(t, /Kikuubo Hardware/); assert.match(t, /UGX 120,000/);
});
