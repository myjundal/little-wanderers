const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function logSquarePayload(label: string, payload: Record<string, unknown>) {
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

  console.info(`[square] ${label}`, copy);
}
