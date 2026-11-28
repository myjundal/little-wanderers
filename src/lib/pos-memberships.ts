import { getStaffFamilySearchAliases } from '@/lib/staff-family-search';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonths, easternDate } from '@/lib/founding-membership';
import { toPartyDateTimeIso } from '@/lib/party-config';
import { squareConfig, squareRequest, type SquareMoney } from '@/lib/square-client';
import type { AdmissionEnrollment } from '@/lib/founding-admission-coverage';

const ACTION = 'pos_membership_payment';
type Line = { name?: string; quantity?: string; catalog_object_id?: string; total_money?: SquareMoney; total_tax_money?: SquareMoney };
type Order = { id: string; location_id?: string; customer_id?: string; state?: string; total_money?: SquareMoney; total_tip_money?: SquareMoney; tenders?: { payment_id?: string; customer_id?: string }[]; line_items?: Line[] };
type Payment = { id: string; order_id?: string; customer_id?: string; location_id?: string; status?: string; amount_money?: SquareMoney; total_money?: SquareMoney; tip_money?: SquareMoney; refunded_money?: SquareMoney; created_at?: string; updated_at?: string };
export type PosMembershipReceipt = { version: 1; environment: string; household_id: string; customer_id: string; order_id: string; payment_ids: string[]; amount_cents: number; paid_at: string; start_date: string; end_date: string; child_ids: string[]; payment_status: 'paid' | 'refunded'; };
const checked = <T>(result: { data: T; error: unknown }) => { if (result.error) throw new Error('Unable to update the paid membership. Retry synchronization.'); return result.data as NonNullable<T>; };
export function posMembershipId(environment: string, key: string) {
  const h = createHash('sha256').update(`pos-membership-v1:${environment}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const usd = (value?: SquareMoney, optional = false) => {
  if (!value && optional) return 0;
  if (value?.currency !== 'USD' || !Number.isSafeInteger(value.amount) || value.amount! < 0) throw new Error('Membership receipt amount needs review.');
  return value.amount!;
};
export const isPosMembershipOrder = (order: { line_items?: Array<{ name?: string }> }) => Boolean(order.line_items?.some(line => product(line.name)));
const product = (name = '') => name.trim() === 'Monthly Membership - 1st Child' ? 'first'
  : ['Monthly Membership - Additional Sibling', 'Monthly Membership - Sibling'].includes(name.trim()) ? 'sibling' : null;

/** Exact catalog products and full provider settlement are required; a $60 total alone grants nothing. */
export function membershipPurchase(order: Order, payments: Payment[], location: string) {
  const lines = (order.line_items ?? []).filter(line => product(line.name));
  if (!lines.length) return null;
  if (order.location_id !== location || order.state !== 'COMPLETED') throw new Error('Membership order is not completed at this store.');
  let first = 0, siblings = 0, amount = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity);
    const price = product(line.name) === 'first' ? 6000 : 2000;
    if (!line.catalog_object_id || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10
      || usd(line.total_money) - usd(line.total_tax_money, true) !== price * quantity) throw new Error('Membership product or price needs review.');
    if (product(line.name) === 'first') first += quantity; else siblings += quantity;
    amount += price * quantity;
  }
  if (first !== 1) throw new Error('One first-child membership is required per purchase.');
  const ids = (order.tenders ?? []).map(t => t.payment_id);
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length || payments.length !== ids.length) throw new Error('Membership receipt is incomplete.');
  for (const p of payments) if (!ids.includes(p.id) || p.order_id !== order.id || p.location_id !== location || p.status !== 'COMPLETED'
    || !p.created_at || !Number.isFinite(Date.parse(p.created_at)) || Date.parse(p.created_at) > Date.now() || !p.updated_at
    || !Number.isFinite(Date.parse(p.updated_at))) throw new Error('Membership payment is not fully settled.');
  const paid = payments.reduce((sum, p) => sum + (p.total_money ? usd(p.total_money) : usd(p.amount_money) + usd(p.tip_money, true)), 0);
  if (paid !== usd(order.total_money)) throw new Error('Membership payment is partial.');
  const customerIds = [...new Set([order.customer_id, ...(order.tenders ?? []).map(t => t.customer_id), ...payments.map(p => p.customer_id)].filter((id): id is string => !!id))];
  if (customerIds.length !== 1) throw new Error('Attach one family customer to the membership purchase in Square.');
  const paidAt = payments.map(p => p.created_at!).sort().at(-1)!;
  const start = easternDate(new Date(paidAt));
  return { customer_id: customerIds[0], amount_cents: amount, child_count: first + siblings, paid_at: paidAt, start_date: start, end_date: addMonths(start, 1),
    refunded: payments.some(p => usd(p.refunded_money, true) > 0), payment_ids: ids as string[], lines };
}

async function verifyCatalog(lines: Line[]) {
  for (const line of lines) {
    const { object, related_objects } = await squareRequest<{ object: { id: string; type: string; item_variation_data?: { item_id?: string } }; related_objects?: Array<{ id: string; type: string; item_data?: { name?: string } }> }>(`/v2/catalog/object/${encodeURIComponent(line.catalog_object_id!)}?include_related_objects=true`);
    const parent = related_objects?.find(o => o.type === 'ITEM' && o.id === object.item_variation_data?.item_id);
    if (object.id !== line.catalog_object_id || object.type !== 'ITEM_VARIATION' || product(parent?.item_data?.name) !== product(line.name)) throw new Error('Membership catalog product needs review.');
  }
}

export async function readPosMembershipReceipts(admin: SupabaseClient, environment: string, families?: string[]) {
  const receipts: PosMembershipReceipt[] = [];
  if (families && !families.length) return receipts;
  let cursor = '';
  for (;;) {
    let query = admin.from('membership_events').select('id,notes,household_id').eq('action', ACTION).order('id').limit(500);
    if (families) query = query.in('household_id', families);
    if (cursor) query = query.gt('id', cursor);
    const rows = checked(await query);
    for (const row of rows) {
      const value = JSON.parse(row.notes) as PosMembershipReceipt;
      if (value.version !== 1 || value.household_id !== row.household_id || !value.child_ids?.length || !/^\d{4}-\d{2}-\d{2}$/.test(value.start_date)
        || !/^\d{4}-\d{2}-\d{2}$/.test(value.end_date) || value.end_date <= value.start_date) throw new Error('A paid membership receipt needs review.');
      if (value.environment === environment) receipts.push(value);
    }
    if (rows.length < 500) return receipts;
    if (receipts.length >= 10000) throw new Error('Too many membership receipts.');
    cursor = rows.at(-1)!.id;
  }
}

export function posAdmissionTerms(receipts: PosMembershipReceipt[]): AdmissionEnrollment[] {
  return receipts.filter(r => r.payment_status === 'paid').map(r => ({ household_id: r.household_id, environment: r.environment, status: 'active', child_ids: r.child_ids,
    square_card_id: null, start_date: r.start_date, paid_through: new Date(Date.parse(`${r.end_date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10), created_at: r.paid_at }));
}

async function updateEntitlement(admin: SupabaseClient, receipt: PosMembershipReceipt) {
  const id = posMembershipId(receipt.environment, `family:${receipt.household_id}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = checked(await admin.from('memberships').select('*').eq('id', id).maybeSingle());
    const receipts = await readPosMembershipReceipts(admin, receipt.environment, [receipt.household_id]);
    const live = receipts.filter(r => r.payment_status === 'paid' && r.end_date > easternDate());
    const end = live.map(r => r.end_date).sort().at(-1);
    const patch = { household_id: receipt.household_id, square_customer_id: receipt.customer_id, square_environment: receipt.environment,
      square_status: end ? 'ACTIVE' : 'CANCELED', payment_review_required: false,
      renews_at: end ? toPartyDateTimeIso(end, 0) : new Date().toISOString(), covered_person_ids: [...new Set(live.flatMap(r => r.child_ids))] };
    if (!previous) {
      const inserted = await admin.from('memberships').insert({ id, ...patch });
      if (inserted.error && inserted.error.code !== '23505') throw new Error('Unable to register paid membership.');
      if (!inserted.error) return id;
    } else {
      const saved = checked(await admin.from('memberships').update(patch).eq('id', id).eq('updated_at', previous.updated_at).select('id').maybeSingle());
      if (saved) return id;
    }
  }
  throw new Error('Membership changed during synchronization. Retry.');
}

async function coverVisits(admin: SupabaseClient, receipt: PosMembershipReceipt) {
  if (receipt.payment_status !== 'paid') return;
  const visits = checked(await admin.from('checkins').select('id,person_id,payment_status,price_cents,notes,checked_in_at,square_environment,square_order_id')
    .in('person_id', receipt.child_ids).eq('payment_status', 'due').is('square_order_id', null)
    .gte('checked_in_at', toPartyDateTimeIso(receipt.start_date, 0)).lt('checked_in_at', toPartyDateTimeIso(receipt.end_date, 0)).limit(501));
  if (visits.length > 500) throw new Error('Too many admission records for membership correction.');
  for (const v of visits) {
    if ((v.square_environment ?? 'production') !== receipt.environment) continue;
    const note = `Paid monthly membership; original unpaid admission $${(v.price_cents / 100).toFixed(2)}. Square membership order ${receipt.order_id}.`;
    checked(await admin.from('checkins').update({ price_cents: 0, payment_status: 'covered', membership_applied: true, square_environment: receipt.environment,
      notes: [v.notes, note].filter(Boolean).join('\n') }).eq('id', v.id).eq('payment_status', 'due').eq('price_cents', v.price_cents).is('square_order_id', null));
  }
}

/** Provider reads only; never starts recurring billing or charges/refunds a card. Each order grants its purchased calendar month once. */
export async function syncPosMembership(admin: SupabaseClient, orderId: string, actor?: string) {
  const config = squareConfig();
  if (config.environment === 'production' && process.env.VERCEL_ENV === 'preview') throw new Error('Synchronize paid memberships on the live site.');
  if (!/^[\w:-]{1,200}$/.test(orderId)) throw new Error('Invalid membership receipt.');
  const { order } = await squareRequest<{ order: Order }>(`/v2/orders/${encodeURIComponent(orderId)}`);
  if (order.id !== orderId) throw new Error('Membership order mismatch.');
  if (!(order.line_items ?? []).some(line => product(line.name))) return { status: 'not_membership' };
  const payments = await Promise.all((order.tenders ?? []).map(async t => {
    if (!t.payment_id) throw new Error('Membership payment is incomplete.');
    const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(t.payment_id)}`);
    if (payment.id !== t.payment_id) throw new Error('Membership payment mismatch.');
    return payment;
  }));
  const purchase = membershipPurchase(order, payments, config.locationId)!;
  await verifyCatalog(purchase.lines);
  // Only a provider-confirmed customer and its existing family mapping can grant access.
  const { customer } = await squareRequest<{ customer: { id: string } }>(`/v2/customers/${encodeURIComponent(purchase.customer_id)}`);
  if (customer.id !== purchase.customer_id) throw new Error('Square customer merge needs review.');
  const mappings = checked(await admin.from('square_customers').select('household_id,environment').eq('square_customer_id', customer.id).limit(3));
  const aliases = await getStaffFamilySearchAliases(admin);
  const ids = [...new Set(mappings.filter(m => m.environment === config.environment || m.environment === 'legacy').map(m => aliases.get(m.household_id) ?? m.household_id))];
  if (ids.length !== 1) throw new Error('Connect the Square customer to one family before synchronizing membership.');
  const household = ids[0];
  const eventId = posMembershipId(config.environment, `order:${orderId}`);
  const existing = checked(await admin.from('membership_events').select('notes').eq('id', eventId).maybeSingle());
  let receipt: PosMembershipReceipt;
  if (existing) {
    receipt = JSON.parse(existing.notes);
    if (receipt.version !== 1 || receipt.environment !== config.environment || receipt.order_id !== orderId || receipt.household_id !== household || receipt.customer_id !== customer.id) throw new Error('Membership family mapping changed; review the original receipt.');
  } else {
    const children = checked(await admin.from('people').select('id,birthdate').eq('household_id', household).eq('role', 'child').order('birthdate').limit(11));
    // No child is guessed when one membership was bought for a larger roster.
    // Babies under seven months are included alongside the paid first child.
    if (!children.length || children.length > 10 || children.some(c => !c.birthdate || c.birthdate > purchase.start_date)) throw new Error('Confirm children and birthdays before membership synchronization.');
    const billable = Math.max(1, children.filter(c => addMonths(c.birthdate, 7) <= purchase.start_date).length);
    if (billable !== purchase.child_count) throw new Error('Membership child count does not match the family. Review the children in Square.');
    receipt = { version: 1, environment: config.environment, household_id: household, customer_id: customer.id, order_id: orderId,
      payment_ids: purchase.payment_ids, amount_cents: purchase.amount_cents, paid_at: purchase.paid_at, start_date: purchase.start_date, end_date: purchase.end_date,
      child_ids: children.map(c => c.id), payment_status: purchase.refunded ? 'refunded' : 'paid' };
    const inserted = await admin.from('membership_events').insert({ id: eventId, household_id: household, action: ACTION, notes: JSON.stringify(receipt),
      created_by_user_id: actor ?? null, created_by_role: actor ? 'owner' : 'system' });
    if (inserted.error && inserted.error.code !== '23505') throw new Error('Unable to save membership payment evidence.');
    const saved = checked(await admin.from('membership_events').select('notes').eq('id', eventId).single());
    receipt = JSON.parse(saved.notes);
  }
  // Refunds revoke this receipt; a replay cannot turn it into a new paid month.
  if (purchase.refunded && receipt.payment_status !== 'refunded') {
    receipt = { ...receipt, payment_status: 'refunded' };
    checked(await admin.from('membership_events').update({ notes: JSON.stringify(receipt) }).eq('id', eventId));
  }
  const membershipId = await updateEntitlement(admin, receipt);
  await coverVisits(admin, receipt);
  return { status: receipt.payment_status, household_id: household, membership_id: membershipId, amount_cents: receipt.amount_cents,
    start_date: receipt.start_date, end_date: receipt.end_date };
}
