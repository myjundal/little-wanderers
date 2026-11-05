import { getPartyDateKey, PARTY_TIME_ZONE, toPartyDateTimeIso } from '@/lib/party-config';

export const PARTY_SCHEDULE_UPDATED_EVENT = 'party-schedule-updated';

export function getPartyTimeValue(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PARTY_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

// Round-trip wall times so invalid dates and nonexistent DST times cannot shift silently.
export function parsePartySchedule(date: unknown, startTime: unknown, endTime: unknown) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
    || typeof endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return null;
  try {
    const convert = (time: string) => {
      const [hour, minute] = time.split(':').map(Number);
      return toPartyDateTimeIso(date, hour, minute);
    };
    const start = convert(startTime);
    const end = convert(endTime);
    if (getPartyDateKey(start) !== date || getPartyDateKey(end) !== date
      || getPartyTimeValue(start) !== startTime || getPartyTimeValue(end) !== endTime
      || end <= start) return null;
    return { start_time: start, end_time: end };
  } catch { return null; }
}

export function getTodayPartyRange(now = new Date()) {
  const date = getPartyDateKey(now);
  const nextDay = new Date(`${date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { date, start: toPartyDateTimeIso(date, 0), end: toPartyDateTimeIso(nextDay.toISOString().slice(0, 10), 0) };
}

export const PARTY_ATTENDANCE_SELECT = 'id,current_child_count,current_adult_count,final_child_count,final_adult_count,final_total_count,attendance_finalized_at,attendance_notes';
