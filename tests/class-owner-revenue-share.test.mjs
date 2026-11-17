import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const { calculateRevenue } = loadSquareModules().load('src/lib/service-day-revenue.ts');
const date = '2026-11-17';
const service = (id, amount, extra = {}) => ({ id, date, category: 'class', label: id, expected_cents: amount,
 attendance: 'visited', cancelled: false, charges: [{ order_id: id, amount_cents: amount }], issues: [], ...extra });
const receipt = (id, amount, extra = {}) => ({ order_id: id, service_total_cents: amount, tax_cents: 0, tip_cents: 0,
 payments: [{ id: 'payment-' + id, amount_cents: amount, refunded_cents: 0, paid_at: date + 'T16:00:00Z' }], ...extra });
const report = (services, receipts, selected = date) => calculateRevenue(services, new Map(receipts.map(r => [r.order_id, r])), selected);
const total = (rows, field) => rows.reduce((n, row) => n + row[field], 0);

test('$120 of class income contributes $36 to revenue with $84 separately allocated to the instructor', () => {
 const services = [0, 1, 2, 3].map(i => service('child-' + i, 3000));
 services.push(service('admission', 2000, { category: 'open_play' }), service('coffee', 500, { category: 'cafe', attendance: 'sale' }));
 const receipts = services.map(s => receipt(s.id, s.expected_cents));
 const before = JSON.stringify({ services, receipts });
 const r = report(services, receipts);
 assert.equal(r.class_gross_cents, 12000); assert.equal(r.class_owner_cents, 3600); assert.equal(r.class_instructor_cents, 8400);
 assert.equal(r.class_cents, 3600); assert.equal(r.net_cents, 6100); assert.equal(r.gross_net_cents, 14500);
 assert.equal(r.categories.find(c => c.category === 'class').net_cents, 3600);
 assert.equal(total(r.categories, 'net_cents'), r.net_cents); assert.equal(total(r.rows, 'net_cents'), r.net_cents);
 assert.equal(r.visited_cents + r.reserved_cents + r.sales_cents, r.net_cents);
 for (const row of r.rows.filter(row => row.category === 'class')) {
  assert.equal(row.received_cents, 3000); assert.equal(row.gross_net_cents, 3000); assert.equal(row.net_cents, 900); assert.equal(row.instructor_share_cents, 2100);
 }
 assert.equal(JSON.stringify({ services, receipts }), before, 'receipt evidence and source services remain unchanged');
});

test('refunds reduce class income before the split and customer refund/debt amounts remain full values', () => {
 for (const refund of [1500, 12000]) {
  const r = report([service('class', 12000)], [receipt('class', 12000, { payments: [{ id: 'p', amount_cents: 12000, refunded_cents: refund, paid_at: date + 'T16:00:00Z' }] })]);
  assert.equal(r.class_gross_cents, 12000 - refund); assert.equal(r.net_cents, (12000 - refund) * .3);
  assert.equal(r.refunded_cents, refund); assert.equal(r.rows[0].received_cents, 12000); assert.equal(r.due_cents, 0);
 }
 const partial = report([service('class', 12000)], [receipt('class', 12000, { payments: [{ id: 'p', amount_cents: 4000, refunded_cents: 0, paid_at: date + 'T16:00:00Z' }] })]);
 assert.equal(partial.net_cents, 1200); assert.equal(partial.due_cents, 8000);
});

test('prepayment, same-day and later-payment owner components reconcile to the owner total', () => {
 const payments = [
  { id: 'prepaid', amount_cents: 5000, refunded_cents: 0, paid_at: '2026-11-16T15:00:00Z' },
  { id: 'today', amount_cents: 4000, refunded_cents: 0, paid_at: date + 'T16:00:00Z' },
  { id: 'later', amount_cents: 3000, refunded_cents: 0, paid_at: '2026-11-18T16:00:00Z' },
 ];
 const r = report([service('class', 12000)], [receipt('class', 12000, { payments })]);
 assert.equal(r.prepaid_cents, 1500); assert.equal(r.same_day_cents, 1200); assert.equal(r.later_paid_cents, 900);
 assert.equal(r.prepaid_cents + r.same_day_cents + r.later_paid_cents, r.net_cents);
 assert.equal(r.rows[0].gross_prepaid_cents, 5000); assert.equal(r.rows[0].gross_same_day_cents, 4000); assert.equal(r.rows[0].gross_later_paid_cents, 3000);
 assert.equal(report([service('class', 12000)], [receipt('class', 12000, { payments })], '2026-11-16').net_cents, 0);
});

test('the daily share rounds once to cents, stays deterministic and conserves both shares on tiny payments', () => {
 const services = ['f', 'e', 'd', 'c', 'b', 'a'].map(id => service(id, 1));
 const receipts = services.map(s => receipt(s.id, 1));
 const r = report(services, receipts), reversed = report([...services].reverse(), receipts);
 assert.equal(r.class_gross_cents, 6); assert.equal(r.class_owner_cents, 2); assert.equal(r.class_instructor_cents, 4);
 assert.equal(total(r.rows, 'net_cents'), 2); assert.equal(total(r.rows, 'instructor_share_cents'), 4);
 for (const row of r.rows) {
  assert.equal(row.net_cents + row.instructor_share_cents, row.gross_net_cents);
  assert.equal(row.prepaid_cents + row.same_day_cents + row.later_paid_cents, row.net_cents);
  assert.equal(reversed.rows.find(other => other.id === row.id).net_cents, row.net_cents);
 }
 assert.equal(report([service('half-cent', 5)], [receipt('half-cent', 5)]).class_owner_cents, 2);
});

test('cancelled, unallocated and unverified classes never contribute an owner or instructor share', () => {
 for (const extra of [{ cancelled: true }, { issues: ['Needs review.'] }, { recognition: 'unallocated_class', issues: ['Class date is not linked.'] }]) {
  const r = report([service('excluded', 12000, extra)], [receipt('excluded', 12000)]);
  assert.equal(r.net_cents, 0); assert.equal(r.class_gross_cents, 0); assert.equal(r.class_owner_cents, 0); assert.equal(r.class_instructor_cents, 0);
  assert.equal(r.rows[0].received_cents, 12000); assert.equal(r.complete, false);
 }
 const missing = report([service('missing', 12000)], []); assert.equal(missing.class_owner_cents, 0); assert.equal(missing.complete, false);
});

test('gift card redemption is excluded before the class split, with tax and tip evidence unchanged', () => {
 const r = report([service('class', 12000)], [receipt('class', 12000, { tax_cents: 800, tip_cents: 500, payments: [
  { id: 'cash', amount_cents: 8000, refunded_cents: 0, paid_at: date + 'T16:00:00Z' },
  { id: 'redeemed', amount_cents: 4000, refunded_cents: 0, paid_at: date + 'T16:00:00Z', gift_card: true },
 ] })]);
 assert.equal(r.class_gross_cents, 8000); assert.equal(r.net_cents, 2400); assert.equal(r.class_instructor_cents, 5600);
 assert.equal(r.redeemed_cents, 4000); assert.equal(r.rows[0].tax_cents, 800); assert.equal(r.rows[0].tip_cents, 500);
});
