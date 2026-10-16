import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
export const validStaffPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4}$/.test(pin);
export function hashStaffPin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pin, salt, 64).toString('hex')}`;
}
export function verifyStaffPin(pin: string, stored: string) {
  if (!validStaffPin(pin)) return false;
  const [salt, encoded] = stored.split(':');
  if (!salt || !encoded || !/^[a-f0-9]{128}$/.test(encoded)) return false;
  return timingSafeEqual(scryptSync(pin, salt, 64), Buffer.from(encoded, 'hex'));
}
export const staffTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newStaffToken = () => randomBytes(32).toString('hex');
