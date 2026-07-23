import { logger } from '@/lib/logger';

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SQUARE_API_VERSION = process.env.SQUARE_API_VERSION ?? '2026-07-15';

export function getSquareBaseUrl() {
  if (process.env.SQUARE_BASE_URL) return process.env.SQUARE_BASE_URL;
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

export function normalizeEmail(input: string | null | undefined) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return SIMPLE_EMAIL_REGEX.test(trimmed) ? trimmed : null;
}

export function buildPrePopulatedData(inputEmail: string | null | undefined) {
  const email = normalizeEmail(inputEmail);
  if (!email) return undefined;
  return { buyer_email: email };
}

export function logSquarePayload(label: string, payload: Record<string, unknown>, context?: { userId?: string | null; householdId?: string | null }) {
  const copy: Record<string, unknown> = { ...payload };
  if (typeof copy.idempotency_key === 'string') {
    copy.idempotency_key = '[redacted]';
  }

  const pre = copy.pre_populated_data as { buyer_email?: string } | undefined;
  if (pre?.buyer_email) {
    const [name, domain] = pre.buyer_email.split('@');
    const masked = name.length <= 2 ? `${name[0] ?? '*'}*` : `${name.slice(0, 2)}***`;
    copy.pre_populated_data = { buyer_email: `${masked}@${domain}` };
  }

  logger.info({
    action: 'square.payload_prepared',
    squareLabel: label,
    userId: context?.userId ?? null,
    householdId: context?.householdId ?? null,
    payload: copy,
  });
}
