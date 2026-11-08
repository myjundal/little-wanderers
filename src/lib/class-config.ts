export const CLASS_START_AT = '2026-11-12T00:00:00-05:00';
export const CLASS_START_LABEL = 'November 12, 2026';
export const CLASS_START_NOTE = 'Jamie’s art series starts November 12, 2026. Other classes are planned for the week of November 15, 2026. See each class for confirmed or tentative start dates.';
export const CLASS_PRE_REGISTRATION_NOTE = 'I’m interested records interest only and does not reserve or guarantee a spot. Spaces are limited and first come, first served by completed payment. Your place is confirmed only after payment is completed; choose Pay now to reserve seat when paid registration is available.';

export function classSizeLabel(capacity: number | null) {
  return capacity == null ? 'Class size TBA' : `Class size: ${capacity} kids`;
}

export function earliestClassTime(now: Date = new Date()) {
  return new Date(Math.max(now.getTime(), new Date(CLASS_START_AT).getTime())).toISOString();
}
