import { timingSafeEqual } from 'node:crypto';

export const PLANS = {
  starter: { name: 'Starter', price: 20000 }, // UGX per 30 days
  growth: { name: 'Growth', price: 50000 },
};
export const PERIOD_DAYS = 30;
const DAY = 864e5;

/** Renewing early adds time on top of the current expiry; renewing late starts from now. */
export function extendUntil(paidUntil, now = new Date(), days = PERIOD_DAYS) {
  const base = paidUntil && new Date(paidUntil) > now ? new Date(paidUntil) : now;
  return new Date(base.getTime() + days * DAY);
}
export const isActive = (t, now = new Date()) => [t.trial_ends_at, t.paid_until].some((d) => d && new Date(d) > now);

export function safeEqual(a = '', b = '') {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function flw(path, init = {}) {
  if (!process.env.FLW_SECRET_KEY) throw new Error('FLW_SECRET_KEY is required for Flutterwave requests');
  const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Flutterwave ${path} failed with ${res.status}`);
  return res.json();
}

/** Returns a hosted payment link (Mobile Money Uganda or card). */
export async function createCheckout({ tenantId, email, planKey }) {
  const plan = PLANS[planKey];
  const appUrl = process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!appUrl) throw new Error('APP_URL or RENDER_EXTERNAL_URL is required for billing checkout');
  const tx_ref = `sf_${tenantId}_${planKey}_${Date.now()}`;
  const r = await flw('/payments', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref, amount: plan.price, currency: 'UGX',
      redirect_url: `${appUrl.replace(/\/+$/, '')}/billing/done`,
      payment_options: 'mobilemoneyuganda,card',
      customer: { email },
      customizations: { title: `StockFlow UG ${plan.name}` },
    }),
  });
  return { link: r.data.link, tx_ref };
}

/**
 * Never trust the webhook body: confirm the transaction with Flutterwave, then check status,
 * currency, amount and reference before extending the subscription. Safe to receive twice.
 */
export async function handleChargeCompleted(body, log) {
  if (body?.event !== 'charge.completed' || !body.data?.id) return 'ignored';
  const { data: d } = await flw(`/transactions/${body.data.id}/verify`);
  const m = /^sf_([0-9a-f-]{36})_(\w+)_\d+$/.exec(d.tx_ref ?? '');
  const plan = m && PLANS[m[2]];
  if (d.status !== 'successful' || d.currency !== 'UGX' || !plan || d.amount < plan.price) {
    log.warn({ flw_id: d.id, status: d.status, tx_ref: d.tx_ref }, 'billing webhook rejected');
    return 'ignored';
  }
  const { tx } = await import('./db.js'); // lazy: keeps pure helpers importable without a DB
  return tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO billing_events (flw_id, tenant_id, plan, amount, tx_ref) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (flw_id) DO NOTHING RETURNING id`, [d.id, m[1], m[2], d.amount, d.tx_ref]);
    if (!ins.rowCount) return 'duplicate';
    const t = await c.query('SELECT paid_until FROM tenants WHERE id=$1 FOR UPDATE', [m[1]]);
    if (!t.rowCount) return 'ignored';
    await c.query('UPDATE tenants SET plan=$1, paid_until=$2 WHERE id=$3', [m[2], extendUntil(t.rows[0].paid_until), m[1]]);
    return 'activated';
  });
}
