import { parseBirthdate } from '@/lib/birthdate';
import { getPartyDateKey } from '@/lib/party-config';

/** Legacy intake stored an age estimate as a birthday. Never present it as confirmed. */
export function isEstimatedOpenPlayBirthdate(notes: string | null | undefined) {
  return /^Approximate age .+ entered for Open Play\./.test(notes ?? '')
    || /^(?:\d{4}-\d{2}-\d{2} )?owner-authorized estimated DOB:/.test(notes ?? '');
}

export function parseOpenPlayBirthdate(value: unknown, now = new Date()) {
  if (typeof value !== 'string') return null;
  // Check-in uses the New York day, including after UTC midnight.
  return parseBirthdate(value, new Date(`${getPartyDateKey(now)}T12:00:00Z`));
}
