export const CLASS_START_AT = '2026-11-12T00:00:00-05:00';
export const CLASS_START_LABEL = 'November 12, 2026';
export const CLASS_START_NOTE = 'Classes run November 16–December 17, 2026. No classes on November 26 (Thanksgiving). Ms. Jamie’s art series starts November 12.';
export const CLASS_TERM_END_AT = '2026-12-18T00:00:00-05:00';
export const CLASS_HOLIDAY_DATE = '2026-11-26';
export const CLASS_PRE_REGISTRATION_NOTE = 'Pay at the counter before class, subject to availability, or pay now to confirm your seat. A seat is confirmed only after payment is completed. Spaces are limited and first come, first served by completed payment.';
export const CLASS_PAY_AT_COUNTER_NOTE = 'Payment choice: Pay at counter. Payment is required before participation; a seat is not reserved until payment.';

export function classSizeLabel(capacity: number | null) {
  return capacity == null ? 'Class size TBA' : `Class size: ${capacity} kids`;
}

export function earliestClassTime(now: Date = new Date()) {
  return new Date(Math.max(now.getTime(), new Date(CLASS_START_AT).getTime())).toISOString();
}
