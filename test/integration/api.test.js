// Needs a real Postgres: DATABASE_URL_TEST=postgres://... npm test. Skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const URL_ = process.env.DATABASE_URL_TEST;
const opts = { skip: URL_ ? false : 'DATABASE_URL_TEST not set' };

test('API end to end', opts, async (t) => {
  process.env.DATABASE_URL = URL_;
  process.env.JWT_SECRET = 'test-secret-test-secret';
  const { buildApp } = await import('../../src/app.js');
  const { pool } = await import('../../src/db.js');
  await pool.query(readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
  const app = await buildApp();
  const call = async (method, url, token, payload) =>
    app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const signup = async (tag) => (await call('POST', '/auth/register', null,
    { business: `Shop ${tag}`, email: `${tag}-${Date.now()}@test.ug`, password: 'password123' })).json().token;
  const A = await signup('a'), B = await signup('b');

  await t.test('rejects missing token', async () => assert.equal((await call('GET', '/api/items')).statusCode, 401));

  const item = (await call('POST', '/api/items', A, { name: 'Cement', qty: 10, cost: 31000, price: 34000, minQty: 3 })).json();
  await t.test('tenants are isolated', async () => {
    assert.equal((await call('GET', '/api/items', B)).json().length, 0);
    assert.equal((await call('POST', `/api/items/${item.id}/restock`, B, { qty: 5 })).statusCode, 404);
  });
  await t.test('prevents overselling', async () =>
    assert.equal((await call('POST', '/api/sales', A, { lines: [{ itemId: item.id, qty: 11 }] })).statusCode, 409));
  await t.test('credit sale -> debt -> MoMo payment -> duplicate rejected', async () => {
    const s = await call('POST', '/api/sales', A, { customer: { name: 'Okello', phone: '0772123456' }, lines: [{ itemId: item.id, qty: 5 }], paid: 50000 });
    assert.equal(s.statusCode, 201);
    assert.deepEqual([s.json().total, s.json().balance], [170000, 120000]);
    const credit = (await call('GET', '/api/credit', A)).json();
    assert.equal(Number(credit[0].owed), 120000);
    const match = (await call('POST', '/api/payments/mobile-money/match', A, { sms: 'You have received UGX 120,000 from 0772123456. TID: ABC123XYZ' })).json();
    assert.equal(match.candidates[0].id, credit[0].id);
    const pay = { customerId: credit[0].id, amount: 120000, method: 'mtn_momo', ref: 'ABC123XYZ' };
    assert.equal((await call('POST', '/api/payments', A, pay)).statusCode, 200);
    assert.equal((await call('POST', '/api/payments', A, pay)).statusCode, 409);
    assert.equal((await call('GET', '/api/credit', A)).json().length, 0);
  });
  await t.test('reports and assistant use the selected period and tenant only', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
    const params = `from=${today}&to=${today}`;
    const report = await call('GET', `/api/reports?${params}`, A);
    assert.equal(report.statusCode, 200);
    assert.equal(report.json().sales.count, 1);
    assert.equal(report.json().sales.total, 170000);
    assert.equal(report.json().sales.gross_profit, 15000);
    assert.equal(report.json().collections.reduce((sum, row) => sum + Number(row.total), 0), 170000);
    assert.equal(report.json().topProducts[0].quantity, 5);
    assert.equal(report.json().receivables.total, 0);
    const empty = await call('GET', `/api/reports?${params}`, B);
    assert.equal(empty.json().sales.count, 0);
    const assistant = await call('POST', '/api/assistant/suggestions', A, {
      from: today, to: today, question: 'How can I manage cash?',
    });
    assert.equal(assistant.statusCode, 200);
    assert.ok(assistant.json().suggestions.length > 0);
    const invalid = await call('GET', '/api/reports?from=2026-02-30&to=2026-03-01', A);
    assert.equal(invalid.statusCode, 400);
  });
  await t.test('business profile and photos are validated and tenant-scoped', async () => {
    const profile = await call('PATCH', '/api/business/profile', A, {
      name: 'Shop a', district: 'Wakiso', phone: '+256 772 123456',
    });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().business_phone, '0772123456');
    const invalidPhone = await call('PATCH', '/api/business/profile', A, {
      name: 'Shop a', district: '', phone: '123',
    });
    assert.equal(invalidPhone.statusCode, 400);

    const image = { contentType: 'image/png', data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64') };
    const logo = await call('PUT', '/api/business/logo', A, image);
    assert.equal(logo.statusCode, 200);
    const status = await call('GET', '/api/billing/status', A);
    assert.equal(status.json().name, 'Shop a');
    assert.equal(status.json().district, 'Wakiso');
    assert.equal(status.json().has_logo, true);
    const logoImage = await call('GET', '/api/business/logo', A);
    assert.equal(logoImage.headers['content-type'], 'image/png');
    assert.deepEqual(logoImage.rawPayload, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    assert.equal((await call('GET', '/api/business/logo', B)).statusCode, 404);

    const badImage = await call('PUT', '/api/business/logo', A, { ...image, contentType: 'image/jpeg' });
    assert.equal(badImage.statusCode, 400);
    assert.equal((await call('PUT', `/api/items/${item.id}/photo`, A, image)).statusCode, 200);
    assert.equal((await call('GET', `/api/items/${item.id}/photo`, B)).statusCode, 404);
    assert.equal((await call('GET', `/api/items/${item.id}/photo`, A)).statusCode, 200);
    const withPhoto = await call('POST', '/api/items', A, {
      name: 'Torch', qty: 2, cost: 5000, price: 7000, photo: image,
    });
    assert.equal(withPhoto.statusCode, 201);
    assert.equal(withPhoto.json().has_photo, true);
    assert.equal(Object.hasOwn(withPhoto.json(), 'photo_data'), false);
    const listed = await call('GET', '/api/items', A);
    assert.equal(listed.json().find((row) => row.id === item.id).has_photo, true);
    assert.equal(Object.hasOwn(listed.json()[0], 'photo_data'), false);
    assert.equal((await call('DELETE', `/api/items/${item.id}/photo`, A)).statusCode, 200);
    assert.equal((await call('DELETE', `/api/items/${withPhoto.json().id}/photo`, A)).statusCode, 200);
    assert.equal((await call('DELETE', '/api/business/logo', A)).statusCode, 200);
  });
  await t.test('expired subscription blocks writes but not reads', async () => {
    await pool.query("UPDATE tenants SET trial_ends_at = now() - interval '1 day' WHERE name = 'Shop a'");
    assert.equal((await call('POST', '/api/items/' + item.id + '/restock', A, { qty: 1 })).statusCode, 402);
    assert.equal((await call('GET', '/api/items', A)).statusCode, 200);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
    assert.equal((await call('GET', `/api/reports?from=${today}&to=${today}`, A)).statusCode, 200);
    assert.equal((await call('POST', '/api/assistant/suggestions', A, { from: today, to: today })).statusCode, 200);
  });
  await t.test('webhook rejects a bad hash', async () => {
    process.env.FLW_WEBHOOK_HASH = 'good';
    const r = await app.inject({ method: 'POST', url: '/webhooks/flutterwave', payload: {}, headers: { 'verif-hash': 'bad' } });
    assert.equal(r.statusCode, 401);
  });
  await app.close(); await pool.end();
});
