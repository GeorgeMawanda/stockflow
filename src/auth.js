import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw, salt, 64);
  return `${salt.toString('hex')}:${h.toString('hex')}`;
}
export async function verifyPassword(pw, stored) {
  const [s, h] = stored.split(':');
  const calc = await scryptAsync(pw, Buffer.from(s, 'hex'), 64);
  return timingSafeEqual(calc, Buffer.from(h, 'hex'));
}
