const kampalaDate = (column, parameter) =>
  `${column} >= ($${parameter}::date::timestamp AT TIME ZONE 'Africa/Kampala')`;
const beforeNextDay = (column, parameter) =>
  `${column} < (($${parameter}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Africa/Kampala')`;

export async function buildBusinessReport(db, tenantId, from, to) {
  const sales = (await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(s.total),0) AS total,
            COALESCE(SUM(s.total - COALESCE(costs.total_cost,0)),0) AS gross_profit
       FROM sales s
       LEFT JOIN (SELECT sale_id, SUM(qty * cost) AS total_cost FROM sale_lines GROUP BY sale_id) costs ON costs.sale_id=s.id
      WHERE s.tenant_id=$1 AND ${kampalaDate('s.created_at', 2)} AND ${beforeNextDay('s.created_at', 3)}`,
    [tenantId, from, to])).rows[0];

  const collections = (await db.query(
    `SELECT method, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count
       FROM payments
      WHERE tenant_id=$1 AND ${kampalaDate('created_at', 2)} AND ${beforeNextDay('created_at', 3)}
      GROUP BY method ORDER BY method`,
    [tenantId, from, to])).rows;

  const daily = (await db.query(
    `WITH days AS (
       SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS day
     ), sale_totals AS (
       SELECT (s.created_at AT TIME ZONE 'Africa/Kampala')::date AS day,
              COUNT(*)::int AS count, SUM(s.total) AS total
         FROM sales s
        WHERE s.tenant_id=$1 AND ${kampalaDate('s.created_at', 2)} AND ${beforeNextDay('s.created_at', 3)}
        GROUP BY 1
     ), payment_totals AS (
       SELECT (p.created_at AT TIME ZONE 'Africa/Kampala')::date AS day, SUM(p.amount) AS total
         FROM payments p
        WHERE p.tenant_id=$1 AND ${kampalaDate('p.created_at', 2)} AND ${beforeNextDay('p.created_at', 3)}
        GROUP BY 1
     )
     SELECT to_char(days.day,'YYYY-MM-DD') AS day,
            COALESCE(sale_totals.count,0)::int AS sales,
            COALESCE(sale_totals.total,0) AS sales_total,
            COALESCE(payment_totals.total,0) AS collected
       FROM days LEFT JOIN sale_totals USING(day) LEFT JOIN payment_totals USING(day)
      ORDER BY days.day`,
    [tenantId, from, to])).rows;

  const topProducts = (await db.query(
    `SELECT sl.name, SUM(sl.qty)::int AS quantity, SUM(sl.qty * sl.price) AS revenue
       FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
      WHERE s.tenant_id=$1 AND ${kampalaDate('s.created_at', 2)} AND ${beforeNextDay('s.created_at', 3)}
      GROUP BY sl.name ORDER BY quantity DESC, revenue DESC LIMIT 10`,
    [tenantId, from, to])).rows;

  const inventory = (await db.query(
    `SELECT COUNT(*)::int AS products,
            COUNT(*) FILTER (WHERE qty <= min_qty)::int AS low_stock,
            COALESCE(SUM(qty * cost),0) AS cost_value,
            COALESCE(SUM(qty * price),0) AS retail_value
       FROM items WHERE tenant_id=$1`, [tenantId])).rows[0];

  const receivables = (await db.query(
    `SELECT COUNT(*)::int AS customers, COALESCE(SUM(debts.owed),0) AS total
       FROM (
         SELECT c.id, SUM(s.total - COALESCE(p.paid,0)) AS owed
           FROM sales s JOIN customers c ON c.id=s.customer_id
           LEFT JOIN (SELECT sale_id, SUM(amount) AS paid FROM payments GROUP BY sale_id) p ON p.sale_id=s.id
          WHERE s.tenant_id=$1 AND s.total > COALESCE(p.paid,0)
          GROUP BY c.id
       ) debts`, [tenantId])).rows[0];

  return { period: { from, to }, sales, collections, daily, topProducts, inventory, receivables };
}

export function validateReportRange(from, to) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const valid = (value) => datePattern.test(value) && Number(value.slice(0, 4)) > 0
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) return false;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 <= 366;
}
