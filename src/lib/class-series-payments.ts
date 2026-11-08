import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, assertUsd, assertSquarePaymentUrl, type SquareOrder, type SquareInvoice } from '@/lib/square-client';

export const JAMIE_PROGRAM_ID = 'jamie-art-2026-11-12';
export const SERIES_TERMS = 'This five-session series is nonrefundable unless canceled by the instructor. Payment is due November 11, 2026 at 5:00 PM Eastern (24 hours before the first class). Your seat is confirmed only after full payment is completed. Spaces are limited.';
export const SERIES_OPTIONAL_PAYMENT_NOTE = 'Your seat is confirmed only after payment. If your plans change and you decide not to attend, simply leave this invoice unpaid.';
export const SERIES_DATES = 'November 12, November 19, December 3, December 10, and December 17, 2026, 5:00–5:45 PM Eastern. No class on November 26 (Thanksgiving).';
export type SeriesSale = {
  id: string; program_id: string; household_id: string; child_ids: string[]; class_ids: string[];
  environment: string; location_id: string; amount_cents: number; discount_cents: number;
  recipient_email: string; source: 'invoice' | 'online'; status: 'draft' | 'held' | 'paid' | 'cancelled' | 'review';
  due_at: string; hold_until: string | null; created_at: string;
  square_customer_id: string | null; square_order_id: string | null; square_invoice_id: string | null;
  payment_url: string | null; delivery_method: string | null; sent_at: string | null;
};
type Payment = { id: string; order_id?: string; location_id?: string; status?: string; amount_money?: { amount?: number; currency?: string }; refunded_money?: { amount?: number }; tip_money?: { amount?: number }; created_at?: string };
function checked<T>(result: { data: T; error: { message: string } | null }): T { if (result.error) throw new Error(result.error.message); return result.data; }
export async function readSeriesSale(db: SupabaseClient, id: string) {
  const sale = checked(await db.from('class_series_sales').select('*').eq('id', id).maybeSingle()) as SeriesSale | null;
  if (!sale) throw new Error('Series payment not found');
  const config = squareConfig();
  if (sale.environment !== config.environment || sale.location_id !== config.locationId) throw new Error('Series payment environment mismatch');
  return sale;
}
async function saveSale(db: SupabaseClient, sale: SeriesSale, patch: Record<string, unknown>) {
  return checked(await db.from('class_series_sales').update(patch).eq('id', sale.id).select('*').single()) as SeriesSale;
}

/** A DRAFT is never published or emailed by this function. Every Square write has a stable key. */
export async function createSeriesInvoiceDraft(db: SupabaseClient, input: { householdId: string; childIds: string[]; userId: string; source: 'invoice' | 'online' }) {
  const config = squareConfig();
  let sale = checked(await db.rpc('prepare_class_series_sale', { p_program: JAMIE_PROGRAM_ID, p_family: input.householdId, p_children: input.childIds, p_user: input.userId, p_environment: config.environment, p_location: config.locationId, p_source: input.source })) as SeriesSale;
  if (sale.square_invoice_id) return sale;
  if (!sale.square_customer_id) {
    const result = await squareRequest<{ customer: { id: string } }>('/v2/customers', 'POST', {
      idempotency_key: `cs-customer-${sale.id}`, reference_id: sale.household_id, email_address: sale.recipient_email,
    });
    sale = await saveSale(db, sale, { square_customer_id: result.customer.id });
  }
  const children = checked(await db.from('people').select('id,first_name,last_name').in('id', sale.child_ids)) ?? [];
  const names = sale.child_ids.map(id => {
    const child = children.find(person => person.id === id);
    if (!child) throw new Error('Child profile changed; contact us');
    return [child.first_name, child.last_name].filter(Boolean).join(' ');
  });
  const description = `Little Hands, Big Canvases with Ms. Jamie — 5-week series.\nChildren: ${names.join(', ')}.\n${SERIES_DATES}\n${SERIES_TERMS}\n${SERIES_OPTIONAL_PAYMENT_NOTE}\nSibling/Twin discount: $20 off the second child's series registration.`;
  if (!sale.square_order_id) {
    const { order } = await squareRequest<{ order: SquareOrder }>('/v2/orders', 'POST', {
      idempotency_key: `cs-order-${sale.id}`, order: {
        location_id: config.locationId, reference_id: `cs_${sale.id}`, customer_id: sale.square_customer_id,
        line_items: [{ name: 'Little Hands, Big Canvases — full 5-session series', quantity: String(sale.child_ids.length), base_price_money: { amount: (sale.amount_cents + sale.discount_cents) / sale.child_ids.length, currency: 'USD' }, note: `${names.join(', ')}. ${SERIES_DATES}` }],
        ...(sale.discount_cents ? { discounts: [{ uid: 'sibling', name: 'Sibling/Twin — second child $20 off', type: 'FIXED_AMOUNT', scope: 'ORDER', amount_money: { amount: sale.discount_cents, currency: 'USD' } }] } : {}),
      },
    });
    assertUsd(order.total_money, sale.amount_cents);
    sale = await saveSale(db, sale, { square_order_id: order.id });
  }
  const { invoice } = await squareRequest<{ invoice: SquareInvoice }>('/v2/invoices', 'POST', {
    idempotency_key: `cs-invoice-${sale.id}`, invoice: {
      location_id: config.locationId, order_id: sale.square_order_id,
      primary_recipient: { customer_id: sale.square_customer_id },
      delivery_method: input.source === 'invoice' ? 'EMAIL' : 'SHARE_MANUALLY',
      title: 'Jamie Art — 5-week series starting November 12', description,
      payment_requests: [{ request_type: 'BALANCE', due_date: '2026-11-11', automatic_payment_source: 'NONE', tipping_enabled: false }],
      accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false },
      sale_or_service_date: '2026-11-12', store_payment_method_enabled: false,
    },
  });
  if (invoice.status !== 'DRAFT' || invoice.order_id !== sale.square_order_id) throw new Error('Square invoice needs review');
  return saveSale(db, sale, { square_invoice_id: invoice.id, square_invoice_version: invoice.version, delivery_method: input.source === 'invoice' ? 'EMAIL' : 'SHARE_MANUALLY' });
}

/** Update an unsent provider draft only. Never publishes or emails an invoice. */
export async function updateSeriesDraftPaymentNote(db: SupabaseClient, sale: SeriesSale) {
  if (sale.sent_at || !['draft', 'held'].includes(sale.status) || !sale.square_invoice_id) throw new Error('Only an unsent draft can be updated');
  const path = `/v2/invoices/${encodeURIComponent(sale.square_invoice_id)}`;
  const { invoice } = await squareRequest<{ invoice: SquareInvoice }>(path);
  if (invoice.status !== 'DRAFT') throw new Error('Only an unsent draft can be updated');
  if (invoice.id !== sale.square_invoice_id || invoice.order_id !== sale.square_order_id || invoice.location_id !== sale.location_id || invoice.primary_recipient?.customer_id !== sale.square_customer_id) throw new Error('Invoice does not match this family');
  if (!invoice.description) throw new Error('Invoice description needs review');
  const description = invoice.description.includes(SERIES_OPTIONAL_PAYMENT_NOTE) ? invoice.description : `${invoice.description}\n\n${SERIES_OPTIONAL_PAYMENT_NOTE}`;
  if (description !== invoice.description) {
    await squareRequest(path, 'PUT', { idempotency_key: `cs-optional-note-v1-${sale.id}-${invoice.version}`, invoice: { version: invoice.version, description } });
  }
  const { invoice: verified } = await squareRequest<{ invoice: SquareInvoice }>(path);
  if (verified.status !== 'DRAFT' || verified.description !== description) throw new Error('Draft note update needs review');
  return { sale: await saveSale(db, sale, { square_invoice_version: verified.version }), description };
}

/** Only call for an explicit customer Pay now action or an owner's review-and-send action. */
export async function publishSeriesInvoice(db: SupabaseClient, sale: SeriesSale, email: boolean) {
  sale = checked(await db.rpc('hold_class_series_sale', { p_id: sale.id, p_invoice: email })) as SeriesSale;
  const current = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(sale.square_invoice_id!)}`);
  let invoice = current.invoice;
  let deliveryMethod = sale.delivery_method;
  if (invoice.status === 'PAID') return verifySeriesPayment(db, sale);
  if (invoice.status === 'DRAFT') {
    const delivery = email ? 'EMAIL' : 'SHARE_MANUALLY';
    deliveryMethod = delivery;
    const updated = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(invoice.id)}`, 'PUT', {
      idempotency_key: `cs-delivery-note-v1-${sale.id}-${email ? 'email' : 'manual'}-${invoice.version}`,
      invoice: { version: invoice.version, delivery_method: delivery, description: invoice.description?.includes(SERIES_OPTIONAL_PAYMENT_NOTE) ? invoice.description : `${invoice.description ?? ''}\n\n${SERIES_OPTIONAL_PAYMENT_NOTE}`.trim() },
    });
    invoice = (await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(invoice.id)}/publish`, 'POST', { version: updated.invoice.version, idempotency_key: `cs-publish-${sale.id}` })).invoice;
  }
  if (!['UNPAID', 'PARTIALLY_PAID', 'SCHEDULED'].includes(invoice.status ?? '')) throw new Error('Invoice is not available for payment');
  const paymentUrl = assertSquarePaymentUrl(invoice.public_url);
  // A provider-generated URL is the only URL returned to the client.
  return saveSale(db, sale, { payment_url: paymentUrl, square_invoice_version: invoice.version, delivery_method: deliveryMethod, ...(email && !sale.sent_at ? { sent_at: new Date().toISOString() } : {}) });
}

export async function verifySeriesPayment(db: SupabaseClient, sale: SeriesSale): Promise<SeriesSale> {
  const config = squareConfig();
  if (sale.environment !== config.environment || sale.location_id !== config.locationId) throw new Error('Series payment environment mismatch');
  if (sale.status === 'paid') return sale;
  if (!sale.square_invoice_id || !sale.square_order_id) return sale;
  const { invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(sale.square_invoice_id)}`);
  if (invoice.status !== 'PAID') return sale;
  if (invoice.id !== sale.square_invoice_id || invoice.order_id !== sale.square_order_id || invoice.location_id !== config.locationId || invoice.primary_recipient?.customer_id !== sale.square_customer_id) throw new Error('Invoice payment does not match this family');
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(sale.square_order_id)}`);
  if (order.id !== sale.square_order_id || order.location_id !== config.locationId || order.reference_id !== `cs_${sale.id}` || order.customer_id !== sale.square_customer_id) throw new Error('Series order does not match');
  assertUsd(order.total_money, sale.amount_cents);
  assertUsd(order.net_amount_due_money, 0);
  const paymentIds = (order.tenders ?? []).map(tender => tender.payment_id);
  if (!paymentIds.length || paymentIds.some(id => !id) || new Set(paymentIds).size !== paymentIds.length) throw new Error('Completed Square payment receipts are required');
  let total = 0;
  for (const id of paymentIds) {
    const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(id!)}`);
    if (payment.id !== id || payment.order_id !== order.id || payment.location_id !== config.locationId || payment.status !== 'COMPLETED'
      || payment.amount_money?.currency !== 'USD' || !Number.isSafeInteger(payment.amount_money.amount) || payment.amount_money.amount! <= 0
      || (payment.refunded_money?.amount ?? 0) !== 0 || (payment.tip_money?.amount ?? 0) !== 0
      || !payment.created_at || !Number.isFinite(Date.parse(payment.created_at)) || Date.parse(payment.created_at) < Date.parse(sale.created_at) - 60_000) throw new Error('Series payment requires review');
    total += payment.amount_money.amount!;
  }
  if (total !== sale.amount_cents) throw new Error('Series paid amount does not match');
  return checked(await db.rpc('fulfill_class_series_sale', { p_id: sale.id, p_order: order.id, p_payments: paymentIds, p_amount: total })) as SeriesSale;
}

export async function closeUnpaidSeriesInvoice(db: SupabaseClient, sale: SeriesSale) {
  sale = await verifySeriesPayment(db, sale);
  if (sale.status === 'paid' || sale.status === 'review') return sale;
  if (!sale.square_invoice_id) throw new Error('Invoice creation needs review before releasing seats');
  const { invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(sale.square_invoice_id)}`);
  let providerStatus = invoice.status;
  if (providerStatus === 'DRAFT') {
    await squareRequest(`/v2/invoices/${encodeURIComponent(invoice.id)}?version=${invoice.version}`, 'DELETE');
    providerStatus = 'DELETED';
  } else if (providerStatus !== 'CANCELED') {
    const closed = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(invoice.id)}/cancel`, 'POST', { version: invoice.version });
    providerStatus = closed.invoice.status;
  }
  if (!['CANCELED', 'DELETED'].includes(providerStatus ?? '')) throw new Error('Payment is still in progress; seats remain held');
  checked(await db.rpc('cancel_class_series_sale', { p_id: sale.id, p_provider_status: providerStatus }));
  return { ...sale, status: 'cancelled' as const };
}

/** Reconcile verified payments and close unpaid pages after the payment deadline. */
export async function reconcileSeriesSales(db: SupabaseClient, householdId?: string) {
  let query = db.from('class_series_sales').select('*').eq('program_id', JAMIE_PROGRAM_ID).eq('environment', squareConfig().environment).eq('status', 'held').limit(12);
  if (householdId) query = query.eq('household_id', householdId);
  const sales = checked(await query) as SeriesSale[];
  for (const sale of sales) {
    try {
      const current = await verifySeriesPayment(db, sale);
      if (current.status === 'held' && current.hold_until && Date.parse(current.hold_until) <= Date.now()) await closeUnpaidSeriesInvoice(db, current);
    } catch (error) {
      // Do not free capacity after a timeout or an ambiguous provider response.
      console.error('class_series_reconciliation_failed', sale.id, error instanceof Error ? error.message : 'Provider reconciliation failed');
    }
  }
}

