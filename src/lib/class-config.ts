export const CLASS_START_AT = '2026-11-12T00:00:00-05:00';
export const CLASS_START_LABEL = 'November 12, 2026';
export const CLASS_START_NOTE = 'Jamie’s art series starts November 12, 2026. Other classes are planned for the week of November 15, 2026. See each class for confirmed or tentative start dates.';
export const CLASS_PRE_REGISTRATION_NOTE = 'Pre-registration does not reserve or guarantee a spot. Once official registration opens, spots are first come, first served and are confirmed only after payment is completed.';

export function classSizeLabel(capacity: number | null) {
  return capacity == null ? 'Class size TBA' : `Class size: ${capacity} kids`;
}

export function earliestClassTime(now: Date = new Date()) {
  return new Date(Math.max(now.getTime(), new Date(CLASS_START_AT).getTime())).toISOString();
}
