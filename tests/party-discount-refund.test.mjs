import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { memoryAdmin } from './helpers/family-memory-admin.mjs';

function fixture() {
  const party = { id: '10000000-0000-4000-8000-000000000001', status: 'confirmed', square_environment: 'production', square_order_id: 'order', price_quote_cents: 30000, notes: 'Original note', updated_at: 'snapshot' };
  const admin = memoryAdmin({ party_bookings: [party] });
  const order = { id: 'order', location_id: 'location', total_money: { amount: 30000, currency: 'USD' }, tenders: [{ payment_id: 'payment' }] };
  const payment = { id: 'payment', order_id: 'order', location_id: 'location', status: 'COMPLETED', source_type: 'CARD', amount_money: { amount: 30000, currency: 'USD' }, refund_ids: [] };
  const refunds = new Map(), keys = new Map(); let posts = 0, lostResponse = false, environment = 'production';
  const square = { squareConfig: () => ({ environment, locationId: 'location' }),
    assertUsd: (money, amount) => { assert.equal(money?.currency, 'USD'); assert.equal(money?.amount, amount); },
    squareRequest: async (path, method = 'GET', body) => {
      if (path.startsWith('/v2/orders/')) return { order: structuredClone(order) };
      if (path.startsWith('/v2/payments/')) return { payment: structuredClone(payment) };
      if (path.startsWith('/v2/refunds/')) return { refund: structuredClone(refunds.get(path.split('/').at(-1))) };
      assert.equal(path, '/v2/refunds'); assert.equal(method, 'POST');
      assert(body.idempotency_key.length <= 45); assert.equal(body.amount_money.amount, 5000);
      if (keys.has(body.idempotency_key)) return { refund: structuredClone(keys.get(body.idempotency_key)) };
      posts++;
      const refund = { id: 'refund', payment_id: body.payment_id, status: 'PENDING', reason: body.reason, amount_money: body.amount_money };
      keys.set(body.idempotency_key, refund); refunds.set(refund.id, refund);
      if (lostResponse) { lostResponse = false; throw Error('Response lost after provider accepted refund'); }
      payment.refund_ids.push(refund.id); payment.refunded_money = { amount: 5000, currency: 'USD' };
      return { refund: structuredClone(refund) };
    } };
  const api = loadSquareModules({ mocks: { '@/lib/square-client': square } }).load('src/lib/party-discount-refund.ts');
  return { api, admin, party, order, payment, refunds, posts: () => posts, loseResponse: () => { lostResponse = true; }, sandbox: () => { environment = 'sandbox'; },
    input: { partyId: party.id, orderId: 'order', paymentId: 'payment', expectedPaymentCents: 30000 } };
}

test('the exclusive party receipt is previewed without writes; one $50 refund survives retries and preserves the $300 receipt allocation', async () => {
  const h = fixture();
  const preview = await h.api.previewPartyDiscountRefund(h.admin, h.input);
  assert.equal(preview.amount_cents, 5000); assert.equal(h.posts(), 0); assert.equal(h.admin.writes.length, 0);
  const result = await h.api.refundPartyDiscount(h.admin, h.input);
  assert.equal(result.status, 'PENDING'); assert.equal(result.audit_saved, true);
  assert.equal((await h.api.refundPartyDiscount(h.admin, h.input)).refund_id, result.refund_id);
  assert.equal(h.posts(), 1); assert.equal(h.party.price_quote_cents, 30000); assert.equal(h.party.square_order_id, 'order');
  assert.ok(h.party.notes.includes('after adjustment USD 250.00')); assert.ok(h.party.notes.startsWith('Original note'));
});

test('concurrent and uncertain refund requests use the same provider key, including before refund history becomes visible', async () => {
  const h = fixture(); h.loseResponse();
  await assert.rejects(h.api.refundPartyDiscount(h.admin, h.input), /Response lost/);
  await Promise.all([h.api.refundPartyDiscount(h.admin, h.input), h.api.refundPartyDiscount(h.admin, h.input)]);
  assert.equal(h.posts(), 1);
});

test('unverified receipts, other refunds, taxes/tips, split tender and shared allocations cannot cause a refund', async () => {
  for (const scenario of ['wrong-order', 'wrong-payment', 'wrong-total', 'currency', 'cancelled', 'sandbox', 'shared', 'tax', 'tip', 'split', 'cash', 'pending', 'prior-refund', 'failed-refund']) {
    const h = fixture();
    if (scenario === 'wrong-order') h.party.square_order_id = 'other';
    if (scenario === 'wrong-payment') h.payment.order_id = 'other';
    if (scenario === 'wrong-total') h.payment.amount_money.amount = 29900;
    if (scenario === 'currency') h.payment.amount_money.currency = 'CAD';
    if (scenario === 'cancelled') h.party.status = 'cancelled';
    if (scenario === 'sandbox') h.sandbox();
    if (scenario === 'shared') h.admin.tables.party_bookings.push({ ...h.party, id: 'other' });
    if (scenario === 'tax') h.order.total_tax_money = { amount: 500, currency: 'USD' };
    if (scenario === 'tip') h.order.total_tip_money = { amount: 500, currency: 'USD' };
    if (scenario === 'split') h.order.tenders.push({ payment_id: 'other' });
    if (scenario === 'cash') h.payment.source_type = 'CASH';
    if (scenario === 'pending') h.payment.status = 'APPROVED';
    if (scenario === 'prior-refund') h.payment.refunded_money = { amount: 5000, currency: 'USD' };
    if (scenario === 'failed-refund') { h.payment.refund_ids.push('failed'); h.refunds.set('failed', { id: 'failed', payment_id: 'payment', reason: `Friends & Family discount: party ${h.party.id}`, status: 'FAILED', amount_money: { amount: 5000, currency: 'USD' } }); }
    await assert.rejects(h.api.refundPartyDiscount(h.admin, h.input), scenario);
    assert.equal(h.posts(), 0, scenario);
  }
});

test('an audit-write conflict does not misreport an accepted provider refund or refund twice', async () => {
  const h = fixture();
  // The payment GET happens after the booking snapshot is captured.
  const original = h.admin.from;
  let bookingReads = 0;
  h.admin.from = table => { const q = original(table); const select = q.select; q.select = (...args) => { if (++bookingReads === 2) h.party.updated_at = 'changed'; return select(...args); }; return q; };
  const result = await h.api.refundPartyDiscount(h.admin, h.input);
  assert.equal(result.status, 'PENDING'); assert.equal(result.audit_saved, false); assert.equal(h.posts(), 1);
  await h.api.refundPartyDiscount(h.admin, h.input); assert.equal(h.posts(), 1);
});

test('party refund API requires personal owner access, same origin, exact amount confirmation, and passes only verified selection fields', async () => {
  let context = { ok: false, response: new Response(null, { status: 403 }) }, calls = 0;
  const route = loadSquareModules({ mocks: { '@/lib/revenue-access': { requireRevenueContext: async () => context },
    '@/lib/party-discount-refund': { refundPartyDiscount: async (_admin, input) => { calls++; assert.equal(input.expectedPaymentCents, 30000); return { status: 'PENDING', amount_cents: 5000 }; }, previewPartyDiscountRefund: async () => { calls++; return { amount_cents: 5000, payment: { id: 'payment' }, existing: null }; } } } }).load('src/app/api/admin/party-bookings/friends-family-refund/route.ts');
  const request = (extra = {}, origin = 'https://example.test') => new Request('https://example.test/api/admin/party-bookings/friends-family-refund', { method: 'POST', headers: { origin }, body: JSON.stringify({ party_id: '10000000-0000-4000-8000-000000000001', order_id: 'order', payment_id: 'payment', expected_payment_cents: 30000, action: 'refund', ...extra }) });
  assert.equal((await route.POST(request())).status, 403);
  context = { ok: true, admin: {} };
  assert.equal((await route.POST(request({}, 'https://elsewhere.test'))).status, 403);
  assert.equal((await route.POST(request())).status, 400);
  assert.equal((await route.POST(request({ confirmation: 'REFUND PARTY FRIENDS FAMILY 50', refund_cents: 5001 }))).status, 400);
  assert.equal((await route.POST(request({ order_id: '../bad' }))).status, 400); assert.equal(calls, 0);
  assert.equal((await route.POST(request({ action: 'preview' }))).status, 200);
  assert.equal((await route.POST(request({ confirmation: 'REFUND PARTY FRIENDS FAMILY 50', refund_cents: 5000 }))).status, 200); assert.equal(calls, 2);
});
