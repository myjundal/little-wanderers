export const WAITLIST_JOIN_URL = process.env.NEXT_PUBLIC_WAITLIST_URL || 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeWaitlistEmail(input: string) {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, '');
  const atIndex = trimmed.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === trimmed.length - 1) return '';

  let local = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  if (domain === 'googlemail.com') domain = 'gmail.com';

  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split('+')[0].replace(/\./g, '');
  }

  return `${local}@${domain}`;
}

export function isLikelyEmail(input: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}
