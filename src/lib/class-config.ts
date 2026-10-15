export const CLASS_START_AT = '2026-11-09T00:00:00-05:00';
export const CLASS_START_LABEL = 'the week of November 9, 2026';
export const CLASS_START_NOTE = 'Classes are expected to begin the week of November 9, 2026.';

export function earliestClassTime(now: Date = new Date()) {
  return new Date(Math.max(now.getTime(), new Date(CLASS_START_AT).getTime())).toISOString();
}
