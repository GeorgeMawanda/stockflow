/**
 * Apply an incoming payment to a customer's unpaid sales, oldest first.
 * Runs inside a transaction. Idempotent per (tenant, ref): a reused Mobile Money ID is rejected.
 */
export async function applyToCustomer(c, { tenantId, customerId, amount, method, ref }) {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [customerId]);
  if (ref) {
    const dup = await c.query('SELECT 1 FROM payments WHERE tenant_id=$1 AND ref=$2 LIMIT 1', [tenantId, ref]);
    if (dup.rowCount) return { duplicate: true };
  }
  const { rows } = await c.query(
    `SELECT s.id, s.total - COALESCE(SUM(p.amount),0) AS balance
       FROM sales s LEFT JOIN payments p ON p.sale_id = s.id
      WHERE s.tenant_id=$1 AND s.customer_id=$2
      GROUP BY s.id HAVING s.total - COALESCE(SUM(p.amount),0) > 0
      ORDER BY s.created_at`, [tenantId, customerId]);
  let left = amount;
  for (const s of rows) {
    if (left <= 0) break;
    const a = Math.min(left, Number(s.balance));
    await c.query('INSERT INTO payments (tenant_id, sale_id, amount, method, ref) VALUES ($1,$2,$3,$4,$5)',
      [tenantId, s.id, a, method, ref ?? null]);
    left -= a;
  }
  return { applied: amount - left, leftover: left };
}
