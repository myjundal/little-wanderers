import type { SupabaseClient } from '@supabase/supabase-js';
import { giftCardPurchaseNotificationEmail } from '@/lib/admin-notifications';
import { sendResendEmail } from '@/lib/email-campaigns';
import { squareConfig, squareRequest, type SquareMoney, type SquareOrder } from '@/lib/square-client';

type GiftOrder = SquareOrder;
type Payment = { id: string; order_id?: string; location_id?: string; status?: string; created_at?: string;
  total_money?: SquareMoney; amount_money?: SquareMoney; tip_money?: SquareMoney; refunded_money?: SquareMoney;
  buyer_email_address?: string; receipt_url?: string };
type Email = { to: string; subject: string; html: string };
type Notice = { version: 1; prepared_at: string; email: Email; sent_at?: string; email_id?: string };
const provider = 'gift-card-owner-email';

function usd(value: SquareMoney | undefined) {
  if (value?.currency !== 'USD' || !Number.isSafeInteger(value.amount) || value.amount! < 0) throw new Error('Gift card amount needs review.');
  return value.amount!;
}

/** Read completed provider receipts; never issue, load, redeem or charge a card. */
export async function notifyGiftCardOrder(admin: SupabaseClient, order: GiftOrder) {
  if (squareConfig().environment !== 'production') return { sent: false, reason: 'sandbox' };
  // A purchase is identified by Square's item type, never by the payment's source
  // or a product name. Spending a gift card must not produce a purchase email.
  const giftItems = (order.line_items ?? []).filter(item => item.item_type === 'GIFT_CARD');
  if (!giftItems.length) return { sent: false, reason: 'not_gift_card' };
  if (order.location_id !== squareConfig().locationId || order.state !== 'COMPLETED') throw new Error('Gift card order is not completed.');
  const amount = giftItems.reduce((sum, item) => sum + usd(item.total_money), 0);
  if (!amount) return { sent: false, reason: 'no_payment' };
  if (!Number.isSafeInteger(amount) || amount > usd(order.total_money)) throw new Error('Gift card total needs review.');
  const key = `gift-card-purchase/production/${order.id}`;
  const existing = await admin.from('webhook_log').select('payload').eq('provider', provider).eq('event_id', key).maybeSingle();
  if (existing.error) throw new Error('Unable to check gift card notification.');
  if (existing.data?.payload?.sent_at) return { sent: false, reason: 'already_sent' };

  let notice = existing.data?.payload as Notice | undefined;
  if (!notice) {
    const ids = [...new Set((order.tenders ?? []).map(tender => tender.payment_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) throw new Error('Gift card order has no payment receipt.');
    const payments = await Promise.all(ids.map(async id => {
      const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(id)}`);
      if (payment.id !== id || payment.order_id !== order.id || payment.location_id !== order.location_id) throw new Error('Gift card payment does not match its order.');
      return payment;
    }));
    const completed = payments.filter(payment => payment.status === 'COMPLETED');
    const paid = completed.reduce((sum, payment) => sum + (payment.total_money ? usd(payment.total_money) : usd(payment.amount_money) + (payment.tip_money ? usd(payment.tip_money) : 0)), 0);
    if (paid !== usd(order.total_money)) throw new Error('Gift card payment is not fully settled.');
    // A refund update is not a new purchase notification.
    if (completed.some(payment => payment.refunded_money && usd(payment.refunded_money) > 0)) return { sent: false, reason: 'refunded' };
    if (completed.some(payment => !payment.created_at || !Number.isFinite(Date.parse(payment.created_at)))) throw new Error('Gift card payment date needs review.');
    const first = [...completed].sort((a, b) => a.created_at!.localeCompare(b.created_at!))[0];
    const receipt = completed.find(payment => payment.receipt_url)?.receipt_url;
    const safeReceipt = receipt && /^https:\/\/([a-z0-9-]+\.)*squareup\.com\//i.test(receipt) ? receipt : null;
    notice = { version: 1, prepared_at: new Date().toISOString(), email: giftCardPurchaseNotificationEmail({
      orderId: order.id, amountCents: amount, paidAt: first.created_at!,
      buyerEmail: completed.find(payment => payment.buyer_email_address)?.buyer_email_address,
      receiptUrl: safeReceipt,
    }) };
    const inserted = await admin.from('webhook_log').insert({ provider, event_id: key, payload: notice });
    if (inserted.error && inserted.error.code !== '23505') throw new Error('Unable to prepare gift card notification.');
    // Concurrent payment.created/payment.updated deliveries use the same frozen
    // recipient/content and provider idempotency key, including after a retry.
    const saved = await admin.from('webhook_log').select('payload').eq('provider', provider).eq('event_id', key).single();
    if (saved.error || !saved.data?.payload) throw new Error('Unable to read gift card notification.');
    notice = saved.data.payload as Notice;
    if (notice.sent_at) return { sent: false, reason: 'already_sent' };
  }
  if (notice.version !== 1 || !notice.email || !Number.isFinite(Date.parse(notice.prepared_at))) throw new Error('Gift card notification needs review.');
  // Resend retains idempotency keys for 24 hours. Never risk a second email
  // after an uncertain send has outlived that window.
  if (Date.now() - Date.parse(notice.prepared_at) > 23 * 3600000) throw new Error('Gift card notification requires delivery review.');
  const result = await sendResendEmail({ ...notice.email, idempotencyKey: key });
  if (!result.ok) throw new Error('Gift card notification delivery pending.');
  const saved = await admin.from('webhook_log').update({ payload: { ...notice, sent_at: new Date().toISOString(), email_id: result.id } })
    .eq('provider', provider).eq('event_id', key);
  if (saved.error) throw new Error('Unable to confirm gift card notification delivery.');
  return { sent: true, email_id: result.id };
}

export async function notifyGiftCardPayment(admin: SupabaseClient, paymentId: string) {
  const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(paymentId)}`);
  if (payment.id !== paymentId || payment.location_id !== squareConfig().locationId || payment.status !== 'COMPLETED' || !payment.order_id) throw new Error('Completed gift card payment required.');
  const { order } = await squareRequest<{ order: GiftOrder }>(`/v2/orders/${encodeURIComponent(payment.order_id)}`);
  if (order.id !== payment.order_id) throw new Error('Gift card order does not match its payment.');
  return notifyGiftCardOrder(admin, order);
}

type Subscription = { id: string; enabled?: boolean; notification_url?: string; event_types?: string[]; signature_key?: string };
const events = ['payment.created', 'payment.updated', 'gift_card.activity.created'];
export async function giftCardWebhookStatus() {
  const expected = process.env.SQUARE_WEBHOOK_URL?.trim();
  if (squareConfig().environment !== 'production' || !expected) throw new Error('Production Square webhook URL is required.');
  let cursor: string | undefined;
  const subscriptions: Subscription[] = [];
  do {
    const page = await squareRequest<{ subscriptions?: Subscription[]; cursor?: string }>(`/v2/webhooks/subscriptions?include_disabled=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    subscriptions.push(...page.subscriptions ?? []);
    cursor = page.cursor;
    if (subscriptions.length > 500) throw new Error('Too many Square webhook subscriptions.');
  } while (cursor);
  const matches = subscriptions.filter(subscription => subscription.notification_url === expected);
  if (matches.length !== 1) throw new Error('An existing production Square webhook subscription is required.');
  const subscription = matches[0];
  if (subscription.signature_key && subscription.signature_key !== process.env.SQUARE_WEBHOOK_SIGNATURE_KEY) throw new Error('Square webhook signature configuration does not match.');
  return { subscription_id: subscription.id, enabled: Boolean(subscription.enabled), event_types: subscription.event_types ?? [],
    purchase_notifications_enabled: Boolean(subscription.enabled) && events.every(event => subscription.event_types?.includes(event)) };
}

export async function enableGiftCardWebhooks() {
  const status = await giftCardWebhookStatus();
  if (!status.purchase_notifications_enabled) await squareRequest(`/v2/webhooks/subscriptions/${encodeURIComponent(status.subscription_id)}`, 'PUT', {
    subscription: { enabled: true, event_types: [...new Set([...status.event_types, ...events])] },
  });
  return giftCardWebhookStatus();
}
