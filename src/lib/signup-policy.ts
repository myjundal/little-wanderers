// Wanderlist includes signups through October 28 in West Hartford's time zone.
export const WANDERLIST_CUTOFF = '2026-10-29T00:00:00-04:00';
export const WANDERLIST_CUTOFF_LABEL = 'October 28, 2026';

export function isWanderlistSignupWindow(now: Date = new Date()) {
  return now.getTime() < new Date(WANDERLIST_CUTOFF).getTime();
}

export function signupSource(now: Date = new Date()) {
  return isWanderlistSignupWindow(now) ? 'Wanderlist' : 'website_signup';
}
