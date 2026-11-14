import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const modules = loadSquareModules();
const { revenueServices, calculateRevenue } = modules.load('src/lib/service-day-revenue.ts');
const { allocatePartyRevenue } = modules.load('src/lib/party-revenue-allocation.ts');
const { supplementSquareRevenue } = modules.load('src/lib/square-daily-revenue.ts');
const id = 'f068c0f7-f4e6-4f77-8073-8ac3f440a2db', date = '2026-11-14';
const party = (extra = {}) => ({ id, start_time: `${date}T20:00:00Z`, status: 'confirmed', price_quote_cents: 40000, square_environment: 'production', square_order_id: 'invoice', deposit_paid_cents: 10000, balance_paid_cents: 0, payment_review_required: false, attendance_finalized_at: null, ...extra });
const sources = (row = party()) => ({ parties: [row], bookings: [], slots: [], visits: [], series: [], classes: [], registrations: [] });
const payment = (amount_cents = 10000, paid_at = '2026-11-01T16:00:00Z', refunded_cents = 0) => ({ id: paid_at, amount_cents, refunded_cents, paid_at });
const receipt = (extra = {}) => ({ order_id: 'invoice', service_total_cents: 40000, tax_cents: 0, tip_cents: 0, items: [{ label: 'Party', category: 'party', amount_cents: 40000 }], payments: [payment()], ...extra });
function report(data, receipts, selected = date) {
  const services = allocatePartyRevenue(revenueServices(data), receipts, data);
  const evidence = new Map(receipts.map(row => [row.order_id, row]));
  return calculateRevenue(supplementSquareRevenue(services, evidence, selected), evidence, selected);
}

test('deposit is collected on payment day, recognized once on party day, and remaining balance is due', () => {
  const paid = report(sources(), [receipt()], '2026-11-01');
  assert.equal(paid.net_cents, 0); assert.equal(paid.party_received_today_cents, 10000);
  assert.equal(paid.party_receipts[0].service_date, date); assert.equal(paid.complete, true);
  const partyDay = report(sources(), [receipt()]);
  assert.equal(partyDay.net_cents, 10000); assert.equal(partyDay.party_cents, 10000);
  assert.equal(partyDay.party_prepaid_cents, 10000); assert.equal(partyDay.party_due_cents, 30000);
  assert.equal(partyDay.party_received_today_cents, 0);
});
test('deposit plus same-day or later balance remain one party and conserve every cent', () => {
  for (const balanceDate of [date, '2026-11-16']) {
    const r = receipt({ payments: [payment(), payment(30000, `${balanceDate}T16:00:00Z`)] });
    const result = report(sources(), [r]);
    assert.equal(result.rows.length, 1); assert.equal(result.party_cents, 40000); assert.equal(result.due_cents, 0);
    assert.equal(result.prepaid_cents + result.same_day_cents + result.later_paid_cents, 40000);
    assert.equal(report(sources(), [r], balanceDate).party_received_today_cents, 30000);
    if (balanceDate !== date) assert.equal(report(sources(), [r], balanceDate).net_cents, 0);
  }
});
test('separate deposit/balance orders with explicit booking IDs share the full quote and never duplicate', () => {
  const data = sources();
  const receipts = [receipt({ service_total_cents: 10000, items: [{ label: 'Party deposit', category: 'party', amount_cents: 10000 }] }), receipt({ order_id: 'balance', party_booking_id: id, service_total_cents: 30000, items: [{ label: 'Party balance', category: 'party', amount_cents: 30000 }], payments: [payment(30000, `${date}T16:00:00Z`)] })];
  const result = report(data, receipts);
  assert.equal(result.complete, true); assert.equal(result.rows.length, 1); assert.equal(result.party_cents, 40000); assert.equal(result.due_cents, 0);
  const once = allocatePartyRevenue(revenueServices(data), receipts, data), twice = allocatePartyRevenue(once, receipts, data);
  assert.equal(twice[0].charges.length, 2); assert.equal(once[0].charges[0].amount_cents, 10000);
});
test('rescheduling moves party revenue but preserves actual collection dates; refunds never reopen debt', () => {
  const data = sources(party({ start_time: '2026-11-21T20:00:00Z' }));
  const receipts = [receipt({ payments: [payment(40000, '2026-11-01T16:00:00Z', 5000)] })];
  assert.equal(report(data, receipts).net_cents, 0);
  const moved = report(data, receipts, '2026-11-21');
  assert.equal(moved.party_cents, 35000); assert.equal(moved.due_cents, 0);
  const collected = report(data, receipts, '2026-11-01');
  assert.equal(collected.party_received_today_cents, 40000); assert.equal(collected.party_receipts[0].refunded_cents, 5000); assert.equal(collected.party_receipts[0].service_date, '2026-11-21');
});
test('unlinked party receipts are held for date allocation, while mixed café sales still use payment day', () => {
  const r = receipt({ service_total_cents: 40500, items: [...receipt().items, { label: 'Latte', category: 'cafe', amount_cents: 500 }], payments: [payment(40500)] });
  const result = report(sources(party({ square_order_id: null })), [r], '2026-11-01');
  assert.equal(result.net_cents, 500); assert.equal(result.unallocated_party_cents, 40000); assert.equal(result.party_received_today_cents, 40000); assert.equal(result.complete, false);
  r.party_booking_id = id;
  assert.equal(report(sources(party({ square_order_id: null })), [r], '2026-11-01').net_cents, 500);
  assert.equal(report(sources(party({ square_order_id: null })), [r]).party_cents, 40000);
});
test('unknown, sandbox, conflicting and cancelled parties cannot become confirmed sales', () => {
  const unknown = receipt({ party_booking_id: 'unknown' });
  assert.equal(report(sources(party({ square_order_id: null })), [unknown], '2026-11-01').net_cents, 0);
  const sandbox = report(sources(party({ square_environment: 'sandbox' })), [receipt({ party_booking_id: id })], '2026-11-01');
  assert.equal(sandbox.net_cents, 0); assert.equal(sandbox.complete, false);
  assert.equal(report(sources(), [unknown]).complete, false);
  const cancelled = report(sources(party({ status: 'cancelled' })), [receipt()], '2026-11-01');
  assert.equal(cancelled.net_cents, 0); assert.equal(cancelled.complete, false); assert.equal(cancelled.review_count, 1);
});
test('gift-card redemption settles a party balance without being new party cash or new revenue', () => {
  const result = report(sources(), [receipt({ payments: [{ ...payment(40000, `${date}T16:00:00Z`), gift_card: true }] })]);
  assert.equal(result.party_cents, 0); assert.equal(result.party_received_today_cents, 0); assert.equal(result.due_cents, 0); assert.equal(result.redeemed_cents, 40000);
});

const money = amount => ({ amount, currency: 'USD' });
test('later party date discovers an earlier explicitly linked deposit without payment-day activity', async () => {
  const admin = { from(table) { const q = { select() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; }, in() { return q; }, then(resolve) { resolve({ data: table === 'party_bookings' ? [party({ square_environment: null, square_order_id: null })] : [], error: null }); } }; return q; } };
  const calls = [];
  const loader = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async url => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/v2/orders/search')) return Response.json({ orders: [{ id: 'invoice', reference_id: `party_${id}`, location_id: 'test-location', total_money: money(10000), line_items: [{ name: 'Party deposit', total_money: money(10000) }], tenders: [{ payment_id: 'deposit' }] }] });
    if (new URL(url).pathname === '/v2/payments') return Response.json({ payments: [] });
    if (url.endsWith('/v2/payments/deposit')) return Response.json({ payment: { id: 'deposit', order_id: 'invoice', location_id: 'test-location', status: 'COMPLETED', amount_money: money(10000), created_at: '2026-11-01T16:00:00Z' } });
    throw Error(`Unexpected request ${url}`);
  } }).load('src/lib/service-day-revenue-data.ts');
  const result = await loader.getServiceDayRevenue(admin, date);
  assert.equal(result.party_cents, 10000); assert.equal(result.party_due_cents, 30000); assert.equal(result.complete, true);
  assert(!calls.includes('/v2/orders/invoice'));
});

test('opaque invoices with unknown explicit party references cannot fall into same-day Other sales', () => {
  const r = receipt({ party_booking_id: 'unknown', items: [{ label: 'Custom invoice', category: 'other', amount_cents: 40000 }] });
  const result = report(sources(party({ square_order_id: null })), [r], '2026-11-01');
  assert.equal(result.net_cents, 0); assert.equal(result.unallocated_party_cents, 10000); assert.equal(result.complete, false);
});
test('provider rejects contradictory explicit party references before using a receipt', async () => {
  const loader = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async () => Response.json({ order: {
    id: 'invoice', location_id: 'test-location', total_money: money(40000), reference_id: `party_${id}`, metadata: { party_booking_id: 'another' },
  } }) }).load('src/lib/service-day-revenue-data.ts');
  await assert.rejects(loader.readRevenueEvidence('invoice'), /references disagree/);
});

test('collection day does not require unrelated balance receipts from a different payment day', () => {
  const data = sources();
  const deposit = receipt({ service_total_cents: 10000, items: [{ label: 'Party deposit', category: 'party', amount_cents: 10000 }] });
  const balance = receipt({ order_id: 'balance', party_booking_id: id, service_total_cents: 30000, items: [{ label: 'Party balance', category: 'party', amount_cents: 30000 }], payments: [] });
  const services = allocatePartyRevenue(revenueServices(data), [deposit, balance], data);
  const result = calculateRevenue(services, new Map([['invoice', deposit]]), '2026-11-01');
  assert.equal(result.complete, true); assert.equal(result.party_received_today_cents, 10000);
});
