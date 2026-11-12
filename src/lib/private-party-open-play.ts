import type { SupabaseClient } from '@supabase/supabase-js';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';

export const PARTY_PRIVACY_UPDATED_EVENT = 'party-privacy-updated';
export type PrivatePartyDay = { date: string; starts_at: string; ends_at: string };
type VisitWindow = { id: string; starts_at: string; ends_at: string };

export function privatePartyWindow(partyStart: string): PrivatePartyDay {
  const date = getPartyDateKey(partyStart);
  return { date, starts_at: toPartyDateTimeIso(date, 16), ends_at: toPartyDateTimeIso(date, 18) };
}

export function overlapsPrivateParty(slot: Pick<VisitWindow, 'starts_at' | 'ends_at'>, days: PrivatePartyDay[]) {
  return days.some(day => Date.parse(slot.starts_at) < Date.parse(day.ends_at) && Date.parse(slot.ends_at) > Date.parse(day.starts_at));
}

export async function readPrivatePartyDays(admin: SupabaseClient, windows: VisitWindow[]): Promise<PrivatePartyDay[]> {
  if (!windows.length) return [];
  const dates = windows.flatMap(slot => [getPartyDateKey(slot.starts_at), getPartyDateKey(slot.ends_at)]).sort();
  const last = new Date(`${dates.at(-1)}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 1);
  const result = await admin.from('party_bookings').select('id,start_time')
    .eq('is_private', true).neq('status', 'cancelled')
    .gte('start_time', toPartyDateTimeIso(dates[0], 0))
    .lt('start_time', toPartyDateTimeIso(last.toISOString().slice(0, 10), 0)).order('start_time').limit(1000);
  if (result.error || (result.data?.length ?? 0) >= 1000) throw new Error('Unable to verify private-party availability. Please refresh before reserving.');
  return [...new Map((result.data ?? []).map(party => { const window = privatePartyWindow(party.start_time); return [window.date, window] as const; })).values()];
}

export async function readPrivatePartyConflicts(admin: SupabaseClient, partyStart: string) {
  const window = privatePartyWindow(partyStart);
  const result = await admin.from('open_play_reservations')
    .select('id,household_id,child_count,adult_count,slot:open_play_reservation_slots!inner(starts_at,ends_at)')
    .eq('status', 'reserved').lt('slot.starts_at', window.ends_at).gt('slot.ends_at', window.starts_at).order('created_at').limit(1000);
  if (result.error || (result.data?.length ?? 0) >= 1000) throw new Error('Unable to read existing Open Play reservations.');
  const rows = result.data ?? [];
  if (!rows.length) return [];
  const families = await admin.from('households').select('id,name').in('id', [...new Set(rows.map(row => row.household_id))]);
  if (families.error) throw new Error('Unable to read existing Open Play families.');
  const names = new Map((families.data ?? []).map(family => [family.id, family.name]));
  return rows.map(row => ({ id: row.id, household_id: row.household_id, household_name: names.get(row.household_id) || 'Family', child_count: row.child_count, adult_count: row.adult_count }));
}
