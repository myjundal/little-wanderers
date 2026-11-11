import type { SupabaseClient } from '@supabase/supabase-js';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { admissionIsPaid, admissionIsIncluded, type ReservationAdmissionStatus } from '@/lib/admission-payment-status';

type Slot = { starts_at: string };
type Reservation = { id: string; household_id: string; child_ids?: string[]; payment_status?: string; payment_choice?: string; payment_environment?: string | null; slot: Slot | Slot[] | null };
type Checkin = { id: string; person_id: string; household_id: string | null; checked_in_at: string; payment_status: string; price_cents: number; square_environment: string | null };
const slotFor = (row: Reservation) => Array.isArray(row.slot) ? row.slot[0] : row.slot;
const dayOf = (value: string) => getPartyDateKey(new Date(value));

/** A reservation's original counter choice is not evidence of an unpaid visit. */
export function reservationAdmissionStatus(row: Reservation, checkins: Checkin[], environment: string): ReservationAdmissionStatus | undefined {
  if (row.payment_status === 'paid') return row.payment_environment === environment ? (row.payment_choice === 'counter' ? 'paid_counter' : 'paid_online') : 'review';
  if (row.payment_status === 'covered') return 'included';
  if (row.payment_status === 'review') return 'review';
  const slot = slotFor(row);
  if (slot && row.child_ids?.length) {
    const payments = row.child_ids.map(id => checkins.filter(visit => visit.person_id === id && visit.household_id === row.household_id
      && dayOf(visit.checked_in_at) === dayOf(slot.starts_at) && (visit.square_environment ?? 'production') === environment));
    if (payments.some(rows => rows.length > 1)) return 'review';
    if (payments.every(rows => rows.length === 1 && (admissionIsPaid(rows[0].payment_status) || admissionIsIncluded(rows[0].payment_status)))) {
      if (payments.every(rows => admissionIsIncluded(rows[0].payment_status))) return 'included';
      if (payments.every(rows => admissionIsPaid(rows[0].payment_status))) return 'paid_counter';
      return 'paid_or_included';
    }
  }
  return row.payment_status === 'due' ? (row.payment_choice === 'now' ? 'pending' : 'due') : undefined;
}

/** Read-only projection: financial records, receipts and original choices stay unchanged. */
export async function getReservationAdmissionStatuses(admin: SupabaseClient, rows: Reservation[], environment: string) {
  const children = [...new Set(rows.flatMap(row => row.child_ids ?? []))];
  const dates = rows.map(row => slotFor(row)?.starts_at).filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort();
  const visits: Checkin[] = [];
  if (children.length && dates.length) {
    const first = dayOf(dates[0]), last = dayOf(dates.at(-1)!);
    const next = new Date(Date.parse(`${last}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    for (let offset = 0; offset < children.length; offset += 150) {
      let cursor = '';
      for (;;) {
        let query = admin.from('checkins').select('id,person_id,household_id,checked_in_at,payment_status,price_cents,square_environment')
          .in('person_id', children.slice(offset, offset + 150)).gte('checked_in_at', toPartyDateTimeIso(first, 0)).lt('checked_in_at', toPartyDateTimeIso(next, 0)).order('id').limit(500);
        if (cursor) query = query.gt('id', cursor);
        const { data, error } = await query;
        if (error) throw new Error('Unable to verify recorded admission payments.');
        visits.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
        if (visits.length >= 10000) throw new Error('Too many admission records. Please review a shorter period.');
        cursor = data![data!.length - 1].id;
      }
    }
  }
  return new Map(rows.map(row => [row.id, reservationAdmissionStatus(row, visits, environment)]));
}
