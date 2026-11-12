import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest } from '@/lib/square-client';
import { calculateRevenue, revenueServices, type RevenueEvidence, type RevenueSources } from '@/lib/service-day-revenue';

const fields = {
  bookings: ['open_play_reservations', 'id,slot_id,household_id,child_ids,child_count,status,payment_status,payment_environment,amount_cents,square_order_id'],
  slots: ['open_play_reservation_slots', 'id,starts_at'],
  visits: ['checkins', 'id,person_id,household_id,checked_in_at,price_cents,payment_status,square_environment,square_order_id'],
  parties: ['party_bookings', 'id,start_time,status,price_quote_cents,square_environment,square_order_id,deposit_paid_cents,balance_paid_cents,payment_review_required,attendance_finalized_at'],
  series: ['class_series_sales', 'id,class_ids,child_ids,status,environment,amount_cents,square_order_id'],
  classes: ['classes', 'id,title,start_time,status'],
  registrations: ['class_registrations', 'id,class_id,person_id,status,attendance_status'],
  classCheckouts: ['square_checkout_attempts', 'id,kind,status,environment,order_id,expected_amount_cents,payload'],
} as const;

/** Keyset paging avoids silently dropping records after PostgREST's row cap.
 * A failed source remains an explicit report warning, never a zero balance. */
export async function loadRevenueSources(admin: SupabaseClient) {
  const sources = { bookings: [], slots: [], visits: [], parties: [], series: [], classes: [], registrations: [], classCheckouts: [] } as RevenueSources;
  const issues: string[] = [];
  await Promise.all((Object.keys(fields) as Array<keyof typeof fields>).map(async key => {
    const [table, select] = fields[key];
    const rows: { id: string }[] = [];
    let cursor = '';
    try {
      for (;;) {
        let query = admin.from(table).select(select).order('id').limit(500);
        if (key === 'classCheckouts') query = query.eq('kind', 'class').eq('environment', 'production').in('status', ['completed', 'needs_review']);
        if (cursor) query = query.gt('id', cursor);
        const { data, error } = await query;
        if (error || !data) throw new Error('Source query failed.');
        const page = data as unknown as { id: string }[];
        if (page.some(row => typeof row.id !== 'string' || row.id <= cursor)) throw new Error('Source paging failed.');
        rows.push(...page);
        if (page.length < 500) break;
        if (rows.length >= 20000) throw new Error('Source exceeds the reporting limit.');
        cursor = page[page.length - 1].id;
      }
      Object.assign(sources, { [key]: rows });
    } catch { issues.push(`Unable to load all ${table} records. This report is incomplete.`); }
  }));
  return { sources, issues };
}

type Money = { amount?: number; currency?: string };
type ProviderOrder = { id: string; location_id?: string; total_money?: Money; total_tax_money?: Money; total_tip_money?: Money; tenders?: { payment_id?: string }[] };
type ProviderPayment = { id: string; order_id?: string; location_id?: string; status?: string; amount_money?: Money; refunded_money?: Money; tip_money?: Money; created_at?: string };
function money(value?: Money, optional = false) {
  if (!value && optional) return 0;
  if (value?.currency !== 'USD' || !Number.isSafeInteger(value.amount) || value.amount! < 0) throw new Error('Payment currency or amount needs review.');
  return value.amount!;
}

/** Provider reads only: never calls fulfillment, reconciliation, invoice
 * publication, receipt persistence or any other operation that writes. */
export async function readRevenueEvidence(orderId: string): Promise<RevenueEvidence> {
  const config = squareConfig();
  if (config.environment !== 'production') throw new Error('Production Square access is required.');
  const { order } = await squareRequest<{ order: ProviderOrder }>(`/v2/orders/${encodeURIComponent(orderId)}`);
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
    payments.push({ id: payment.id, amount_cents: amount, refunded_cents: refund, paid_at: payment.created_at, tip: money(payment.tip_money, true) });
  }
  const received = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  if (total < tax + tip || received + tip > total || payments.reduce((sum, payment) => sum + payment.tip, 0) !== tip) throw new Error('Order amounts need review.');
  // Do not guess which portion of a partially paid invoice was tax.
  if (tax && (received + tip !== total || payments.length !== 1)) throw new Error('Partial or split tax payment needs review.');
  if (tax) payments[0].amount_cents -= tax;
  return { order_id: orderId, service_total_cents: total - tax - tip, tax_cents: tax, tip_cents: tip, payments: payments.map(payment => ({ id: payment.id, amount_cents: payment.amount_cents, refunded_cents: payment.refunded_cents, paid_at: payment.paid_at })) };
}

export async function getServiceDayRevenue(admin: SupabaseClient, date: string) {
  const { sources, issues } = await loadRevenueSources(admin);
  const services = revenueServices(sources);
  const ids = [...new Set(services.filter(row => row.date === date).flatMap(row => row.charges.map(charge => charge.order_id)))];
  if (ids.length > 300) throw new Error('Too many orders for one daily report.');
  const evidence = new Map<string, RevenueEvidence>();
  for (let offset = 0; offset < ids.length; offset += 6) {
    await Promise.all(ids.slice(offset, offset + 6).map(async id => {
      try { evidence.set(id, await readRevenueEvidence(id)); }
      catch (error) { console.warn('revenue_receipt_unavailable', id, error instanceof Error ? error.message : 'Verification failed'); }
    }));
  }
  return calculateRevenue(services, evidence, date, issues);
}
