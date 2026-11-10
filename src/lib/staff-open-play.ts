import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid, SOFT_OPENING_START, SOFT_OPENING_END, OPEN_PLAY_SLOT_SELECT, OPEN_PLAY_RESERVATION_SELECT } from '@/lib/open-play-reservations';
import { readSoftOpeningFamily } from '@/lib/soft-opening-family';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
import { getPartyDateKey } from '@/lib/party-config';

export async function createStaffOpenPlayReservation(db: SupabaseClient, householdId: string, staffId: string, input: { slot_id?: string; child_ids?: string[]; adult_count?: number; notes?: string }) {
  if (!isUuid(householdId) || !isUuid(input.slot_id ?? '')) throw new Error('Choose a family and arrival window.');
  const ids = input.child_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 5 || ids.some(id => !isUuid(id)) || new Set(ids).size !== ids.length) throw new Error('Choose 1–5 different children.');
  if (![1, 2].includes(input.adult_count ?? 0)) throw new Error('Choose one or two accompanying adults.');
  const [family, slot, existing, household] = await Promise.all([
    readSoftOpeningFamily(db, householdId),
    db.from('open_play_reservation_slots').select(OPEN_PLAY_SLOT_SELECT).eq('id', input.slot_id!).eq('is_soft_opening', true).maybeSingle(),
    db.from('open_play_reservations').select('id,slot:open_play_reservation_slots!inner(ends_at)').eq('household_id', householdId).eq('status', 'reserved').gt('slot.ends_at', new Date().toISOString()).limit(1),
    db.from('households').select('email').eq('id', householdId).maybeSingle(),
  ]);
  if (slot.error || existing.error || household.error) throw new Error('Unable to verify this reservation. Please refresh.');
  if (!household.data) throw new Error('Family not found.');
  if (existing.data?.length) throw new Error('This family already has an upcoming Open Play reservation. Cancel it before choosing another time.');
  if (!slot.data || slot.data.status !== 'open' || new Date(slot.data.starts_at) < new Date(SOFT_OPENING_START) || new Date(slot.data.starts_at) >= new Date(SOFT_OPENING_END) || new Date(slot.data.ends_at) <= new Date()) throw new Error('This arrival window is no longer available.');
  if (ids.some(id => !family.children.some(child => child.id === id))) throw new Error('Choose children belonging to this family.');
  const amount = softOpeningAmount(ids, family.memberships, getPartyDateKey(new Date(slot.data.starts_at)));
  const saved = await db.from('open_play_reservations').insert({ household_id: householdId, slot_id: input.slot_id, created_by_user_id: staffId, contact_email: household.data.email, child_ids: ids, child_count: ids.length, adult_count: input.adult_count, amount_cents: amount, payment_choice: amount === 0 ? 'membership' : 'counter', payment_status: amount === 0 ? 'covered' : 'due', status: 'reserved', notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) || null : null }).select(OPEN_PLAY_RESERVATION_SELECT).single();
  // The database serializes reservations per slot and enforces actual remaining capacity.
  if (saved.error || !saved.data) throw new Error(saved.error?.code === '23514' || saved.error?.code === '23505' ? 'This window is full or the family already has a reservation. Refresh and choose another time.' : 'Unable to save the reservation. Refresh before retrying.');
  return saved.data;
}
