// Wanderlist includes signups through October 28 in West Hartford's time zone.
export const WANDERLIST_CUTOFF = '2026-10-29T00:00:00-04:00';
export const WANDERLIST_CUTOFF_LABEL = 'October 28, 2026';

export function isWanderlistSignupWindow(now: Date = new Date()) {
  return now.getTime() < new Date(WANDERLIST_CUTOFF).getTime();
}

export function signupSource(now: Date = new Date()) {
  return isWanderlistSignupWindow(now) ? 'Wanderlist' : 'website_signup';
}

/** Imports must retain the original submission time, even when replayed after closing. */
export function resolveSignupTime(submittedAt: unknown, existingCreatedAt?: string, now: Date = new Date()): string | null {
  const submitted = typeof submittedAt === 'string' && submittedAt.trim() ? new Date(submittedAt) : null;
  if (submittedAt != null && (!submitted || !Number.isFinite(submitted.getTime()) || submitted > now)) return null;
  const existing = existingCreatedAt ? new Date(existingCreatedAt) : null;
  const candidates = [submitted, existing].filter((date): date is Date => date !== null && Number.isFinite(date.getTime()));
  if (candidates.length) return new Date(Math.min(...candidates.map((date) => date.getTime()))).toISOString();
  return isWanderlistSignupWindow(now) ? now.toISOString() : null;
}
