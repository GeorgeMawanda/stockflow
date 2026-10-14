import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReportRange } from '../src/reports.js';

test('validates inclusive report periods up to 367 days', () => {
  assert.equal(validateReportRange('2026-10-14', '2026-10-14'), true);
  assert.equal(validateReportRange('2025-10-13', '2026-10-14'), true);
  assert.equal(validateReportRange('2025-10-12', '2026-10-14'), false);
});

test('rejects malformed, impossible, and backwards dates', () => {
  assert.equal(validateReportRange('2026-02-30', '2026-03-01'), false);
  assert.equal(validateReportRange('0000-01-01', '0000-01-01'), false);
  assert.equal(validateReportRange('14-10-2026', '2026-10-14'), false);
  assert.equal(validateReportRange('2026-10-15', '2026-10-14'), false);
});
