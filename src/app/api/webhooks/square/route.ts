export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { verifySquareWebhook } from '@/lib/square-webhook';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { squareConfig, squareRequest, type SquareInvoice } from '@/lib/square-client';
import { reconcilePartyInvoice, type InvoiceBooking } from '@/lib/square-party';
import { reconcileCheckout, reconcileMembership, saveSquarePaymentReceipt, type CheckoutAttempt, type SquarePayment } from '@/lib/square-checkout';
import { sendPartyConfirmationEmail } from '@/lib/party-emails';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  const raw = await req.text();
  const url = process.env.SQUARE_WEBHOOK_URL?.trim() || req.url;
  if (!verifySquareWebhook(raw, req.headers.get('x-square-hmacsha256-signature'), process.env.SQUARE_WEBHOOK_SIGNATURE_KEY, url)) {
    return new Response('invalid signature', { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response('invalid JSON', { status: 400 }); }
  if (!payload || typeof payload.event_id !== 'string' || typeof payload.type !== 'string') {
    return new Response('invalid event', { status: 400 });
  }
  const admin = createAdminSupabaseClient();
  const provider = `square:${squareConfig().environment}`;
  const eventId = payload.event_id;
  const { error: insertError } = await admin.from('webhook_log').insert({ provider, event_id: eventId, payload, processing_status: 'pending' });
  if (insertError) {
    if (insertError.code !== '23505') return new Response('unable to store event', { status: 500 });
    const { data: existing, error } = await admin.from('webhook_log').select('processing_status').eq('provider', provider).eq('event_id', eventId).single();
    if (error) return new Response('unable to read event', { status: 500 });
    if (existing.processing_status === 'processed') return new Response('duplicate', { status: 200 });
    // A previous delivery can have failed after recording receipt. All fulfillment is idempotent and is retried.
  }
  try {
    const object = payload.data?.object ?? {};
    const type = payload.type as string;
    const environment = squareConfig().environment;
    if (type.startsWith('invoice.')) {
      const id = object.invoice?.id ?? payload.data?.id;
      if (!id) throw new Error('Invoice event is missing its ID');
      const { invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(id)}`);
      const result = await admin.from('party_bookings').select('*')
        .eq('square_environment', environment).eq('square_invoice_id', invoice.id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      let booking = result.data;
      if (!booking && invoice.order_id) {
        const result = await admin.from('party_bookings').select('*').eq('square_environment', environment).eq('square_order_id', invoice.order_id).maybeSingle();
        if (result.error) throw new Error(result.error.message);
        booking = result.data;
        if (booking && !booking.square_invoice_id) {
          // Invoice creation can succeed before its response/mapping is saved. Recover by the pre-persisted order.
          const saved = await admin.from('party_bookings').update({ square_invoice_id: invoice.id }).eq('id', booking.id)
            .is('square_invoice_id', null).select('*').maybeSingle();
          if (saved.error) throw new Error(saved.error.message);
          booking = saved.data ?? booking;
        }
      }
      if (booking) {
        const verified = await reconcilePartyInvoice(admin, booking as InvoiceBooking, invoice);
        if (verified.status === 'confirmed' && verified.deposit_paid_cents >= 15000 && !verified.payment_review_required && !verified.confirmation_email_sent_at) {
          const result = await sendPartyConfirmationEmail(admin, verified.id);
          if (!result.ok) throw new Error('Party confirmation email could not be sent');
        }
      } else if (invoice.subscription_id) {
        const { data: attempt, error: attemptError } = await admin.from('square_checkout_attempts').select('*')
          .eq('environment', environment).eq('square_subscription_id', invoice.subscription_id).maybeSingle();
        if (attemptError) throw new Error(attemptError.message);
        if (attempt) await reconcileMembership(admin, attempt as CheckoutAttempt, undefined, invoice);
      }
    } else if (type.startsWith('subscription.')) {
      const id = object.subscription?.id ?? payload.data?.id;
      if (!id) throw new Error('Subscription event is missing its ID');
      const { data: attempt, error } = await admin.from('square_checkout_attempts').select('*')
        .eq('environment', environment).eq('square_subscription_id', id).maybeSingle();
      if (error) throw new Error(error.message);
      if (attempt) await reconcileMembership(admin, attempt as CheckoutAttempt);
    } else if (type.startsWith('payment.') || type === 'order.updated' || type.startsWith('refund.')) {
      let orderId = object.order_updated?.order_id ?? object.order?.id ?? null;
      let paymentSnapshot: SquarePayment | undefined;
      if (type.startsWith('payment.')) {
        const id = object.payment?.id ?? payload.data?.id;
        if (!id) throw new Error('Payment event is missing its ID');
        const { payment } = await squareRequest<{ payment: SquarePayment }>(`/v2/payments/${encodeURIComponent(id)}`);
        orderId = payment.order_id;
        paymentSnapshot = payment;
      }
      if (type.startsWith('refund.')) {
        const id = object.refund?.id ?? payload.data?.id;
        if (!id) throw new Error('Refund event is missing its ID');
        const { refund } = await squareRequest<{ refund: { payment_id: string } }>(`/v2/refunds/${encodeURIComponent(id)}`);
        const { payment } = await squareRequest<{ payment: SquarePayment }>(`/v2/payments/${encodeURIComponent(refund.payment_id)}`);
        orderId = payment.order_id;
        paymentSnapshot = payment;
      }
      if (orderId) {
        const { data: attempt, error } = await admin.from('square_checkout_attempts').select('*').eq('environment', environment).eq('order_id', orderId).maybeSingle();
        if (error) throw new Error(error.message);
        if (attempt) {
          if (paymentSnapshot) await saveSquarePaymentReceipt(admin,paymentSnapshot);
          try { await reconcileCheckout(admin, attempt as CheckoutAttempt); }
          catch (error) {
            if (type.startsWith('refund.')) {
              const saved = await admin.from('square_checkout_attempts').update({ status: 'needs_review' }).eq('id', attempt.id);
              if (saved.error) throw new Error(saved.error.message);
              if (attempt.kind === 'membership' && attempt.square_subscription_id) {
                const membership = await admin.from('memberships').update({payment_review_required:true,renews_at:new Date().toISOString()})
                  .eq('square_environment',environment).eq('square_subscription_id',attempt.square_subscription_id).eq('household_id',attempt.household_id);
                if (membership.error) throw new Error(membership.error.message);
              }
            } else throw error;
          }
        }
        const { data: booking, error: bookingError } = await admin.from('party_bookings').select('*')
          .eq('square_environment', environment).eq('square_order_id', orderId).maybeSingle();
        if (bookingError) throw new Error(bookingError.message);
        if (booking?.square_invoice_id) {
          if (paymentSnapshot) await saveSquarePaymentReceipt(admin,paymentSnapshot);
          await reconcilePartyInvoice(admin, booking as InvoiceBooking);
        }
      }
    }
    const { error } = await admin.from('webhook_log').update({ processing_status: 'processed', processed_at: new Date().toISOString(), processing_error: null })
      .eq('provider', provider).eq('event_id', eventId);
    if (error) throw new Error(error.message);
    return new Response('ok', { status: 200 });
  } catch (error) {
    logger.error({ action: 'square.webhook_processing_failed', eventId }, error);
    await admin.from('webhook_log').update({ processing_status: 'failed', processing_error: error instanceof Error ? error.message : 'Processing failed' })
      .eq('provider', provider).eq('event_id', eventId);
    return new Response('processing failed; retry required', { status: 500 });
  }
}
