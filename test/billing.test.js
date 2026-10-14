import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout, extendUntil, isActive, safeEqual } from '../src/billing.js';

const now = new Date('2026-01-01T00:00:00Z');
test('late renewal starts from now', () => {
  assert.equal(extendUntil('2025-12-01T00:00:00Z', now).toISOString(), '2026-01-31T00:00:00.000Z');
});
test('early renewal stacks on remaining time', () => {
  assert.equal(extendUntil('2026-01-10T00:00:00Z', now).toISOString(), '2026-02-09T00:00:00.000Z');
});
test('trial or paid period keeps tenant active', () => {
  assert.equal(isActive({ trial_ends_at: '2026-01-05', paid_until: null }, now), true);
  assert.equal(isActive({ trial_ends_at: '2025-12-01', paid_until: null }, now), false);
  assert.equal(isActive({ trial_ends_at: '2025-12-01', paid_until: '2026-02-01' }, now), true);
});
test('safeEqual compares strings of any length', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
test('billing checkout uses Render URL when APP_URL is not configured', async () => {
  const previous = {
    appUrl: process.env.APP_URL,
    renderUrl: process.env.RENDER_EXTERNAL_URL,
    secret: process.env.FLW_SECRET_KEY,
    fetch: globalThis.fetch,
  };
  let payload;
  try {
    delete process.env.APP_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://stockflow.example/';
    process.env.FLW_SECRET_KEY = 'test-secret';
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ data: { link: 'https://payments.example/checkout' } }), { status: 200 });
    };
    const result = await createCheckout({ tenantId: 'tenant', email: 'owner@example.com', planKey: 'starter' });
    assert.equal(result.link, 'https://payments.example/checkout');
    assert.equal(payload.redirect_url, 'https://stockflow.example/billing/done');
  } finally {
    if (previous.appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous.appUrl;
    if (previous.renderUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previous.renderUrl;
    if (previous.secret === undefined) delete process.env.FLW_SECRET_KEY;
    else process.env.FLW_SECRET_KEY = previous.secret;
    globalThis.fetch = previous.fetch;
  }
});
