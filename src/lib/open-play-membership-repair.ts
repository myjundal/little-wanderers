import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readSoftOpeningFamily } from '@/lib/soft-opening-family';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
import { getPartyDateKey } from '@/lib/party-config';
import { squareConfig, squareRequest, assertUsd, type SquareOrder } from '@/lib/square-client';

const checked = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw Error(r.error.message); return r.data; };

/** Reclassify an unpaid visit only after closing its checkout and proving membership coverage. */
export async function repairOpenPlayMembership(db: SupabaseClient, id: string, actor: string) {
  const row = checked(await db.from('open_play_reservations').select('*').eq('id', id).single());
  if (!row || !['reserved', 'checked_in'].includes(row.status)) throw Error('This reservation needs owner review.');
  if (row.payment_status === 'covered' && row.amount_cents === 0 && !row.square_order_id) return row;
  if (row.payment_status !== 'due' || row.amount_cents <= 0) throw Error('Only an unpaid reservation can be corrected. Review paid or uncertain payments first.');
  const slot = checked(await db.from('open_play_reservation_slots').select('starts_at').eq('id', row.slot_id).single());
  const family = await readSoftOpeningFamily(db, row.household_id);
  if (!slot || !row.child_ids?.length || row.child_ids.length !== row.child_count || row.child_ids.some((child: string) => !family.children.some(person => person.id === child))
    || softOpeningAmount(row.child_ids, family.memberships, getPartyDateKey(slot.starts_at), family.children) !== 0) throw Error('Membership does not cover every child on this visit date.');
  const hash = createHash('sha256').update(`open-play-membership-repair:${id}:${row.square_order_id || 'counter'}`).digest('hex');
  const auditId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const evidence = { reservation_id: id, original_amount_cents: row.amount_cents, original_order_id: row.square_order_id, original_payment_link_id: row.square_payment_link_id, visit_date: getPartyDateKey(slot.starts_at), state: 'prepared' };
  const inserted = await db.from('membership_events').insert({ id: auditId, household_id: row.household_id, action: 'reservation_membership_coverage_corrected', notes: JSON.stringify(evidence), created_by_user_id: actor, created_by_role: 'owner' });
  if (inserted.error && inserted.error.code !== '23505') throw Error('Unable to save correction audit.');
  if (row.square_order_id) {
    const cfg = squareConfig();
    if (row.payment_environment !== cfg.environment || !row.square_payment_link_id) throw Error('Payment environment or checkout needs review.');
    const readOrder = async () => {
      const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(row.square_order_id)}`);
      if (order.id !== row.square_order_id || order.reference_id !== `op_${id}` || order.location_id !== cfg.locationId || order.tenders?.length) throw Error('Payment exists or checkout ownership needs review.');
      assertUsd(order.total_money, row.amount_cents);
      if (!['DRAFT', 'OPEN', 'CANCELED'].includes(order.state || '')) throw Error('Checkout cannot be safely closed.');
      return order;
    };
    const order = await readOrder();
    if (order.state !== 'CANCELED') {
      const { payment_link: link } = await squareRequest<{ payment_link: { id: string; order_id: string } }>(`/v2/online-checkout/payment-links/${encodeURIComponent(row.square_payment_link_id)}`);
      if (link.id !== row.square_payment_link_id || link.order_id !== row.square_order_id) throw Error('Checkout link does not match this reservation.');
      const closed = await squareRequest<{ id: string; cancelled_order_id: string }>(`/v2/online-checkout/payment-links/${encodeURIComponent(row.square_payment_link_id)}`, 'DELETE');
      if (closed.id !== row.square_payment_link_id || closed.cancelled_order_id !== row.square_order_id) throw Error('Checkout closure could not be confirmed.');
      if ((await readOrder()).state !== 'CANCELED') throw Error('Checkout is still active.');
    }
  } else if (row.square_payment_link_id || row.payment_url || row.payment_choice === 'now') throw Error('Checkout is still being prepared. Retry after it finishes.');
  let update = db.from('open_play_reservations').update({ amount_cents: 0, payment_choice: 'membership', payment_status: 'covered', square_order_id: null, square_payment_link_id: null, payment_url: null, payment_environment: null })
    .eq('id', id).eq('status', row.status).eq('payment_status', 'due').eq('amount_cents', row.amount_cents).eq('updated_at', row.updated_at);
  update = row.square_order_id ? update.eq('square_order_id', row.square_order_id) : update.is('square_order_id', null);
  const corrected = checked(await update.select('*').maybeSingle());
  if (!corrected) throw Error('Reservation changed. Refresh before retrying the correction.');
  checked(await db.from('membership_events').update({ notes: JSON.stringify({ ...evidence, state: 'corrected', corrected_at: new Date().toISOString(), checkout_closed: Boolean(row.square_order_id), charges_executed: false }) }).eq('id', auditId));
  return corrected;
}
