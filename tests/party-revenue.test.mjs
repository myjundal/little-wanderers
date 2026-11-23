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

const family = 'party-family';
const receiptLink = (extra = {}, event = {}) => ({ id: 'owner-audit', household_id: family,
  created_by_user_id: '5054a175-2ba6-4023-a289-a9b0635ccc5f', created_by_role: 'owner',
  notes: JSON.stringify({ version: 1, environment: 'production', party_booking_id: id, order_id: 'balance', amount_cents: 35000, ...extra }), ...event });
const separatePayments = () => [
  receipt({ service_total_cents: 30000, items: [{ label: 'Party invoice', category: 'party', amount_cents: 30000 }], payments: [payment(15000)] }),
  receipt({ order_id: 'balance', service_total_cents: 35000, items: [{ label: 'Private party', category: 'party', amount_cents: 35000 }], payments: [payment(35000, `${date}T18:00:00Z`)] }),
];
function linkedSources() { return { ...sources(party({ household_id: family, price_quote_cents: 50000 })), partyReceiptLinks: [receiptLink()] }; }

test('owner link preserves original deposit, recognizes separate POS balance once, and closes the full quote', () => {
  const data = linkedSources(), receipts = separatePayments();
  data.partyReceiptLinks.push(receiptLink());
  const services = allocatePartyRevenue(allocatePartyRevenue(revenueServices(data), receipts, data), receipts, data);
  assert.equal(services.length, 1); assert.equal(services[0].charges.length, 2);
  const result = report(data, receipts);
  assert.equal(result.complete, true); assert.equal(result.party_cents, 50000); assert.equal(result.party_due_cents, 0);
  assert.equal(result.prepaid_cents, 15000); assert.equal(result.same_day_cents, 35000);
  assert.equal(result.unallocated_party_cents, 0); assert.equal(result.party_receipts.length, 1);
  assert.equal(result.rows[0].payment_details.length, 2);
});

test('saved POS balance follows rescheduling and later refunds without inventing debt or new payments', () => {
  const data = linkedSources(), receipts = separatePayments();
  data.parties[0].start_time = '2026-11-21T20:00:00Z';
  receipts[1].payments[0].refunded_cents = 5000;
  assert.equal(report(data, receipts).net_cents, 0);
  const moved = report(data, receipts, '2026-11-21');
  assert.equal(moved.party_cents, 45000); assert.equal(moved.prepaid_cents, 45000);
  assert.equal(moved.party_due_cents, 0); assert.equal(moved.refunded_cents, 5000);
});

test('a saved link alone cannot establish that a POS balance was paid', () => {
  const data = linkedSources();
  const result = report(data, [separatePayments()[0]]);
  assert.equal(result.party_cents, 0); assert.equal(result.complete, false);
  assert(result.rows[0].issues.some(issue => /receipt verification is unavailable/.test(issue)));
});

test('other staff and other owners cannot supply party revenue links', () => {
  for (const event of [{ created_by_role: 'staff' }, { created_by_user_id: 'another-owner' }]) {
    const data = linkedSources(); data.partyReceiptLinks = [receiptLink({}, event)];
    const result = report(data, separatePayments());
    assert.equal(result.party_cents, 15000); assert.equal(result.unallocated_party_cents, 35000);
  }
});

test('conflicting saved links, sandbox links and cross-family links fail closed', () => {
  for (const extra of [{ environment: 'sandbox' }, { amount_cents: -1 }, { party_booking_id: 'not-a-uuid' }]) {
    const data = linkedSources(); data.partyReceiptLinks = [receiptLink(extra)];
    assert.throws(() => report(data, separatePayments()), /Saved party receipt/);
  }
  const cross = linkedSources(); cross.partyReceiptLinks = [receiptLink({}, { household_id: 'another-family' })];
  assert.throws(() => report(cross, separatePayments()), /family or environment/);
  const conflict = linkedSources(); conflict.partyReceiptLinks.push(receiptLink({ amount_cents: 10000 }));
  assert.throws(() => report(conflict, separatePayments()), /links disagree/);
});

test('saved allocations cannot silently absorb changed receipts or contradictory provider booking IDs', () => {
  const mismatch = separatePayments(); mismatch[1].items[0].amount_cents = 34000;
  const result = report(linkedSources(), mismatch);
  assert.equal(result.party_cents, 0); assert.equal(result.complete, false);
  assert(result.rows[0].issues.some(issue => /owner-reviewed allocation/.test(issue)));
  const conflict = separatePayments(); conflict[1].party_booking_id = 'another-booking';
  assert.equal(report(linkedSources(), conflict).party_cents, 0);
});

test('explicit owner link keeps mixed café lines outside the party allocation', () => {
  const receipts = separatePayments();
  receipts[1].service_total_cents += 500;
  receipts[1].items.push({ label: 'Latte', category: 'cafe', amount_cents: 500 });
  receipts[1].payments[0].amount_cents += 500;
  const result = report(linkedSources(), receipts);
  assert.equal(result.party_cents, 50000); assert.equal(result.net_cents, 50500);
  assert.equal(result.categories.find(row => row.category === 'cafe').net_cents, 500);
});

test('a saved balance is fetched on its service day even when absent from payment-day listing and history', async () => {
  const filters = [];
  const admin = { from(table) { let action; const q = { select() { return q; }, order() { return q; }, limit() { return q; },
    eq(k, v) { if (k === 'action') { action = v; filters.push(v); } return q; }, in() { return q; },
    then(resolve) { resolve({ data: table === 'party_bookings' ? linkedSources().parties : table === 'membership_events' && action === 'party_receipt_link' ? [receiptLink()] : [], error: null }); } }; return q; } };
  const calls = [];
  const loader = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async url => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/v2/orders/search')) return Response.json({ orders: [] });
    if (new URL(url).pathname === '/v2/payments') return Response.json({ payments: [] });
    const order = new URL(url).pathname.split('/').at(-1);
    if (url.includes('/v2/orders/')) {
      const amount = order === 'invoice' ? 30000 : 35000;
      return Response.json({ order: { id: order, location_id: 'test-location', total_money: money(amount), line_items: [{ name: 'Private party', total_money: money(amount) }], tenders: [{ payment_id: 'paid-' + order }] } });
    }
    if (url.includes('/v2/payments/')) {
      const invoice = url.endsWith('paid-invoice');
      return Response.json({ payment: { id: invoice ? 'paid-invoice' : 'paid-balance', order_id: invoice ? 'invoice' : 'balance', location_id: 'test-location', status: 'COMPLETED', amount_money: money(invoice ? 15000 : 35000), created_at: '2026-11-01T16:00:00Z' } });
    }
    throw Error('Unexpected provider request');
  } }).load('src/lib/service-day-revenue-data.ts');
  const result = await loader.getServiceDayRevenue(admin, date);
  assert.equal(result.party_cents, 50000); assert.equal(result.party_due_cents, 0); assert.equal(result.complete, true);
  assert(calls.includes('/v2/orders/balance')); assert(filters.includes('party_receipt_link'));
});
