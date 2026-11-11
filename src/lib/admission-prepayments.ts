import type { SupabaseClient } from '@supabase/supabase-js';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';

type Visit = { person_id: string; household_id?: string | null; checked_in_at: string; payment_status: string; price_cents: number; square_environment?: string | null };
type Booking = { household_id: string; child_ids: string[]; payment_status: string; payment_environment: string | null; status: string; slot: { starts_at: string } | { starts_at: string }[] | null };

export function projectAdmissionPrepayments<T extends Visit>(visits: T[], bookings: Booking[], environment: string) {
 return visits.map(visit => {
  const covered = visit.payment_status === 'due' && (visit.square_environment ?? 'production') === environment && bookings.some(booking => {
   const slot = Array.isArray(booking.slot) ? booking.slot[0] : booking.slot;
   return booking.payment_status === 'paid' && booking.payment_environment === environment && booking.status !== 'cancelled'
    && booking.household_id === visit.household_id && booking.child_ids?.includes(visit.person_id) && slot
    && getPartyDateKey(new Date(slot.starts_at)) === getPartyDateKey(new Date(visit.checked_in_at));
  });
  return covered ? {...visit,payment_status:'prepaid',price_cents:0} : visit;
 });
}

export async function getAdmissionPrepayments<T extends Visit>(admin: SupabaseClient, visits: T[], environment: string) {
 const unpaid = visits.filter(visit=>visit.payment_status==='due' && visit.household_id);
 if (!unpaid.length) return visits;
 const dates = unpaid.map(visit=>getPartyDateKey(new Date(visit.checked_in_at))).sort();
 const end = new Date(Date.parse(`${dates.at(-1)}T12:00:00Z`)+86400000).toISOString().slice(0,10);
 const bookings = await admin.from('open_play_reservations').select('household_id,child_ids,payment_status,payment_environment,status,slot_id')
  .in('household_id',[...new Set(unpaid.map(visit=>visit.household_id!))]).eq('payment_status','paid').eq('payment_environment',environment).neq('status','cancelled').limit(1001);
 if (bookings.error || (bookings.data?.length ?? 0)>1000) throw new Error('Unable to verify prepaid admission. Refresh before collecting payment.');
 if (!bookings.data?.length) return visits;
 const slots = await admin.from('open_play_reservation_slots').select('id,starts_at').in('id',[...new Set(bookings.data.map(row=>row.slot_id))])
  .gte('starts_at',toPartyDateTimeIso(dates[0],0)).lt('starts_at',toPartyDateTimeIso(end,0)).limit(1001);
 if (slots.error || (slots.data?.length ?? 0)>1000) throw new Error('Unable to verify the prepaid visit date. Refresh before collecting payment.');
 return projectAdmissionPrepayments(visits,bookings.data.map(row=>({...row,slot:slots.data?.find(slot=>slot.id===row.slot_id) ?? null})),environment);
}
