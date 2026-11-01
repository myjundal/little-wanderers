import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';

export function getTodayPartyRange(now = new Date()) {
  const date = getPartyDateKey(now);
  const nextDay = new Date(`${date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { date, start: toPartyDateTimeIso(date, 0), end: toPartyDateTimeIso(nextDay.toISOString().slice(0, 10), 0) };
}

export const PARTY_ATTENDANCE_SELECT = 'id,current_child_count,current_adult_count,final_child_count,final_adult_count,final_total_count,attendance_finalized_at,attendance_notes';
