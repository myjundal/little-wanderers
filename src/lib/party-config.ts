export const PARTY_BOOKING_START_DATE = '2026-10-16';
export const PARTY_BOOKING_START_LABEL = 'October 16, 2026';
export const GRANDFATHERED_FRIDAY_MORNING_PARTY_DATE = '2027-01-29';

export type PartyBookingSlot = '10:00' | '15:00';

export const PARTY_BOOKING_SLOTS: Array<{
  value: PartyBookingSlot;
  startHour: number;
  endHour: number;
  label: string;
}> = [
  { value: '10:00', startHour: 10, endHour: 13, label: '10:00 AM - 1:00 PM' },
  { value: '15:00', startHour: 15, endHour: 18, label: '3:00 PM - 6:00 PM' },
];

const PARTY_BOOKING_START_MS = Date.parse(`${PARTY_BOOKING_START_DATE}T00:00:00.000Z`);
const PARTY_TIME_ZONE = 'America/New_York';

export function getPartyBookingStartDate() {
  return new Date(PARTY_BOOKING_START_MS);
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getEasternDateParts(value: Date | string) {
  if (typeof value === 'string' && isDateOnly(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return { year, month, day, hour: 0 };
  }

  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PARTY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
  };
}

function getPartyDateKey(value: Date | string) {
  const parts = getEasternDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getPartyWeekday(value: Date | string) {
  const parts = getEasternDateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function getPartySlotFromStart(value: Date | string): PartyBookingSlot | null {
  const hour = getEasternDateParts(value).hour;
  if (hour === 10) return '10:00';
  if (hour === 15) return '15:00';
  return null;
}

export function isOnOrAfterPartyBookingStart(value: Date | string) {
  const date = value instanceof Date ? value : new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return date.getTime() >= PARTY_BOOKING_START_MS;
}

export function isPartyBookingDate(value: Date | string) {
  const day = getPartyWeekday(value);
  return isOnOrAfterPartyBookingStart(getPartyDateKey(value)) && (day === 5 || day === 6 || day === 0);
}

export function isFridayMorningPartySlot(start: Date | string, slot?: string | null) {
  const resolvedSlot = slot ?? getPartySlotFromStart(start);
  return getPartyWeekday(start) === 5 && resolvedSlot === '10:00';
}

export function isGrandfatheredFridayMorningPartySlot(start: Date | string, slot?: string | null) {
  const resolvedSlot = slot ?? getPartySlotFromStart(start);
  return getPartyDateKey(start) === GRANDFATHERED_FRIDAY_MORNING_PARTY_DATE && resolvedSlot === '10:00';
}

export function isVisiblePartyCalendarSlot(start: Date | string, slot?: string | null) {
  return !isFridayMorningPartySlot(start, slot) || isGrandfatheredFridayMorningPartySlot(start, slot);
}

export function isBookablePartySlotForDate(date: string, slot: PartyBookingSlot) {
  return isPartyBookingDate(date) && !isFridayMorningPartySlot(date, slot);
}

export function getPartyBookingSlotOptionsForDate(date: string) {
  return PARTY_BOOKING_SLOTS.filter((slot) => isBookablePartySlotForDate(date, slot.value));
}

export function getDefaultPartyBookingSlot(date: string): PartyBookingSlot {
  return getPartyBookingSlotOptionsForDate(date)[0]?.value ?? '15:00';
}

export function isBookablePartySlot(start: Date, end: Date, slot?: string | null) {
  const resolvedSlot = slot ?? getPartySlotFromStart(start);
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  return (
    isPartyBookingDate(start) &&
    (resolvedSlot === '10:00' || resolvedSlot === '15:00') &&
    durationHours === 3 &&
    !isFridayMorningPartySlot(start, resolvedSlot)
  );
}

export function isRecognizedPartySlot(start: Date, end: Date, slot?: string | null) {
  const resolvedSlot = slot ?? getPartySlotFromStart(start);
  const day = getPartyWeekday(start);
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  return (day === 5 || day === 6 || day === 0) && (resolvedSlot === '10:00' || resolvedSlot === '15:00') && durationHours === 3;
}
