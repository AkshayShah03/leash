import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'leash_owner';
const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

export function signSession(secret: string, now: number, ttlMs = 12 * 60 * 60 * 1000): string {
  const exp = String(now + ttlMs);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(secret: string, token: string | undefined, now: number): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return false;
  const expected = Buffer.from(mac(secret, parts[0]), 'hex');
  const given = Buffer.from(parts[1], 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given) && Number(parts[0]) > now;
}
