import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUuid } from '@/lib/open-play-reservations';

const signature = (payload: string) => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Square return verification is unavailable.');
  return createHmac('sha256', key).update(`square-pos-return-v1:${payload}`).digest('base64url');
};

/** Receipt reconciliation capability only; never a staff login or account token. */
export function createPosReturnState(saleId: string, now = Date.now()) {
  const payload = `${saleId}.${Math.floor(now / 1000) + 86400}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyPosReturnState(token: unknown, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 150) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !isUuid(parts[0]) || !/^\d{10}$/.test(parts[1]) || !/^[\w-]{43}$/.test(parts[2])) return null;
  const expiry = Number(parts[1]) * 1000;
  if (expiry <= now || expiry > now + 86401000) return null;
  const expected = Buffer.from(signature(`${parts[0]}.${parts[1]}`));
  const supplied = Buffer.from(parts[2]);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? parts[0] : null;
}
