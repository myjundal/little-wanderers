import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureSquareCustomer } from '@/lib/square-customers';
import {
  assertSquarePaymentUrl, assertUsd, requirePaymentFlow, squareConfig, squareRequest,
  type SquareInvoice, type SquareOrder, type SquareEnvironment,
} from '@/lib/square-client';
import { PARTY_DEPOSIT_CENTS, PARTY_TOTAL_FEE_CENTS } from '@/lib/party-info';

export type InvoiceBooking = {
  id: string; household_id: string; start_time: string; end_time: string; created_at: string; status: string;
  square_environment: SquareEnvironment | null; square_location_id: string | null; square_customer_id: string | null;
  square_item_variation_id: string | null; square_order_id: string | null; square_invoice_id: string | null;
  square_invoice_timezone?: string | null;
  square_invoice_version: number | null; square_invoice_url: string | null; square_invoice_status: string | null;
  deposit_paid_cents: number; balance_paid_cents: number; payment_review_required: boolean;
  payment_hold_expires_at: string | null; confirmation_email_sent_at?: string | null;
};

export function partyInvoiceDueDates(createdAt: string, startsAt: string, timezone = 'America/New_York') {
  const date = (value: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
  const deposit = date(createdAt);
  const partyDate = date(startsAt);
  const previousDay = new Date(`${partyDate}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const balance = previousDay.toISOString().slice(0, 10);
  return { deposit, balance: balance < deposit ? deposit : balance };
}

export function buildPartyInvoice(booking: InvoiceBooking) {
  if (!booking.square_order_id || !booking.square_customer_id) throw new Error('Invoice mapping is incomplete');
  const dates = partyInvoiceDueDates(booking.created_at, booking.start_time, booking.square_invoice_timezone || 'America/New_York');
  return {
    idempotency_key: `lw-party-invoice-${booking.id}`,
    invoice: {
      location_id: booking.square_location_id,
      order_id: booking.square_order_id,
      primary_recipient: { customer_id: booking.square_customer_id },
      title: 'Little Wanderers Birthday Party',
      description: `Reservation ${booking.id}. Total $300: $150 deposit and $150 remaining balance.`,
      delivery_method: 'SHARE_MANUALLY',
      accepted_payment_methods: { card: true },
      payment_requests: [
        { request_type: 'DEPOSIT', fixed_amount_requested_money: { amount: PARTY_DEPOSIT_CENTS, currency: 'USD' }, due_date: dates.deposit, automatic_payment_source: 'NONE' },
        { request_type: 'BALANCE', due_date: dates.balance, automatic_payment_source: 'NONE' },
      ],
    },
  };
}

/** Fresh, authenticated Invoice/Order state is the payment authority, including native POS invoice payments. */
export function verifyPartyInvoice(booking: InvoiceBooking, invoice: SquareInvoice, order: SquareOrder) {
  const config = squareConfig();
  if (booking.square_environment !== config.environment || booking.square_location_id !== config.locationId
    || invoice.location_id !== config.locationId || order.location_id !== config.locationId
    || invoice.id !== booking.square_invoice_id || invoice.order_id !== booking.square_order_id
    || order.id !== booking.square_order_id || order.reference_id !== booking.id
    || invoice.primary_recipient?.customer_id !== booking.square_customer_id || order.customer_id !== booking.square_customer_id) {
    throw new Error('Square invoice does not match this reservation');
  }
  assertUsd(order.total_money, PARTY_TOTAL_FEE_CENTS);
  if (!Number.isSafeInteger(invoice.version) || invoice.version < 0) throw new Error('Invalid invoice version');
  const requests = invoice.payment_requests ?? [];
  const deposit = requests.find(r => r.request_type === 'DEPOSIT');
  const balance = requests.find(r => r.request_type === 'BALANCE');
  if (requests.length !== 2 || !deposit || !balance) throw new Error('Unexpected invoice payment schedule');
  assertUsd(deposit.computed_amount_money, PARTY_DEPOSIT_CENTS);
  assertUsd(balance.computed_amount_money, PARTY_TOTAL_FEE_CENTS - PARTY_DEPOSIT_CENTS);
  const paid = (value: typeof deposit) => {
    if (!value.total_completed_amount_money) return 0;
    const money = value.total_completed_amount_money;
    if (money.currency !== 'USD' || !Number.isSafeInteger(money.amount) || money.amount! < 0 || money.amount! > 15000) {
      throw new Error('Invalid invoice paid amount');
    }
    return money.amount!;
  };
  const depositPaid = paid(deposit), balancePaid = paid(balance);
  const normal = ['UNPAID','PARTIALLY_PAID','PAID','PAYMENT_PENDING','DRAFT','SCHEDULED'].includes(invoice.status ?? '');
  const review = !normal && !(invoice.status === 'CANCELED' && depositPaid + balancePaid === 0);
  if (invoice.status === 'PAID' && depositPaid + balancePaid !== PARTY_TOTAL_FEE_CENTS) throw new Error('Invoice paid totals do not match');
  // Pending bank/card funds do not establish a deposit; completed amounts are required.
  return { depositPaid, balancePaid, review };
}

async function saveBooking(admin: SupabaseClient, bookingId: string, fields: Record<string, unknown>) {
  const { data, error } = await admin.from('party_bookings').update(fields).eq('id', bookingId).select('*').single();
  if (error) throw new Error(error.message);
  return data as InvoiceBooking;
}

export async function ensurePartyInvoice(admin: SupabaseClient, initial: InvoiceBooking, fallbackEmail?: string | null) {
  const config = requirePaymentFlow('party');
  if (initial.square_environment !== config.environment || initial.square_location_id !== config.locationId) throw new Error('Reservation belongs to another Square environment');
  if (initial.status !== 'pending') throw new Error('Only a pending reservation can start an invoice');
  let booking = initial;
  if (!booking.square_customer_id) {
    const customerId = await ensureSquareCustomer(admin, booking.household_id, fallbackEmail);
    booking = await saveBooking(admin, booking.id, { square_customer_id: customerId });
  }
  if (!booking.square_order_id) {
    const { order } = await squareRequest<{ order: SquareOrder }>('/v2/orders', 'POST', {
      idempotency_key: `lw-party-order-${booking.id}`,
      order: {
        location_id: config.locationId, reference_id: booking.id, customer_id: booking.square_customer_id,
        line_items: [{
          ...(booking.square_item_variation_id ? { catalog_object_id: booking.square_item_variation_id } : { name: 'Little Wanderers Birthday Party' }),
          quantity: '1', base_price_money: { amount: PARTY_TOTAL_FEE_CENTS, currency: 'USD' },
        }],
      },
    });
    assertUsd(order.total_money, PARTY_TOTAL_FEE_CENTS);
    booking = await saveBooking(admin, booking.id, { square_order_id: order.id });
  }
  let invoice: SquareInvoice;
  if (booking.square_invoice_id) {
    ({ invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(booking.square_invoice_id)}`));
  } else {
    ({ invoice } = await squareRequest<{ invoice: SquareInvoice }>('/v2/invoices', 'POST', buildPartyInvoice(booking)));
    booking = await saveBooking(admin, booking.id, { square_invoice_id: invoice.id });
  }
  if (invoice.status === 'DRAFT') {
    ({ invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(invoice.id)}/publish`, 'POST', {
      idempotency_key: `lw-party-publish-${booking.id}`, version: invoice.version,
    }));
  }
  const result = await reconcilePartyInvoice(admin, booking, invoice);
  if (result.status === 'cancelled' || result.payment_review_required) throw new Error('This invoice requires staff assistance');
  return { booking: result, url: assertSquarePaymentUrl(invoice.public_url) };
}

export async function reconcilePartyInvoice(admin: SupabaseClient, booking: InvoiceBooking, knownInvoice?: SquareInvoice) {
  if (!booking.square_invoice_id) throw new Error('This reservation has no Square invoice');
  const invoice = knownInvoice ?? (await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(booking.square_invoice_id)}`)).invoice;
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(booking.square_order_id!)}`);
  const evidence = verifyPartyInvoice(booking, invoice, order);
  const { data, error } = await admin.rpc('apply_party_invoice', {
    p_id: booking.id, p_environment: booking.square_environment, p_invoice_id: invoice.id,
    p_version: invoice.version, p_status: invoice.status, p_deposit: evidence.depositPaid,
    p_balance: evidence.balancePaid, p_review: evidence.review,
    p_url: invoice.public_url ? assertSquarePaymentUrl(invoice.public_url) : null,
  });
  if (error) throw new Error(error.message);
  return data as InvoiceBooking;
}

export async function startPartyInvoice(admin: SupabaseClient, input: {
  householdId: string; userId: string; role: string; email?: string | null; booking: Record<string, unknown>;
}) {
  const config = requirePaymentFlow('party');
  const variationId = process.env.SQUARE_PARTY_ITEM_VARIATION_ID || null;
  const { location } = await squareRequest<{ location: { id: string; currency?: string; status?: string; timezone?: string } }>(`/v2/locations/${encodeURIComponent(config.locationId)}`);
  if (location.id !== config.locationId || location.currency !== 'USD' || location.status !== 'ACTIVE' || !location.timezone) {
    throw new Error('An active USD Square location with a timezone is required');
  }
  if (config.environment === 'production' && !variationId) throw new Error('Production party catalog variation is not configured');
  if (variationId) {
    const { object } = await squareRequest<{ object: { type: string; is_deleted?: boolean; item_variation_data?: { price_money?: { amount?: number; currency?: string } } } }>(`/v2/catalog/object/${encodeURIComponent(variationId)}`);
    if (object.type !== 'ITEM_VARIATION' || object.is_deleted) throw new Error('Invalid party catalog variation');
    assertUsd(object.item_variation_data?.price_money, PARTY_TOTAL_FEE_CENTS);
  }
  const { data, error } = await admin.rpc('reserve_party_invoice', {
    p_household: input.householdId, p_environment: config.environment, p_location: config.locationId,
    p_user: input.userId, p_role: input.role, p_booking: { ...input.booking, variation_id: variationId, timezone: location.timezone },
  });
  if (error) throw new Error(error.message);
  return ensurePartyInvoice(admin, data as InvoiceBooking, input.email);
}

export async function cancelPartyInvoice(admin: SupabaseClient, booking: InvoiceBooking) {
  requirePaymentFlow('party');
  // Recover a timed-out creation before cancelling. Never release a slot with a potentially payable invoice.
  let current = booking;
  if (!current.square_invoice_id) current = (await ensurePartyInvoice(admin, current)).booking;
  let { invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(current.square_invoice_id!)}`);
  current = await reconcilePartyInvoice(admin, current, invoice);
  if (current.deposit_paid_cents + current.balance_paid_cents > 0 || current.payment_review_required || invoice.status === 'PAYMENT_PENDING') {
    throw new Error('Payment exists or is pending; review the invoice before cancelling');
  }
  if (invoice.status !== 'CANCELED') {
    ({ invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(invoice.id)}/cancel`, 'POST', { version: invoice.version }));
  }
  return reconcilePartyInvoice(admin, current, invoice);
}

export async function expirePartyInvoiceHolds(admin: SupabaseClient) {
  const config = requirePaymentFlow('party');
  const { data, error } = await admin.from('party_bookings').select('*').eq('square_environment', config.environment)
    .eq('status', 'pending').lte('payment_hold_expires_at', new Date().toISOString()).limit(20);
  if (error) throw new Error(error.message);
  const errors: string[] = [];
  for (const booking of data ?? []) {
    try { await cancelPartyInvoice(admin, booking as InvoiceBooking); }
    catch { errors.push(booking.id); } // Keep the slot held on uncertainty; a later retry can safely recover.
  }
  return { checked: data?.length ?? 0, review_booking_ids: errors };
}
