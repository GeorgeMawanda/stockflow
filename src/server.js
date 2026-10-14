import { buildApp } from './app.js';
import { pool } from './db.js';
import { runRemindersLocked } from './reminders.js';
import { sendSms } from './sms.js';

const app = await buildApp();
if (process.env.REMINDERS_ENABLED === 'true') {
  const run = () => runRemindersLocked(pool, { send: sendSms, log: app.log }).then((r) => app.log.info(r, 'reminders run')).catch((e) => app.log.error(e));
  setInterval(run, 24 * 60 * 60 * 1000); // daily; first run after one day
}
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
