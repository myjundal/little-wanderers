import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const modules = loadSquareModules();
const { revenueServices, calculateRevenue } = modules.load('src/lib/service-day-revenue.ts');
const { supplementSquareRevenue } = modules.load('src/lib/square-daily-revenue.ts');
const { loadRevenueVisitorRoles } = modules.load('src/lib/service-day-revenue-data.ts');
const date = '2026-11-14';
const empty = () => ({ bookings: [], slots: [], visits: [], parties: [], classes: [], series: [], registrations: [], people: [] });
const booking = (extra = {}) => ({ id: 'booking', slot_id: 'slot', household_id: 'family', child_ids: ['child'], child_count: 1, status: 'reserved', payment_status: 'due', payment_environment: null, amount_cents: 1600, square_order_id: null, ...extra });
const visit = (extra = {}) => ({ id: 'visit', person_id: 'child', household_id: 'family', checked_in_at: `${date}T16:00:00Z`, payment_status: 'due', price_cents: 1600, square_environment: null, square_order_id: null, ...extra });
const receipt = (extra = {}) => ({ order_id: 'order', service_total_cents: 1600, tax_cents: 0, tip_cents: 0, items: [{ label: 'Admission', category: 'open_play', amount_cents: 1600 }], payments: [{ id: 'p', amount_cents: 1600, refunded_cents: 0, paid_at: `${date}T16:00:00Z` }], ...extra });
function report(sources, receipts = []) {
  const evidence = new Map(receipts.map(row => [row.order_id, row]));
  return calculateRevenue(supplementSquareRevenue(revenueServices(sources), evidence, date), evidence, date, [], sources);
}
const reserved = () => ({ ...empty(), bookings: [booking()], slots: [{ id: 'slot', starts_at: `${date}T15:00:00Z` }] });

test('a reservation without a visit or payment is not a debt or an inferred no-show', () => {
  const data = reserved(); const r = report(data);
  assert.equal(r.due_cents, 0); assert.equal(r.net_cents, 0); assert.equal(r.rows[0].pending_payment_cents, 1600);
  assert.equal(r.admission.visit_unconfirmed.length, 1); assert.equal(r.admission.payment_unconfirmed.length, 0);
  assert.equal(r.visitor_stats.declared_no_shows, 0); assert.equal(r.review_count, 1); assert.equal(r.complete, false);
  assert.equal(data.bookings[0].status, 'reserved');
});
test('an attended due record without a receipt needs payment review instead of a claimed balance', () => {
  const data = reserved(); data.visits = [visit()]; data.people = [{ id: 'child', role: 'child' }];
  const r = report(data);
  assert.equal(r.due_cents, 0); assert.equal(r.admission.payment_unconfirmed.length, 1); assert.equal(r.admission.visit_unconfirmed.length, 0);
  assert.equal(r.rows[0].pending_payment_cents, 1600); assert.equal(r.visitor_stats.visited_reservations, 1);
});
test('a separately settled Square admission remains confirmed, without guessing a booking match or billing again', () => {
  const data = reserved(); data.visits = [visit()];
  const r = report(data, [receipt()]);
  assert.equal(r.net_cents, 1600); assert.equal(r.admission.net_cents, 1600); assert.equal(r.admission.unlinked_square_cents, 1600);
  assert.equal(r.due_cents, 0); assert.equal(r.admission.payment_unconfirmed.length, 1);
  assert.equal(data.bookings[0].square_order_id, null);
});
test('only a verified partial payment on an attended admission establishes a remaining balance', () => {
  const data = reserved(); Object.assign(data.bookings[0], { payment_environment: 'production', square_order_id: 'order' });
  const partial = receipt({ payments: [{ id: 'p', amount_cents: 600, refunded_cents: 0, paid_at: `${date}T16:00:00Z` }] });
  const before = report(data, [partial]);
  assert.equal(before.net_cents, 600); assert.equal(before.due_cents, 0); assert.equal(before.rows[0].pending_payment_cents, 1000);
  data.visits = [visit({ payment_status: 'prepaid', square_environment: 'production', square_order_id: 'order', price_cents: 0 })];
  const attended = report(data, [partial]);
  assert.equal(attended.net_cents, 600); assert.equal(attended.due_cents, 1000); assert.equal(attended.rows[0].pending_payment_cents, 0); assert.equal(attended.complete, true);
  const refunded = report(data, [receipt({ payments: [{ id: 'p', amount_cents: 1600, refunded_cents: 1600, paid_at: `${date}T16:00:00Z` }] })]);
  assert.equal(refunded.net_cents, 0); assert.equal(refunded.due_cents, 0);
});
test('41 unlinked check-ins are 32 adults and 9 children, not 41 sales; repeat check-ins count once', () => {
  const data = empty();
  data.visits = Array.from({ length: 32 }, (_, i) => visit({ id: `adult-visit-${i}`, person_id: `adult-${i}`, household_id: `family-${i}`, payment_status: 'covered', price_cents: 0 }));
  data.people = Array.from({ length: 32 }, (_, i) => ({ id: `adult-${i}`, role: 'adult' }));
  const prices = [1600, 1600, 1600, 1000, 1000, 1000, 1600, 1600, 1000];
  const receipts = [];
  for (let i = 0; i < 9; i++) {
    data.visits.push(visit({ id: `child-visit-${i}`, person_id: `child-${i}`, price_cents: prices[i], payment_status: i < 6 ? 'paid' : 'due', square_environment: i < 6 ? 'production' : null, square_order_id: i < 6 ? `order-${i}` : null }));
    data.people.push({ id: `child-${i}`, role: 'child' });
    if (i < 6) receipts.push(receipt({ order_id: `order-${i}`, service_total_cents: prices[i], items: [{ label: 'Admission', category: 'open_play', amount_cents: prices[i] }], payments: [{ id: `p-${i}`, amount_cents: prices[i], refunded_cents: 0, paid_at: `${date}T16:00:00Z` }] }));
  }
  const r = report(data, receipts);
  assert.equal(r.admission.net_cents, 7800); assert.equal(r.due_cents, 0); assert.equal(r.admission.payment_unconfirmed.reduce((n, row) => n + row.pending_payment_cents, 0), 4200);
  assert.equal(r.visitor_stats.children, 9); assert.equal(r.visitor_stats.adults, 32); assert.equal(r.visitor_stats.total, 41);
  data.visits.push(visit({ id: 'repeat', person_id: 'adult-0', price_cents: 0, payment_status: 'covered' }));
  assert.equal(report(data, receipts).visitor_stats.total, 41);
});
test('financial categories merge admission sources and never expose a mixed record count', () => {
  const data = empty(); data.visits = [visit({ payment_status: 'paid', square_environment: 'production', square_order_id: 'order' })];
  const extra = receipt({ order_id: 'pos', service_total_cents: 2100, items: [{ label: 'Admission', category: 'open_play', amount_cents: 1600 }, { label: 'Latte', category: 'cafe', amount_cents: 500 }], payments: [{ id: 'pos-p', amount_cents: 2100, refunded_cents: 0, paid_at: `${date}T16:00:00Z` }] });
  const r = report(data, [receipt(), extra]);
  assert.equal(r.categories.find(row => row.category === 'admission').net_cents, 3200);
  assert(!r.categories.some(row => ['walk_in', 'open_play'].includes(row.category)));
  assert(r.categories.every(row => !('count' in row)));
  assert.equal(r.categories.reduce((n, row) => n + row.net_cents, 0), r.net_cents);
  assert.equal(r.admission.linked_cents + r.admission.unlinked_square_cents, r.admission.net_cents);
});
test('waiving a visit with a conflicting receipt cannot revive it as an unlinked Square admission', () => {
  const data = reserved(); data.bookings[0].payment_status = 'covered';
  data.visits = [visit({ payment_status: 'covered', square_environment: 'production', square_order_id: 'order' })];
  const r = report(data, [receipt()]);
  assert.equal(r.net_cents, 0); assert.equal(r.due_cents, 0); assert.equal(r.admission.unlinked_square_cents, 0);
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].expected_cents, 0);
  assert.equal(r.rows[0].received_cents, 1600); assert.equal(r.rows[0].issues.length, 1);
  assert.match(r.rows[0].issues[0], /Complimentary admission retains/);
  assert.equal(r.complete, false);
  data.bookings[0].square_order_id = 'order'; data.bookings[0].payment_environment = 'production';
  assert.equal(report(data, [receipt()]).net_cents, 0);
  data.bookings = [];
  assert.equal(report(data, [receipt()]).net_cents, 0);
});
test('missing visitor roles remain unknown, and sandbox/other-day visits never inflate attendance', async () => {
  const data = empty(); data.visits = [visit(), visit({ id: 'test', person_id: 'test', square_environment: 'sandbox' }), visit({ id: 'old', person_id: 'old', checked_in_at: '2026-11-13T16:00:00Z' })];
  const issues = []; let ids;
  await loadRevenueVisitorRoles({ from() { return { select() { return this; }, in(_key, batch) { ids = batch; return Promise.resolve({ data: [], error: null }); } }; } }, data, date, issues);
  assert.deepEqual(Array.from(ids), ['child']); assert.equal(issues.length, 1);
  const r = calculateRevenue(revenueServices(data), new Map(), date, issues, data);
  assert.equal(r.visitor_stats.total, 1); assert.equal(r.visitor_stats.unknown, 1); assert.equal(r.visitor_stats.children, 0); assert.equal(r.visitor_stats.complete, false); assert.equal(r.complete, false);
});
