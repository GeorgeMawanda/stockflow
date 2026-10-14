export const toIntl = (p) => (p ? p.replace(/^0/, '+256') : null);
export const reminderText = (biz, name, owed) =>
  `Hello ${name}, a friendly reminder from ${biz}: your balance is UGX ${Number(owed).toLocaleString('en-US')}. Please pay by MTN MoMo or Airtel Money. Thank you!`;

/** Remind customers whose oldest debt is older than minAgeDays, at most once per cooldownDays. Active tenants only. */
export async function runReminders({ db, send, log, minAgeDays = 7, cooldownDays = 7 }) {
  const { rows } = await db.query(
    `SELECT t.name AS biz, c.id, c.tenant_id, c.name, c.phone, SUM(s.total - COALESCE(p.paid,0)) AS owed
       FROM sales s JOIN customers c ON c.id = s.customer_id JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN (SELECT sale_id, SUM(amount) paid FROM payments GROUP BY sale_id) p ON p.sale_id = s.id
      WHERE c.phone IS NOT NULL AND s.total > COALESCE(p.paid,0) AND (t.trial_ends_at > now() OR t.paid_until > now())
      GROUP BY t.id, c.id
     HAVING MIN(s.created_at) < now() - make_interval(days => $1::int)
        AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.customer_id = c.id AND r.status = 'sent'
                         AND r.sent_at > now() - make_interval(days => $2::int))`, [minAgeDays, cooldownDays]);
  let sent = 0;
  for (const d of rows) {
    let status = 'sent';
    try { await send(toIntl(d.phone), reminderText(d.biz, d.name, d.owed)); sent++; }
    catch (e) { status = 'failed'; log?.warn({ err: e.message, customer: d.id }, 'reminder failed'); }
    await db.query('INSERT INTO reminder_log (tenant_id, customer_id, status) VALUES ($1,$2,$3)', [d.tenant_id, d.id, status]);
  }
  return { due: rows.length, sent };
}

/** Only one app instance runs the job at a time (Postgres advisory lock). */
export async function runRemindersLocked(pool, opts) {
  const c = await pool.connect();
  try {
    if (!(await c.query('SELECT pg_try_advisory_lock(7001) ok')).rows[0].ok) return { skipped: true };
    try { return await runReminders({ db: c, ...opts }); } finally { await c.query('SELECT pg_advisory_unlock(7001)'); }
  } finally { c.release(); }
}
