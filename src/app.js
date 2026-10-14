import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { parseMomoSms, normalizePhone } from './momo.js';
import { applyToCustomer } from './payments.js';
import { sendSms } from './sms.js';
import { reminderText, toIntl } from './reminders.js';
import { PLANS, isActive, createCheckout, handleChargeCompleted, safeEqual } from './billing.js';
import { IMAGE_TYPES, MAX_IMAGE_BASE64, parseImage } from './images.js';
import { buildBusinessReport, validateReportRange } from './reports.js';
import { getAiConfig, getAiSuggestion, localSuggestions } from './assistant.js';

export async function buildApp() {
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) {
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3');
}
const app = Fastify({ logger: true, trustProxy: trustProxyHops || false });
await app.register(helmet);
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(jwt, { secret: process.env.JWT_SECRET });
const webDist = resolve(fileURLToPath(new URL('../web/dist/', import.meta.url)));
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.get('/billing/done', async (_req, reply) => reply.sendFile('index.html'));
}
else if (process.env.NODE_ENV === 'production') throw new Error('Frontend build missing; run npm --prefix web run build');

app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err);
  reply.code(500).send({ error: 'internal' });
});
const fail = (code, msg) => Object.assign(new Error(msg), { statusCode: code });
const tokenFor = (u) => app.jwt.sign({ uid: u.id, tid: u.tenant_id, role: u.role }, { expiresIn: '12h' });
const METHODS = z.enum(['cash', 'mtn_momo', 'airtel_money']);
const imageInput = z.object({
  contentType: z.enum(IMAGE_TYPES),
  data: z.string().min(8).max(MAX_IMAGE_BASE64),
});
const imageFrom = (input) => {
  try { return parseImage(input); }
  catch { throw fail(400, 'Use a JPG, PNG or WebP image up to 512 KB.'); }
};
const sendImage = (reply, image) => reply.type(image.photo_type).header('Cache-Control', 'private, max-age=300').send(image.photo_data);

app.get('/health', async () => (await pool.query('SELECT 1'), { ok: true }));

// ---------- Auth ----------
const creds = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(8) });
app.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const b = creds.extend({ business: z.string().min(2) }).parse(req.body);
  const user = await tx(async (c) => {
    const t = await c.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [b.business]);
    const u = await c.query('INSERT INTO users (tenant_id,email,pass_hash) VALUES ($1,$2,$3) RETURNING id, tenant_id, role',
      [t.rows[0].id, b.email, await hashPassword(b.password)]);
    return u.rows[0];
  }).catch((e) => { throw e.code === '23505' ? fail(409, 'Email already registered') : e; });
  reply.code(201).send({ token: tokenFor(user) });
});
app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
  const b = creds.parse(req.body);
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [b.email]);
  if (!rows[0] || !(await verifyPassword(b.password, rows[0].pass_hash))) throw fail(401, 'Invalid email or password');
  return { token: tokenFor(rows[0]) };
});

// ---------- Authenticated, tenant-scoped API ----------
const owedQuery = `SELECT c.id, c.name, c.phone, SUM(s.total - COALESCE(p.paid,0)) AS owed, MIN(s.created_at) AS oldest
    FROM sales s JOIN customers c ON c.id = s.customer_id
    LEFT JOIN (SELECT sale_id, SUM(amount) paid FROM payments GROUP BY sale_id) p ON p.sale_id = s.id
   WHERE s.tenant_id=$1 AND s.total > COALESCE(p.paid,0)
   GROUP BY c.id ORDER BY oldest`;

await app.register(async (api) => {
  const readOnlyPostPaths = new Set(['/api/assistant/suggestions']);
  api.addHook('onRequest', async (req) => {
    try { await req.jwtVerify(); } catch { throw fail(401, 'Unauthorized'); }
    // Lapsed subscriptions can still read and export their data, but cannot write.
    if (req.method !== 'GET' && !req.url.startsWith('/api/billing') && !readOnlyPostPaths.has(req.url.split('?')[0])) {
      const { rows } = await pool.query('SELECT trial_ends_at, paid_until FROM tenants WHERE id=$1', [req.user.tid]);
      if (!rows[0] || !isActive(rows[0])) throw fail(402, 'Subscription expired. Renew to record new sales.');
    }
  });

  api.get('/billing/status', async (req) => {
    const { rows } = await pool.query(
      'SELECT name, district, business_phone, (logo_data IS NOT NULL) AS has_logo, plan, trial_ends_at, paid_until FROM tenants WHERE id=$1',
      [req.user.tid]);
    return { ...rows[0], active: isActive(rows[0]), plans: PLANS };
  });
  api.patch('/business/profile', async (req) => {
    const b = z.object({
      name: z.string().trim().min(2).max(120),
      district: z.string().trim().max(100).default(''),
      phone: z.string().trim().max(24).default(''),
    }).parse(req.body);
    const phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !phone) throw fail(400, 'Enter a valid Ugandan mobile number, for example 0772 123456.');
    const { rows } = await pool.query(
      'UPDATE tenants SET name=$1, district=$2, business_phone=$3 WHERE id=$4 RETURNING name, district, business_phone',
      [b.name, b.district || null, phone, req.user.tid]);
    return rows[0];
  });
  api.get('/business/logo', async (req, reply) => {
    const { rows } = await pool.query('SELECT logo_data AS photo_data, logo_type AS photo_type FROM tenants WHERE id=$1', [req.user.tid]);
    if (!rows[0]?.photo_data) throw fail(404, 'Business logo not found');
    return sendImage(reply, rows[0]);
  });
  api.put('/business/logo', async (req, reply) => {
    const image = imageFrom(imageInput.parse(req.body));
    const { rows } = await pool.query(
      'UPDATE tenants SET logo_data=$1, logo_type=$2 WHERE id=$3 RETURNING TRUE AS saved',
      [image.bytes, image.contentType, req.user.tid]);
    if (!rows[0]) throw fail(404, 'Business not found');
    return { saved: true };
  });
  api.delete('/business/logo', async (req) => {
    await pool.query('UPDATE tenants SET logo_data=NULL, logo_type=NULL WHERE id=$1', [req.user.tid]);
    return { removed: true };
  });
  api.post('/billing/checkout', async (req) => {
    const { plan } = z.object({ plan: z.enum(Object.keys(PLANS)) }).parse(req.body);
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [req.user.uid]);
    return createCheckout({ tenantId: req.user.tid, email: u.rows[0].email, planKey: plan });
  });
  const reportQuery = z.object({ from: z.string().optional(), to: z.string().optional() });
  const reportFor = async (query, tenantId) => {
    const parsed = reportQuery.parse(query);
    const to = parsed.to || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
    if (!validateReportRange(to, to)) throw fail(400, 'Choose a valid report period of up to 367 days.');
    const from = parsed.from || new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
    if (!validateReportRange(from, to)) throw fail(400, 'Choose a valid report period of up to 367 days.');
    return buildBusinessReport(pool, tenantId, from, to);
  };
  api.get('/reports', async (req) => reportFor(req.query, req.user.tid));
  api.post('/assistant/suggestions', async (req) => {
    const { from, to, question = '' } = z.object({
      from: z.string().optional(), to: z.string().optional(), question: z.string().trim().max(500).default(''),
    }).parse(req.body);
    const report = await reportFor({ from, to }, req.user.tid);
    const rules = localSuggestions(report);
    const ai = await getAiSuggestion(report, question);
    if (ai.warning) req.log.warn({ warning: ai.warning }, 'business assistant AI unavailable');
    return { suggestions: rules, ai, period: report.period };
  });

  api.get('/items', async (req) => (await pool.query(
    'SELECT id, tenant_id, name, qty, cost, price, min_qty, (photo_type IS NOT NULL) AS has_photo FROM items WHERE tenant_id=$1 ORDER BY name',
    [req.user.tid])).rows);
  api.get('/items/:id/photo', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT photo_data, photo_type FROM items WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tid]);
    if (!rows[0]?.photo_data) throw fail(404, 'Product photo not found');
    return sendImage(reply, rows[0]);
  });
  api.put('/items/:id/photo', async (req) => {
    const image = imageFrom(imageInput.parse(req.body));
    const { rows } = await pool.query(
      'UPDATE items SET photo_data=$1, photo_type=$2 WHERE id=$3 AND tenant_id=$4 RETURNING id',
      [image.bytes, image.contentType, req.params.id, req.user.tid]);
    if (!rows[0]) throw fail(404, 'Item not found');
    return { saved: true };
  });
  api.delete('/items/:id/photo', async (req) => {
    const { rows } = await pool.query(
      'UPDATE items SET photo_data=NULL, photo_type=NULL WHERE id=$1 AND tenant_id=$2 RETURNING id',
      [req.params.id, req.user.tid]);
    if (!rows[0]) throw fail(404, 'Item not found');
    return { removed: true };
  });
  api.get('/items/low-stock', async (req) =>
    (await pool.query(
      'SELECT id, tenant_id, name, qty, cost, price, min_qty, (photo_type IS NOT NULL) AS has_photo FROM items WHERE tenant_id=$1 AND qty <= min_qty ORDER BY qty',
      [req.user.tid])).rows);
  api.post('/items', async (req, reply) => {
    const b = z.object({ name: z.string().min(1), qty: z.number().int().min(0), cost: z.number().int().min(0),
      price: z.number().int().min(0), minQty: z.number().int().min(0).default(5), photo: imageInput.optional() }).parse(req.body);
    const photo = b.photo && imageFrom(b.photo);
    const { rows } = await pool.query(
      `INSERT INTO items (tenant_id,name,qty,cost,price,min_qty,photo_data,photo_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, tenant_id, name, qty, cost, price, min_qty, (photo_type IS NOT NULL) AS has_photo`,
      [req.user.tid, b.name, b.qty, b.cost, b.price, b.minQty, photo?.bytes ?? null, photo?.contentType ?? null]
    ).catch((e) => { throw e.code === '23505' ? fail(409, 'Item already exists') : e; });
    reply.code(201).send(rows[0]);
  });
  api.post('/items/:id/restock', async (req) => {
    const { qty } = z.object({ qty: z.number().int().positive() }).parse(req.body);
    const { rows } = await pool.query(
      'UPDATE items SET qty=qty+$1 WHERE id=$2 AND tenant_id=$3 RETURNING id, tenant_id, name, qty, cost, price, min_qty',
      [qty, req.params.id, req.user.tid]);
    if (!rows[0]) throw fail(404, 'Item not found');
    return rows[0];
  });

  // Prices come from the database, never the client. Stock rows are locked to prevent overselling.
  api.post('/sales', async (req, reply) => {
    const b = z.object({
      customer: z.object({ name: z.string().min(1), phone: z.string().optional() }).optional(),
      lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().positive() })).min(1),
      paid: z.number().int().min(0).optional(), // omitted = paid in full; 0 = full credit
      method: METHODS.default('cash'),
      ref: z.string().optional(),
    }).parse(req.body);
    const tid = req.user.tid;
    const out = await tx(async (c) => {
      const ids = [...new Set(b.lines.map((l) => l.itemId))];
      const { rows: items } = await c.query(
        'SELECT id, tenant_id, name, qty, cost, price, min_qty FROM items WHERE tenant_id=$1 AND id = ANY($2) ORDER BY id FOR UPDATE',
        [tid, ids]);
      const byId = new Map(items.map((i) => [i.id, i]));
      const need = new Map();
      let total = 0;
      for (const l of b.lines) {
        const i = byId.get(l.itemId);
        if (!i) throw fail(404, 'Item not found');
        const q = (need.get(i.id) ?? 0) + l.qty;
        if (i.qty < q) throw fail(409, `Only ${i.qty} of ${i.name} in stock`);
        need.set(i.id, q); total += l.qty * i.price;
      }
      const paid = Math.min(b.paid ?? total, total);
      let customerId = null;
      if (b.customer) {
        const phone = normalizePhone(b.customer.phone);
        const r = phone
          ? await c.query(`INSERT INTO customers (tenant_id,name,phone) VALUES ($1,$2,$3)
                           ON CONFLICT (tenant_id, phone) WHERE phone IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`, [tid, b.customer.name, phone])
          : await c.query('INSERT INTO customers (tenant_id,name) VALUES ($1,$2) RETURNING id', [tid, b.customer.name]);
        customerId = r.rows[0].id;
      }
      if (paid < total && !customerId) throw fail(400, 'A customer is required for credit sales');
      const s = await c.query('INSERT INTO sales (tenant_id,customer_id,total,created_by) VALUES ($1,$2,$3,$4) RETURNING id', [tid, customerId, total, req.user.uid]);
      for (const l of b.lines) {
        const i = byId.get(l.itemId);
        await c.query('INSERT INTO sale_lines (sale_id,item_id,name,qty,price,cost) VALUES ($1,$2,$3,$4,$5,$6)', [s.rows[0].id, i.id, i.name, l.qty, i.price, i.cost]);
        await c.query('UPDATE items SET qty=qty-$1 WHERE id=$2', [l.qty, i.id]);
      }
      if (paid > 0) await c.query('INSERT INTO payments (tenant_id,sale_id,amount,method,ref) VALUES ($1,$2,$3,$4,$5)', [tid, s.rows[0].id, paid, b.method, b.ref ?? null]);
      return { id: s.rows[0].id, total, paid, balance: total - paid };
    });
    reply.code(201).send(out);
  });

  api.get('/credit', async (req) => (await pool.query(owedQuery, [req.user.tid])).rows);

  api.post('/credit/:customerId/remind', async (req) => {
    const d = (await pool.query(owedQuery, [req.user.tid])).rows.find((r) => r.id === req.params.customerId);
    if (!d) throw fail(404, 'This customer owes nothing');
    if (!d.phone) throw fail(422, 'This customer has no phone number');
    const biz = (await pool.query('SELECT name FROM tenants WHERE id=$1', [req.user.tid])).rows[0].name;
    try { await sendSms(toIntl(d.phone), reminderText(biz, d.name, d.owed)); }
    catch (e) { req.log.warn(e.message); throw fail(502, 'SMS could not be sent'); }
    await pool.query("INSERT INTO reminder_log (tenant_id, customer_id, status) VALUES ($1,$2,'sent')", [req.user.tid, d.id]);
    return { sent: true };
  });

  api.post('/payments', async (req) => {
    const b = z.object({ customerId: z.string().uuid(), amount: z.number().int().positive(), method: METHODS, ref: z.string().optional() }).parse(req.body);
    const r = await tx((c) => applyToCustomer(c, { tenantId: req.user.tid, ...b }));
    if (r.duplicate) throw fail(409, 'This Mobile Money ID was already recorded');
    return r;
  });

  // Paste a MoMo SMS: returns parsed data and likely debtors (phone match first, then exact amount).
  api.post('/payments/mobile-money/match', async (req) => {
    const { sms } = z.object({ sms: z.string().min(5) }).parse(req.body);
    const p = parseMomoSms(sms);
    if (!p) throw fail(422, 'No amount found in message');
    const owed = (await pool.query(owedQuery, [req.user.tid])).rows;
    const score = (d) => (p.phone && d.phone === p.phone ? 2 : 0) + (Number(d.owed) === p.amount ? 1 : 0);
    return { parsed: p, candidates: owed.sort((a, b) => score(b) - score(a)).slice(0, 5) };
  });
}, { prefix: '/api' });

// Flutterwave calls this after a payment. The shared secret hash must match; the charge is then re-verified server-side.
app.post('/webhooks/flutterwave', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
  if (!process.env.FLW_WEBHOOK_HASH || !safeEqual(req.headers['verif-hash'], process.env.FLW_WEBHOOK_HASH)) return reply.code(401).send();
  const result = await handleChargeCompleted(req.body, req.log); // throws on network error so Flutterwave retries
  return { result };
});

return app;
}
