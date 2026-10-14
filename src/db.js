import pg from 'pg';
pg.types.setTypeParser(20, Number); // bigint -> number (UGX amounts fit safely)
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
