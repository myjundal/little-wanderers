export const PARTY_BOOKING_START_DATE = '2026-10-16';
export const PARTY_BOOKING_START_LABEL = 'October 16, 2026';

const PARTY_BOOKING_START_MS = Date.parse(`${PARTY_BOOKING_START_DATE}T00:00:00.000Z`);

export function getPartyBookingStartDate() {
  return new Date(PARTY_BOOKING_START_MS);
}

export function isOnOrAfterPartyBookingStart(value: Date | string) {
  const date = value instanceof Date ? value : new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return date.getTime() >= PARTY_BOOKING_START_MS;
}
