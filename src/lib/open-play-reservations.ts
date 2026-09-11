import type { SupabaseClient } from '@supabase/supabase-js';

export const OPEN_PLAY_SLOT_SELECT = 'id,label,starts_at,ends_at,capacity_children,capacity_total,status,notes,is_soft_opening,created_at';
export const OPEN_PLAY_RESERVATION_SELECT = 'id,slot_id,household_id,created_by_user_id,contact_email,child_count,adult_count,notes,status,cancelled_at,status_updated_at,created_at';

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
