import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, squareSiteUrl, assertSquarePaymentUrl, assertUsd, type SquareOrder } from '@/lib/square-client';
export type OpenPlayPayment = {
    id: string;
    household_id: string;
    status: string;
    child_ids: string[];
    amount_cents: number;
    payment_choice: string;
    payment_status: string;
    square_order_id: string | null;
    square_payment_link_id: string | null;
    payment_url: string | null;
    payment_environment: string | null;
    created_at: string;
};
function checked<T>(result: {
    data: T;
    error: {
        message: string;
    } | null;
}): T { if (result.error)
    throw new Error(result.error.message); return result.data; }
export async function verifyOpenPlayPayment(db: SupabaseClient, r: OpenPlayPayment): Promise<OpenPlayPayment> {
    if (!r.square_order_id)
        return r;
    const cfg = squareConfig();
    if (r.payment_environment !== cfg.environment)
        throw new Error('Payment environment mismatch');
    const { order } = await squareRequest<{
        order: SquareOrder;
    }>(`/v2/orders/${encodeURIComponent(r.square_order_id)}`);
    if (order.id !== r.square_order_id || order.location_id !== cfg.locationId || order.reference_id !== `op_${r.id}`)
        throw new Error('Reservation payment does not match');
    // Digital checkout orders can remain OPEN after a completed payment.
    if (!['OPEN', 'COMPLETED'].includes(order.state ?? '') || order.net_amount_due_money?.amount !== 0 || !(order.tenders ?? []).length)
        return r;
    assertUsd(order.total_money, r.amount_cents);
    assertUsd(order.net_amount_due_money, 0);
    const ids = (order.tenders ?? []).map(t => t.payment_id);
    if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length)
        throw new Error('Payment receipts are required');
    let total = 0;
    for (const id of ids) {
        const { payment: p } = await squareRequest<{
            payment: {
                id: string;
                order_id: string;
                location_id: string;
                status: string;
                amount_money: {
                    amount: number;
                    currency: string;
                };
                refunded_money?: {
                    amount: number;
                };
                tip_money?: {
                    amount: number;
                };
                created_at: string;
            };
        }>(`/v2/payments/${encodeURIComponent(id!)}`);
        if (p.id !== id || p.order_id !== order.id || p.location_id !== cfg.locationId || p.status !== 'COMPLETED' || p.amount_money.currency !== 'USD' || !Number.isSafeInteger(p.amount_money.amount) || p.amount_money.amount <= 0 || (p.refunded_money?.amount ?? 0) !== 0 || (p.tip_money?.amount ?? 0) !== 0 || !p.created_at || !Number.isFinite(Date.parse(p.created_at)) || Date.parse(p.created_at) < Date.parse(r.created_at) - 60000)
            throw new Error('Reservation payment needs review');
        total += p.amount_money.amount;
    }
    if (total !== r.amount_cents)
        throw new Error('Payment amount does not match');
    return checked(await db.rpc('fulfill_open_play_reservation', { p_id: r.id, p_order: order.id, p_payments: ids, p_amount: total })) as OpenPlayPayment;
}
export async function startOpenPlayPayment(db: SupabaseClient, r: OpenPlayPayment) {
    if (r.status !== 'reserved' || r.amount_cents <= 0 || r.payment_status === 'covered')
        throw new Error('This reservation does not need payment');
    if (r.payment_status === 'paid')
        return { paid: true, url: null };
    const cfg = squareConfig();
    // Claim the checkout before calling Square. Cancellation cannot race link creation.
    checked(await db.from('open_play_reservations').update({ payment_choice: 'now', payment_environment: cfg.environment }).eq('id', r.id).eq('status', 'reserved').select('id').single());
    if (r.square_order_id) {
        const current = await verifyOpenPlayPayment(db, r);
        if (current.payment_status === 'paid')
            return { paid: true, url: null };
        if (r.payment_url)
            return { paid: false, url: assertSquarePaymentUrl(r.payment_url) };
    }
    const { payment_link: link } = await squareRequest<{
        payment_link: {
            id: string;
            order_id: string;
            url: string;
        };
    }>('/v2/online-checkout/payment-links', 'POST', {
        idempotency_key: `op-${r.id}`, order: { location_id: cfg.locationId, reference_id: `op_${r.id}`, line_items: [{ name: 'Little Wanderers · Soft opening admission', quantity: '1', base_price_money: { amount: r.amount_cents, currency: 'USD' } }] },
        checkout_options: { redirect_url: `${squareSiteUrl()}/landing/soft-opening?reservation=${r.id}&payment=returned`, ask_for_shipping_address: false, allow_tipping: false, enable_coupon: false, enable_loyalty: false },
    });
    const url = assertSquarePaymentUrl(link.url);
    checked(await db.from('open_play_reservations').update({ square_order_id: link.order_id, square_payment_link_id: link.id, payment_url: url }).eq('id', r.id).eq('status', 'reserved').select('id').single());
    return { paid: false, url };
}
export async function reconcileOpenPlayPayments(db: SupabaseClient, householdId: string) {
    const rows = checked(await db.from('open_play_reservations').select('*').eq('household_id', householdId).eq('payment_choice', 'now').eq('status', 'reserved').in('payment_status', ['due', 'paid']).eq('payment_environment', squareConfig().environment).limit(10)) as OpenPlayPayment[];
    for (const row of rows) {
        if (!row.square_order_id)
            throw new Error('Online checkout is still being prepared; verify before collecting payment');
        const current = await verifyOpenPlayPayment(db, row);
        if (current.payment_status !== 'paid')
            throw new Error('Online checkout is still pending. Complete or close it before collecting counter payment.');
    }
}
