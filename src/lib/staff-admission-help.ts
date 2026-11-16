import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest } from '@/lib/square-client';
import { squareSaleCategory } from '@/lib/square-daily-revenue';
import { admissionDayRange } from '@/lib/admission-checkout';
import { WAIVER_VERSION } from '@/lib/waiver-content';

export const helpChecked = <T>(result: { data: T; error: { message?: string } | null }) => {
  if (result.error) throw new Error(result.error.message || 'Unable to load admission help.');
  return result.data as NonNullable<T>;
};
type Money = { amount?: number; currency?: string };
type Payment = { id: string; order_id?: string; location_id?: string; status?: string; source_type?: string; amount_money?: Money; refunded_money?: Money; tip_money?: Money; created_at?: string; updated_at?: string; receipt_number?: string; receipt_url?: string; note?: string; card_details?: { card?: { last_4?: string } } };
type Order = { id: string; location_id?: string; state?: string; total_money?: Money; total_tip_money?: Money; total_tax_money?: Money; tenders?: Array<{ payment_id?: string }>; line_items?: Array<{ name?: string; total_money?: Money; total_tax_money?: Money; item_type?: string }> };
const amount = (money: Money | undefined, optional = false) => {
  if (!money && optional) return 0;
  if (money?.currency !== 'USD' || !Number.isSafeInteger(money.amount) || money.amount! < 0) throw new Error('Receipt amount needs review.');
  return money.amount!;
};
export async function helpUnpaidVisits(admin: SupabaseClient, family: string, day: string) {
  const range = admissionDayRange(day, day);
  const visits = helpChecked(await admin.from('checkins').select('id,person_id,household_id,price_cents,payment_status,checked_in_at,square_environment')
    .eq('household_id', family).in('payment_status', ['due', 'paid', 'walkin_paid', 'terminal_paid']).is('square_order_id', null)
    .gt('price_cents', 0).gte('checked_in_at', range.start).lt('checked_in_at', range.end).limit(31));
  if (visits.length > 30) throw new Error('Too many unpaid visits. Save for owner review.');
  return (visits as Array<{ id: string; price_cents: number; square_environment: string | null }>).filter(visit => !visit.square_environment || visit.square_environment === squareConfig().environment);
}

/** A staff member selects an existing receipt; this code never creates a charge. */
export async function helpReceipt(orderId: string, expected: number, day: string) {
  const config = squareConfig(), range = admissionDayRange(day, day);
  if (!/^[\w:-]{1,200}$/.test(orderId) || !Number.isSafeInteger(expected) || expected <= 0) throw new Error('Choose an unpaid family and receipt.');
  const { order } = await squareRequest<{ order: Order }>(`/v2/orders/${encodeURIComponent(orderId)}`);
  if (order.id !== orderId || order.location_id !== config.locationId || !['COMPLETED', 'OPEN'].includes(order.state ?? '')) throw new Error('Receipt is from a different store or is incomplete.');
  const total = amount(order.total_money), tip = amount(order.total_tip_money, true), tax = amount(order.total_tax_money, true);
  const admission = (order.line_items ?? []).filter(line => squareSaleCategory(line.name || '', line.item_type) === 'open_play')
    .reduce((sum, line) => sum + amount(line.total_money) - amount(line.total_tax_money, true), 0);
  if (admission !== expected && !(admission === 0 && total - tax - tip === expected
    && (order.line_items ?? []).every(line => squareSaleCategory(line.name || '', line.item_type) === 'other'))) {
    throw new Error('Receipt admission amount does not match this family. Save for owner review.');
  }
  const paymentIds = (order.tenders ?? []).map(tender => tender.payment_id);
  if (!paymentIds.length || paymentIds.some(id => !id) || new Set(paymentIds).size !== paymentIds.length) throw new Error('A completed receipt is required.');
  const payments: Payment[] = [];
  for (const id of paymentIds) {
    const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(id!)}`);
    if (payment.id !== id || payment.order_id !== orderId || payment.location_id !== config.locationId || payment.status !== 'COMPLETED'
      || amount(payment.refunded_money, true) !== 0 || !payment.updated_at || !Number.isFinite(Date.parse(payment.updated_at))
      || !payment.created_at || !Number.isFinite(Date.parse(payment.created_at)) || Date.parse(payment.created_at) < Date.parse(range.start) || Date.parse(payment.created_at) >= Date.parse(range.end)) throw new Error('Receipt is refunded, pending, or from another date.');
    amount(payment.amount_money); amount(payment.tip_money, true);
    payments.push(payment);
  }
  const paid = payments.reduce((sum, payment) => sum + amount(payment.amount_money), 0);
  if (paid + tip !== total || payments.reduce((sum, payment) => sum + amount(payment.tip_money, true), 0) !== tip) throw new Error('Split or partial payment needs owner review.');
  return { order, payments, proof: { admission_cents: expected, paid_cents: paid, total_cents: total, tax_cents: tax, tip_cents: tip,
    payment_ids: payments.map(payment => payment.id), paid_at: payments[0].created_at, receipt_numbers: payments.map(payment => payment.receipt_number || '') } };
}

export async function searchHelpReceipts(admin: SupabaseClient, family: string, day: string, query: string) {
  const visits = await helpUnpaidVisits(admin, family, day), expected = visits.reduce((sum, visit) => sum + visit.price_cents, 0);
  if (!expected) return { receipts: [], amount_cents: 0 };
  const config = squareConfig(), range = admissionDayRange(day, day);
  const params = new URLSearchParams({ location_id: config.locationId, begin_time: range.start, end_time: range.end, limit: '100', sort_order: 'DESC' });
  const candidates = new Map<string, Payment>();
  let cursor: string | undefined;
  const term = query.trim().toLowerCase().slice(0, 200);
  if (term.length < 3) throw new Error('Enter the receipt number, receipt link or card last four digits.');
  for (let page = 0; page < 10; page++) {
    if (cursor) params.set('cursor', cursor);
    const result = await squareRequest<{ payments?: Payment[]; cursor?: string }>(`/v2/payments?${params}`);
    for (const payment of result.payments ?? []) {
      if (payment.status !== 'COMPLETED' || payment.location_id !== config.locationId || !payment.order_id || (payment.refunded_money?.amount ?? 0) !== 0) continue;
      if (term && ![payment.id, payment.order_id, payment.receipt_number, payment.receipt_url, payment.card_details?.card?.last_4].some(value => value?.toLowerCase().includes(term))) continue;
      if ((payment.amount_money?.amount ?? 0) >= expected) candidates.set(payment.order_id, payment);
    }
    cursor = result.cursor;
    if (!cursor) break;
  }
  if (cursor) throw new Error('Too many receipts. Enter the receipt number or card last four digits.');
  if (candidates.size > 40) throw new Error('Enter the receipt number or card last four digits to narrow the search.');
  const receipts = [];
  for (const [id] of candidates) {
    try {
      const receipt = await helpReceipt(id, expected, day);
      const [visitsUsing, actionsUsing, posUsing, reservationsUsing, checkoutUsing, partyUsing, classUsing] = await Promise.all([
        admin.from('checkins').select('id').eq('square_order_id', id).limit(1),
        admin.from('staff_admission_actions').select('id').eq('kind', 'receipt_link').eq('resource_id', `${config.environment}:${id}`).limit(1),
        admin.from('admission_pos_sales').select('id').eq('environment', config.environment).eq('order_id', id).limit(1),
        admin.from('open_play_reservations').select('id').eq('payment_environment', config.environment).eq('square_order_id', id).limit(1),
        admin.from('square_checkout_attempts').select('id').eq('environment', config.environment).eq('order_id', id).limit(1),
        admin.from('party_bookings').select('id').eq('square_environment', config.environment).eq('square_order_id', id).limit(1),
        admin.from('class_series_sales').select('id').eq('environment', config.environment).eq('square_order_id', id).limit(1),
      ]);
      if ([visitsUsing, actionsUsing, posUsing, reservationsUsing, checkoutUsing, partyUsing, classUsing].some(result => helpChecked(result).length)) continue;
      receipts.push({ order_id: id, admission_cents: expected, total_cents: receipt.proof.total_cents, paid_at: receipt.proof.paid_at,
        receipt_number: receipt.payments.map(payment => payment.receipt_number).filter(Boolean).join(', '),
        card_last_four: receipt.payments.map(payment => payment.card_details?.card?.last_4 || payment.source_type || 'Receipt').join(', '),
        items: (receipt.order.line_items ?? []).map(line => line.name || 'Custom amount').join(', ') });
    } catch (error) {
      // Incompatible/refunded receipts are omitted, but provider/read failures
      // must never appear as an empty, successful search.
      if (!/Receipt (admission amount|is from|is refunded|amount needs)|A completed receipt|Split or partial payment/.test(error instanceof Error ? error.message : '')) throw error;
    }
  }
  return { receipts, amount_cents: expected };
}

export async function linkHelpReceipt(admin: SupabaseClient, actor: string, family: string, day: string, orderId: string) {
  const config = squareConfig(), visits = await helpUnpaidVisits(admin, family, day);
  const expected = visits.reduce((sum, visit) => sum + visit.price_cents, 0);
  // A retried request uses the durable audit, without pretending a second receipt was received.
  if (!expected) {
    const prior = helpChecked(await admin.from('staff_admission_actions').select('household_id,details').eq('kind', 'receipt_link').eq('resource_id', `${config.environment}:${orderId}`).maybeSingle());
    if (prior?.household_id === family && prior.details?.visit_date === day) return { status: 'paid', already_linked: true };
    throw new Error('Admission changed. Refresh before linking a receipt.');
  }
  const receipt = await helpReceipt(orderId, expected, day);
  for (const payment of receipt.payments) helpChecked(await admin.rpc('save_square_payment_receipt', {
    p_environment: config.environment, p_payment: payment.id, p_order: orderId, p_amount: payment.amount_money!.amount,
    p_refunded: 0, p_status: payment.status, p_updated: payment.updated_at,
  }));
  return helpChecked(await admin.rpc('staff_link_admission_receipt', { p_actor: actor, p_family: family, p_day: day, p_ids: visits.map(visit => visit.id),
    p_environment: config.environment, p_order: orderId, p_proof: receipt.proof }));
}

export async function searchHelpWaivers(admin: SupabaseClient, family: string, query: string) {
  const term = query.trim().replace(/[^\p{L}\p{N}@+.' -]/gu, ' ').replace(/\s+/g, ' ').slice(0, 120);
  if (term.length < 3) throw new Error('Enter at least three characters of the guardian name, email or phone.');
  const tokens = term.toLowerCase().split(' ');
  const rows = helpChecked(await admin.from('waivers').select('id,household_id,parent_name,email,phone,signed_at,waiver_expires_at,covered_person_ids,agreement_snapshot')
    .eq('source', 'guest_website').is('signed_by_user_id', null).eq('waiver_version', WAIVER_VERSION)
    .gt('waiver_expires_at', new Date().toISOString()).lte('signed_at', new Date().toISOString())
    .or(`parent_name.ilike.%${tokens[0]}%,email.ilike.%${tokens[0]}%,phone.ilike.%${tokens[0].replace(/\D/g, '') || tokens[0]}%`)
    .order('signed_at', { ascending: false }).limit(101));
  if (rows.length > 100) throw new Error('Too many waivers. Search using the exact email or phone.');
  const waivers = rows.filter(row => row.household_id !== family && !row.agreement_snapshot?.family_reconciliation && tokens.every(token =>
    `${row.parent_name} ${row.email} ${row.phone}`.toLowerCase().includes(token))).map(row => ({
    id: row.id, guardian: row.parent_name, email: row.email, phone: row.phone, signed_at: row.signed_at,
    children: (row.agreement_snapshot?.children ?? []).filter((child: { id: string }) => row.covered_person_ids?.includes(child.id)),
  })).filter(row => row.children.length > 0);
  return { waivers: waivers.slice(0, 20) };
}
