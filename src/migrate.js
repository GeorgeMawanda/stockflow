import { readFileSync } from 'node:fs';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await c.connect();
  await c.query('SELECT pg_advisory_lock(53100214)');
  try {
    await c.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  } finally {
    await c.query('SELECT pg_advisory_unlock(53100214)');
  }
  console.log('Schema applied.');
} finally {
  await c.end();
}
