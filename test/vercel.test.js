import test from 'node:test';
import assert from 'node:assert/strict';

test('Vercel reminder cron requires authorization and enabled reminders', async (t) => {
  const previous = {
    JWT_SECRET: process.env.JWT_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    REMINDERS_ENABLED: process.env.REMINDERS_ENABLED,
  };
  process.env.JWT_SECRET = 'test-secret-test-secret';
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.REMINDERS_ENABLED = 'false';

  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({ serveFrontend: false });
  t.after(() => app.close());

  assert.equal((await app.inject({ method: 'GET', url: '/internal/cron/reminders' })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'GET',
    url: '/internal/cron/reminders',
    headers: { authorization: 'Bearer test-cron-secret' },
  })).statusCode, 503);
});
