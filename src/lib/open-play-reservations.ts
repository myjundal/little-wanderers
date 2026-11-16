import type { SupabaseClient } from '@supabase/supabase-js';

export const PUBLIC_OPEN_PLAY_START_DATE = '2026-11-14';
export const PUBLIC_OPEN_PLAY_START = `${PUBLIC_OPEN_PLAY_START_DATE}T00:00:00-05:00`;

export const SOFT_OPENING_START_DATE = '2026-11-11';
export const SOFT_OPENING_START = `${SOFT_OPENING_START_DATE}T00:00:00-05:00`;

export const SOFT_OPENING_END = '2027-01-01T00:00:00-05:00';

export function defaultOpenPlayCapacity(startsAt: string | Date) {
  const start = typeof startsAt === 'string' ? Date.parse(startsAt) : startsAt.getTime();
  if (start >= Date.parse('2026-11-16T00:00:00-05:00')) return 10;
  if (start >= Date.parse('2026-11-14T00:00:00-05:00')) return 7;
  return 5;
}

// Arrival reservations end at 5 PM Eastern from November 16; play continues until closing.
const arrivalParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, minutes: Number(value('hour')) * 60 + Number(value('minute')) };
};
export function isOpenPlayArrivalAvailable(slot: { starts_at: string; ends_at: string }) {
  const start = arrivalParts(slot.starts_at), end = arrivalParts(slot.ends_at);
  return start.date < '2026-11-16' || (start.minutes < 17 * 60 && end.date === start.date && end.minutes <= 17 * 60);
}
export function isLastOpenPlayArrival(slot: { starts_at: string; ends_at: string }) {
  const start = arrivalParts(slot.starts_at), end = arrivalParts(slot.ends_at);
  return start.date >= '2026-11-16' && start.minutes === 16 * 60 && end.date === start.date && end.minutes === 17 * 60;
}
export const LAST_OPEN_PLAY_ARRIVAL_NOTICE = 'Arriving 4–5 PM? We close at 6 PM. You will have 1–2 hours to play, depending on when you arrive. Please confirm this works for your visit.';

export const OPEN_PLAY_SLOT_SELECT = 'id,label,starts_at,ends_at,capacity_children,capacity_total,status,notes,is_soft_opening,created_at';
export const OPEN_PLAY_RESERVATION_SELECT = 'id,slot_id,household_id,created_by_user_id,contact_email,child_count,adult_count,notes,status,cancelled_at,status_updated_at,created_at,child_ids,payment_choice,payment_status,amount_cents,square_order_id,square_payment_link_id,payment_url,payment_environment';

export function isMissingOpenPlayReservationTable(message: string) {
  return /relation .*open_play_reservation|table .*open_play_reservation|schema cache.*open_play_reservation|Could not find the table/i.test(message);
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeReservationCount(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function getReservationOccupancy(admin: SupabaseClient, slotId: string) {
  const { data, error } = await admin
    .from('open_play_reservations')
    .select('child_count,adult_count,status')
    .eq('slot_id', slotId)
    .neq('status', 'cancelled');

  if (error) throw new Error(error.message);

  return (data ?? []).reduce(
    (total, row) => ({
      children: total.children + Number(row.child_count ?? 0),
      adults: total.adults + Number(row.adult_count ?? 0),
      total: total.total + Number(row.child_count ?? 0) + Number(row.adult_count ?? 0),
    }),
    { children: 0, adults: 0, total: 0 }
  );
}

export function formatOpenPlayReservationError(message: string) {
  if (isMissingOpenPlayReservationTable(message)) {
    return 'Open Play reservation tables are not set up yet. Run the soft opening reservation migration in Supabase first.';
  }

  return message;
}
