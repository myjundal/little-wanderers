import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest } from '@/lib/square-client';
import { getPartyDateKey, toPartyDateTimeIso } from '@/lib/party-config';
import { squareSaleCategory, supplementSquareRevenue } from '@/lib/square-daily-revenue';
import { allocateCatalogClassRevenue } from '@/lib/class-revenue-allocation';
import { allocateRevenue, calculateRevenue, revenueServices, type RevenueEvidence, type RevenueSources } from '@/lib/service-day-revenue';

const fields = {
  bookings: ['open_play_reservations', 'id,slot_id,household_id,child_ids,child_count,status,payment_status,payment_environment,amount_cents,square_order_id'],
  slots: ['open_play_reservation_slots', 'id,starts_at'],
  visits: ['checkins', 'id,person_id,household_id,checked_in_at,price_cents,payment_status,square_environment,square_order_id'],
  parties: ['party_bookings', 'id,start_time,status,price_quote_cents,square_environment,square_order_id,deposit_paid_cents,balance_paid_cents,payment_review_required,attendance_finalized_at'],
  series: ['class_series_sales', 'id,class_ids,child_ids,status,environment,amount_cents,square_order_id'],
  classes: ['classes', 'id,title,start_time,status'],
  registrations: ['class_registrations', 'id,class_id,person_id,status,attendance_status'],
  classCheckouts: ['square_checkout_attempts', 'id,kind,status,environment,order_id,expected_amount_cents,payload'],
  classPrograms: ['class_series_programs', 'id,title,class_ids'],
  classMappings: ['square_catalog_mappings', 'entity_key,variation_id,program_key'],
} as const;

/** Keyset paging avoids silently dropping records after PostgREST's row cap.
 * A failed source remains an explicit report warning, never a zero balance. */
export async function loadRevenueSources(admin: SupabaseClient) {
  const sources = { bookings: [], slots: [], visits: [], parties: [], series: [], classes: [], registrations: [], classCheckouts: [], classPrograms: [], classMappings: [] } as RevenueSources;
  const issues: string[] = [];
  await Promise.all((Object.keys(fields) as Array<keyof typeof fields>).map(async key => {
    const [table, select] = fields[key];
    const rows: { id: string; entity_key?: string }[] = [];
    const cursorField = key === 'classMappings' ? 'entity_key' : 'id';
    let cursor = '';
    try {
      for (;;) {
        let query = admin.from(table).select(select).order(cursorField).limit(500);
        if (key === 'classCheckouts') query = query.eq('kind', 'class').eq('environment', 'production').in('status', ['completed', 'needs_review']);
        if (key === 'classMappings') query = query.eq('kind', 'class').eq('environment', 'production');
        if (cursor) query = query.gt(cursorField, cursor);
        const { data, error } = await query;
        if (error || !data) throw new Error('Source query failed.');
        const page = data as unknown as { id: string; entity_key?: string }[];
        if (page.some(row => typeof row[cursorField] !== 'string' || row[cursorField]! <= cursor)) throw new Error('Source paging failed.');
        rows.push(...page);
        if (page.length < 500) break;
        if (rows.length >= 20000) throw new Error('Source exceeds the reporting limit.');
        cursor = page[page.length - 1][cursorField]!;
      }
      Object.assign(sources, { [key]: rows });
    } catch { issues.push(`Unable to load all ${table} records. This report is incomplete.`); }
  }));
  return { sources, issues };
}

type Money = { amount?: number; currency?: string };
type ProviderOrder = { id: string; location_id?: string; total_money?: Money; total_tax_money?: Money; total_tip_money?: Money; tenders?: { payment_id?: string }[]; line_items?: { name?: string; item_type?: string; catalog_object_id?: string; total_money?: Money; total_tax_money?: Money }[] };
type ProviderPayment = { id: string; order_id?: string; location_id?: string; status?: string; amount_money?: Money; refunded_money?: Money; tip_money?: Money; created_at?: string; source_type?: string; card_details?: { card?: { card_brand?: string } } };
function money(value?: Money, optional = false) {
  if (!value && optional) return 0;
  if (value?.currency !== 'USD' || !Number.isSafeInteger(value.amount) || value.amount! < 0) throw new Error('Payment currency or amount needs review.');
  return value.amount!;
}

/** Provider reads only: never calls fulfillment, reconciliation, invoice
 * publication, receipt persistence or any other operation that writes. */
export async function readRevenueEvidence(orderId: string, searchedOrder?: ProviderOrder): Promise<RevenueEvidence> {
  const config = squareConfig();
  if (config.environment !== 'production') throw new Error('Production Square access is required.');
  const order = searchedOrder ?? (await squareRequest<{ order: ProviderOrder }>(`/v2/orders/${encodeURIComponent(orderId)}`)).order;
  if (order.id !== orderId || order.location_id !== config.locationId) throw new Error('Order location needs review.');
  const total = money(order.total_money), tax = money(order.total_tax_money, true), tip = money(order.total_tip_money, true);
  const paymentIds = (order.tenders ?? []).map(tender => tender.payment_id);
  if (paymentIds.some(id => !id) || new Set(paymentIds).size !== paymentIds.length) throw new Error('Order payment references need review.');
  const payments = [];
  for (const id of paymentIds) {
    const { payment } = await squareRequest<{ payment: ProviderPayment }>(`/v2/payments/${encodeURIComponent(id!)}`);
    if (payment.id !== id || payment.order_id !== orderId || payment.location_id !== config.locationId) throw new Error('Payment order needs review.');
    if (['FAILED', 'CANCELED'].includes(payment.status ?? '')) continue;
    if (payment.status !== 'COMPLETED' || !payment.created_at || !Number.isFinite(Date.parse(payment.created_at))) throw new Error('Payment is not settled.');
    const amount = money(payment.amount_money), refund = money(payment.refunded_money, true);
    if (refund > amount || ((tax || tip) && refund)) throw new Error('Refund with tax or tip needs a separate allocation.');
    payments.push({ id: payment.id, amount_cents: amount, refunded_cents: refund, paid_at: payment.created_at, gift_card: payment.source_type === 'GIFT_CARD' || payment.card_details?.card?.card_brand === 'SQUARE_GIFT_CARD', tip: money(payment.tip_money, true) });
  }
  const received = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  if (total < tax + tip || received + tip > total || payments.reduce((sum, payment) => sum + payment.tip, 0) !== tip) throw new Error('Order amounts need review.');
  // Do not guess which portion of a partially paid invoice was tax.
  if (tax && received + tip !== total) throw new Error('Partial or split tax payment needs review.');
  const taxes = allocateRevenue(tax, payments.map(payment => payment.amount_cents));
  payments.forEach((payment, index) => { payment.amount_cents -= taxes[index]; });
  return { ...orderAllocation(order), payments: payments.map(payment => ({ id: payment.id, amount_cents: payment.amount_cents, refunded_cents: payment.refunded_cents, paid_at: payment.paid_at, gift_card: payment.gift_card })) };
}

function orderAllocation(order: ProviderOrder): RevenueEvidence {
  const total = money(order.total_money), tax = money(order.total_tax_money, true), tip = money(order.total_tip_money, true);
  if (total < tax + tip) throw new Error('Order amounts need review.');
  return { order_id: order.id, service_total_cents: total - tax - tip, tax_cents: tax, tip_cents: tip,
    items: (order.line_items ?? []).map(item => ({ label: (item.name || 'Square sale').slice(0, 200), category: squareSaleCategory(item.name || '', item.item_type),
      catalog_object_id: item.catalog_object_id, amount_cents: money(item.total_money) - money(item.total_tax_money, true) })), payments: [] };
}

/** Scan itemized history so a POS prepayment is still discoverable on a later
 * class date. No arbitrary lookback window can silently drop earlier payments.
 * SearchOrders is read-only despite its POST method. */
export async function readHistoricalClassOrders(variationIds: Set<string>) {
  const config = squareConfig();
  if (config.environment !== 'production') throw new Error('Production Square access is required.');
  const orders = new Map<string, ProviderOrder>();
  const cursors = new Set<string>();
  const query = { filter: { date_time_filter: { created_at: { end_at: new Date().toISOString() } } }, sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' } };
  let cursor: string | undefined;
  for (;;) {
    const result = await squareRequest<{ orders?: ProviderOrder[]; cursor?: string }>('/v2/orders/search', 'POST', { location_ids: [config.locationId], return_entries: false, limit: 500, query, ...(cursor ? { cursor } : {}) });
    for (const order of result.orders ?? []) {
      if (order.location_id !== config.locationId) throw new Error('Historical order location needs review.');
      if (order.tenders?.length && order.line_items?.some(item => squareSaleCategory(item.name || '', item.item_type) === 'class' || variationIds.has(item.catalog_object_id ?? ''))) orders.set(order.id, order);
    }
    if (!result.cursor) break;
    if (cursors.has(result.cursor) || cursors.size >= 39) throw new Error('Class payment history is incomplete.');
    cursors.add(result.cursor); cursor = result.cursor;
  }
  return orders;
}

/** Scan all settled tenders, including cash and sales with no website booking.
 * Cursor paging continues even when Square returns fewer than the requested limit. */
export async function readDailySquarePayments(date: string) {
  const config = squareConfig();
  if (config.environment !== 'production') throw new Error('Production Square access is required.');
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const base = { begin_time: toPartyDateTimeIso(date, 0), end_time: toPartyDateTimeIso(next, 0), location_id: config.locationId, limit: '100', sort_order: 'ASC' };
  const payments = new Map<string, ProviderPayment>();
  const cursors = new Set<string>();
  let cursor = '';
  for (;;) {
    const query = new URLSearchParams({ ...base, ...(cursor ? { cursor } : {}) });
    const result = await squareRequest<{ payments?: ProviderPayment[]; cursor?: string }>(`/v2/payments?${query}`);
    for (const payment of result.payments ?? []) {
      if (payment.location_id !== config.locationId) throw new Error('Payment location needs review.');
      if (payment.status === 'COMPLETED') {
        if (!payment.id || !payment.created_at || !Number.isFinite(Date.parse(payment.created_at))) throw new Error('Payment date needs review.');
        if (getPartyDateKey(payment.created_at) === date) payments.set(payment.id, payment);
      }
    }
    if (!result.cursor) break;
    if (cursors.has(result.cursor) || cursors.size >= 100) throw new Error('Payment paging could not be completed.');
    cursors.add(result.cursor); cursor = result.cursor;
  }
  return [...payments.values()];
}

function unlinkedPaymentEvidence(payment: ProviderPayment): RevenueEvidence {
  const amount = money(payment.amount_money), refunded = money(payment.refunded_money, true);
  if (refunded > amount || !payment.created_at) throw new Error('Payment refund needs review.');
  return { order_id: `payment:${payment.id}`, service_total_cents: amount, tax_cents: 0, tip_cents: money(payment.tip_money, true),
    items: [{ label: 'Other Square payment', category: 'other', amount_cents: amount }],
    payments: [{ id: payment.id, amount_cents: amount, refunded_cents: refunded, paid_at: payment.created_at,
      gift_card: payment.source_type === 'GIFT_CARD' || payment.card_details?.card?.card_brand === 'SQUARE_GIFT_CARD' }] };
}

export async function getServiceDayRevenue(admin: SupabaseClient, date: string) {
  const { sources, issues } = await loadRevenueSources(admin);
  const baseServices = revenueServices(sources);
  const variations = new Set((sources.classMappings ?? []).map(row => row.variation_id));
  let historicalOrders = new Map<string, ProviderOrder>();
  try { historicalOrders = await readHistoricalClassOrders(variations); }
  catch { issues.push('Unable to load complete class payment history. Earlier POS prepayments may be missing.'); }
  const historicalAllocations = [...historicalOrders.values()].map(order => {
    try { return orderAllocation(order); }
    catch { issues.push(`Unable to allocate class order ${order.id.slice(0, 8)}.`); return null; }
  }).filter((row): row is RevenueEvidence => row !== null);
  for (const receipt of historicalAllocations) for (const item of receipt.items ?? []) if (variations.has(item.catalog_object_id ?? '')) item.category = 'class';
  const services = allocateCatalogClassRevenue(baseServices, historicalAllocations, sources);
  let payments: ProviderPayment[] = [];
  try { payments = await readDailySquarePayments(date); }
  catch { issues.push('Unable to load all Square sales. Café, gift cards, memberships and other counter sales may be missing.'); }
  const ids = [...new Set([...services.filter(row => row.date === date).flatMap(row => row.charges.map(charge => charge.order_id)), ...payments.flatMap(payment => payment.order_id ? [payment.order_id] : [])])];
  if (ids.length > 300) throw new Error('Too many orders for one daily report.');
  const evidence = new Map<string, RevenueEvidence>();
  for (const payment of payments.filter(payment => !payment.order_id)) {
    try { const receipt = unlinkedPaymentEvidence(payment); evidence.set(receipt.order_id, receipt); }
    catch { issues.push(`Unable to verify Square payment ${payment.id.slice(0, 8)}.`); }
  }
  for (let offset = 0; offset < ids.length; offset += 6) {
    await Promise.all(ids.slice(offset, offset + 6).map(async id => {
      try {
        const receipt = await readRevenueEvidence(id, historicalOrders.get(id));
        for (const item of receipt.items ?? []) if (variations.has(item.catalog_object_id ?? '')) item.category = 'class';
        evidence.set(id, receipt);
      }
      catch (error) { issues.push(`Unable to verify Square receipt ${id.slice(0, 8)}.`); console.warn('revenue_receipt_unavailable', id, error instanceof Error ? error.message : 'Verification failed'); }
    }));
  }
  return calculateRevenue(supplementSquareRevenue(services, evidence, date), evidence, date, issues);
}
