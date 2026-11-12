import { readPrivatePartyDays, overlapsPrivateParty } from '@/lib/private-party-open-play';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_OPEN_PLAY_START, SOFT_OPENING_END } from '@/lib/open-play-reservations';

export type PublicOpenPlaySlot = { id: string; starts_at: string; ends_at: string; remaining_children: number; capacity_children: number; is_closed: boolean; is_full: boolean; is_private_party_blocked: boolean; closing_at: string | null };

// Public output contains availability only. Family contacts, notes and bookings stay private.
export async function loadPublicOpenPlaySlots(admin: SupabaseClient): Promise<PublicOpenPlaySlot[]> {
  const slots = await admin.from('open_play_reservation_slots').select('id,starts_at,ends_at,status,capacity_children,capacity_total')
    .eq('is_soft_opening', true).neq('status', 'hidden').gte('starts_at', PUBLIC_OPEN_PLAY_START)
    .lt('starts_at', SOFT_OPENING_END).gt('ends_at', new Date().toISOString()).order('starts_at');
  if (slots.error) throw new Error('Unable to load arrival windows.');
  if (!slots.data?.length) return [];
  const privateDays = await readPrivatePartyDays(admin, slots.data);
  const occupancy = new Map<string, { children: number; total: number }>();
  for (let offset = 0; ; offset += 500) {
    const reservations = await admin.from('open_play_reservations').select('slot_id,child_count,adult_count,slot:open_play_reservation_slots!inner(starts_at)')
      .gte('slot.starts_at', PUBLIC_OPEN_PLAY_START).lt('slot.starts_at', SOFT_OPENING_END).neq('status', 'cancelled').order('id').range(offset, offset + 499);
    if (reservations.error) throw new Error('Unable to confirm availability.');
    for (const row of reservations.data ?? []) {
      const current = occupancy.get(row.slot_id) ?? { children: 0, total: 0 };
      current.children += row.child_count; current.total += row.child_count + row.adult_count; occupancy.set(row.slot_id, current);
    }
    if ((reservations.data?.length ?? 0) < 500) break;
  }
  return slots.data.map(slot => {
    const used = occupancy.get(slot.id) ?? { children: 0, total: 0 };
    const remaining = Math.max(0, slot.capacity_children - used.children);
    return { id: slot.id, starts_at: slot.starts_at, ends_at: slot.ends_at, remaining_children: remaining, capacity_children: slot.capacity_children,
      is_closed: slot.status === 'closed' || overlapsPrivateParty(slot, privateDays), is_private_party_blocked: overlapsPrivateParty(slot, privateDays),
      closing_at: privateDays.find(day => new Date(slot.starts_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === day.date)?.starts_at ?? null, is_full: remaining === 0 || (slot.capacity_total != null && used.total >= slot.capacity_total) };
  });
}
