import type { SupabaseClient } from '@supabase/supabase-js';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
import { AGE_PRICING_START } from '@/lib/open-play-age-pricing';
import { getPartyDateKey } from '@/lib/party-config';
import type { readSoftOpeningFamily } from '@/lib/soft-opening-family';
type Quote = { id: string; household_id: string; child_ids: string[]; status: string; amount_cents: number; payment_status: string; payment_choice: string; square_order_id: string | null; slot: { starts_at: string } | { starts_at: string }[] | null };
/** Update only future unpaid counter quotes. Provider checkouts and receipts retain their frozen amounts. */
export async function refreshOpenPlayQuote<T extends Quote>(db: SupabaseClient, row: T, family: Awaited<ReturnType<typeof readSoftOpeningFamily>>, now = new Date()): Promise<T> {
  const slot = Array.isArray(row.slot) ? row.slot[0] : row.slot;
  if (!slot || row.status !== 'reserved' || row.payment_status !== 'due' || row.payment_choice !== 'counter' || row.square_order_id || Date.parse(slot.starts_at) < now.getTime()) return row;
  const date = getPartyDateKey(new Date(slot.starts_at));
  if (date < AGE_PRICING_START) return row;
  const amount = softOpeningAmount(row.child_ids, family.memberships, date, family.children);
  if (amount === row.amount_cents) return row;
  const patch = { amount_cents: amount, payment_status: amount === 0 ? 'covered' : 'due', payment_choice: amount === 0 ? 'membership' : 'counter' };
  const result = await db.from('open_play_reservations').update(patch).eq('id', row.id).eq('household_id', row.household_id).eq('status', 'reserved')
    .eq('payment_status', 'due').eq('payment_choice', 'counter').eq('amount_cents', row.amount_cents).is('square_order_id', null).select('id').maybeSingle();
  if (result.error || !result.data) throw new Error('Your reservation changed. Please refresh before payment.');
  return { ...row, ...patch };
}
