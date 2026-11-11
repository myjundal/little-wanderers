import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const modules = loadSquareModules();
const { revenueDay, validRevenueDate, allocateRevenue, revenueServices, calculateRevenue } = modules.load('src/lib/service-day-revenue.ts');
const empty = () => ({ bookings: [], slots: [], visits: [], parties: [], series: [], classes: [], registrations: [] });
const date = '2026-11-11';
const booking = { id: 'reservation', slot_id: 'slot', household_id: 'family', child_ids: ['child'], child_count: 1, status: 'reserved', payment_status: 'paid', payment_environment: 'production', amount_cents: 1600, square_order_id: 'order' };
const visit = { id: 'visit', person_id: 'child', household_id: 'family', checked_in_at: `${date}T15:00:00Z`, price_cents: 0, payment_status: 'prepaid', square_environment: 'production', square_order_id: 'order' };
const data = () => ({ ...empty(), bookings: [{ ...booking }], slots: [{ id: 'slot', starts_at: `${date}T14:00:00Z` }] });
const receipt = (patch = {}) => ({ order_id: 'order', service_total_cents: 1600, tax_cents: 0, tip_cents: 0,
  payments: [{ id: 'payment', amount_cents: 1600, refunded_cents: 0, paid_at: '2026-11-09T15:00:00Z' }], ...patch });
const report = (input, selected = date, payment = receipt()) => calculateRevenue(revenueServices(input), new Map([['order', payment]]), selected);

test('prepayment belongs only to the latest service date, with exact named-child check-in deduplication', () => {
  const input = data(); input.visits.push(visit);
  const result = report(input);
  assert.equal(result.rows.length, 1); assert.equal(result.net_cents, 1600); assert.equal(result.prepaid_cents, 1600); assert.equal(result.visited_cents, 1600);
  assert.equal(report(input, '2026-11-09').net_cents, 0);
  input.slots[0].starts_at = '2026-11-12T14:00:00Z'; input.visits = [];
  assert.equal(report(input).net_cents, 0); assert.equal(report(input, '2026-11-12').net_cents, 1600);
});
test('counter family payments consume exact check-ins and conserve a shared receipt across children', () => {
  const input = data(); Object.assign(input.bookings[0], { child_ids: ['child', 'sibling'], child_count: 2, payment_status: 'due', payment_environment: null, square_order_id: null, amount_cents: 2600 });
  input.visits = [{ ...visit, payment_status: 'paid', price_cents: 1600 }, { ...visit, id: 'second', person_id: 'sibling', payment_status: 'paid', price_cents: 1000 }];
  const result = report(input, date, receipt({ service_total_cents: 2600, payments: [{ id: 'p', amount_cents: 2600, refunded_cents: 0, paid_at: `${date}T16:00:00Z` }] }));
  assert.equal(result.rows.length, 1); assert.equal(result.net_cents, 2600); assert.equal(result.due_cents, 0); assert.equal(result.same_day_cents, 2600); assert.equal(result.complete, true);
});
test('receipt allocation mismatch and missing provider access never turn an uncertain payment into confirmed sales', () => {
  const result = report(data(), date, receipt({ service_total_cents: 9999 }));
  assert.equal(result.net_cents, 0); assert.equal(result.complete, false); assert.equal(result.review_count, 1);
  const offline = calculateRevenue(revenueServices(data()), new Map(), date);
  assert.equal(offline.net_cents, 0); assert.ok(offline.rows[0].issues.some(issue => issue.includes('unavailable')));
});
test('partial and full refunds reduce the original date without creating new debt', () => {
  for (const refunded_cents of [600, 1600]) {
    const result = report(data(), date, receipt({ payments: [{ id: 'p', amount_cents: 1600, refunded_cents, paid_at: '2026-11-09T16:00:00Z' }] }));
    assert.equal(result.net_cents, 1600 - refunded_cents); assert.equal(result.prepaid_cents, 1600 - refunded_cents); assert.equal(result.due_cents, 0);
  }
});
test('unpaid balances and partial deposits stay separate from earned-day receipts', () => {
  const input = { ...empty(), parties: [{ id: 'party', start_time: `${date}T15:00:00Z`, status: 'confirmed', price_quote_cents: 50000, square_environment: 'production', square_order_id: 'order', deposit_paid_cents: 15000, balance_paid_cents: 0 }] };
  const result = report(input, date, receipt({ service_total_cents: 50000, payments: [{ id: 'deposit', amount_cents: 15000, refunded_cents: 0, paid_at: '2026-11-01T16:00:00Z' }] }));
  assert.equal(result.net_cents, 15000); assert.equal(result.due_cents, 35000); assert.equal(result.reserved_cents, 15000);
});
test('five-session paid series is allocated on each real session date, conserving every cent', () => {
  const input = empty(); input.classes = [11, 12, 13, 14, 15].map((n, i) => ({ id: String(i), title: 'Art', status: 'scheduled', start_time: `2026-11-${n}T22:00:00Z` }));
  input.series = [{ id: 'series', class_ids: ['4', '2', '1', '0', '3'], child_ids: ['child'], status: 'paid', environment: 'production', amount_cents: 10003, square_order_id: 'order' }];
  const evidence = receipt({ service_total_cents: 10003, payments: [{ id: 'p', amount_cents: 10003, refunded_cents: 0, paid_at: '2026-11-01T15:00:00Z' }] });
  const totals = input.classes.map(session => report(input, session.start_time.slice(0, 10), evidence).net_cents);
  assert.deepEqual(totals, [2001, 2001, 2001, 2000, 2000]); assert.equal(totals.reduce((a, b) => a + b), 10003);
  input.classes[1].status = 'cancelled';
  assert.equal(report(input, '2026-11-12', evidence).net_cents, 0); assert.equal(report(input, '2026-11-13', evidence).net_cents, 2001);
});
test('membership-covered admissions and sandbox transactions do not create production revenue', () => {
  const input = data(); input.bookings[0].payment_environment = 'sandbox'; input.visits = [{ ...visit, square_environment: 'sandbox' }, { ...visit, id: 'member', square_order_id: null, square_environment: null, payment_status: 'covered', price_cents: 1600 }];
  const result = report(input); assert.equal(result.net_cents, 0); assert.equal(result.due_cents, 0); assert.equal(result.rows.length, 1);
});
test('cancelled paid bookings are excluded and retained payments require review', () => {
  const input = data(); input.bookings[0].status = 'cancelled';
  const result = report(input); assert.equal(result.net_cents, 0); assert.equal(result.complete, false); assert.equal(result.due_cents, 0);
});
test('paid no-shows and unlinked legacy parties require review instead of claimed revenue or debt', () => {
  const input = data(); input.bookings[0].status = 'no_show';
  const noShow = report(input); assert.equal(noShow.net_cents, 0); assert.equal(noShow.complete, false); assert.match(noShow.rows[0].issues.join(' '), /No-show/);
  const legacy = report({ ...empty(), parties: [{ id: 'legacy', start_time: `${date}T15:00:00Z`, status: 'confirmed', price_quote_cents: 50000, square_environment: null, square_order_id: null, deposit_paid_cents: null, balance_paid_cents: null }] });
  assert.equal(legacy.net_cents, 0); assert.equal(legacy.due_cents, 0); assert.equal(legacy.complete, false);
});
test('duplicate named-child reservations and repeated visits fail visibly instead of double counting', () => {
  const input = data(); input.bookings.push({ ...booking, id: 'duplicate' }); input.visits.push(visit);
  const result = report(input); assert.equal(result.net_cents, 0); assert.equal(result.complete, false);
});
test('payment received after the visit is attributed back to the service date', () => {
  const result = report(data(), date, receipt({ payments: [{ id: 'p', amount_cents: 1600, refunded_cents: 0, paid_at: '2026-11-12T16:00:00Z' }] }));
  assert.equal(result.net_cents, 1600); assert.equal(result.later_paid_cents, 1600); assert.equal(result.prepaid_cents + result.same_day_cents, 0);
});
test('New York dates, leap dates and cent allocations remain exact across daylight saving time', () => {
  assert.equal(revenueDay('2026-11-12T04:59:59Z'), date); assert.equal(revenueDay('2026-11-12T05:00:00Z'), '2026-11-12');
  assert.equal(revenueDay('2026-07-12T03:59:59Z'), '2026-07-11');
  assert.equal(validRevenueDate('2026-02-30'), false); assert.equal(validRevenueDate('2028-02-29'), true);
  assert.deepEqual(Array.from(allocateRevenue(5, [1, 1, 1])), [2, 2, 1]); assert.deepEqual(Array.from(allocateRevenue(1, [0, 3, 1])), [0, 1, 0]);
});
test('failed source retrieval marks an otherwise valid report as partial', () => {
  const result = calculateRevenue(revenueServices(data()), new Map([['order', receipt()]]), date, ['Unable to load parties']);
  assert.equal(result.net_cents, 1600); assert.equal(result.complete, false); assert.equal(result.issues.length, 1);
});

test('only the personal verified owner can read revenue, including direct API requests', async () => {
  const owner = { user: { id: '5054a175-2ba6-4023-a289-a9b0635ccc5f' }, role: 'owner', isKiosk: false };
  for (const context of [owner, { ...owner, user: null }, { ...owner, isKiosk: true }, { ...owner, role: 'admin' }, { ...owner, role: 'staff' }, { ...owner, role: 'instructor' }, { ...owner, user: { id: 'other-owner' } }]) {
    let adminReads = 0;
    const access = loadSquareModules({ mocks: { '@/lib/authz': { getCurrentUserRole: async () => context }, '@/lib/supabase/admin': { createAdminSupabaseClient() { adminReads++; return {}; } } } }).load('src/lib/revenue-access.ts');
    const allowed = context === owner;
    assert.equal(access.canViewRevenue(context), allowed);
    const result = await access.requireRevenueContext(); assert.equal(result.ok, allowed); assert.equal(adminReads, allowed ? 1 : 0);
    if (!allowed) { assert.equal(result.response.status, context.user ? 403 : 401); assert.match(result.response.headers.get('cache-control'), /no-store/); }
  }
});
test('API denies before querying finance data and rejects invalid dates without a query', async () => {
  let queries = 0;
  const mocks = { '@/lib/service-day-revenue-data': { async getServiceDayRevenue() { queries++; return {}; } } };
  const denied = loadSquareModules({ mocks: { ...mocks, '@/lib/revenue-access': { requireRevenueContext: async () => ({ ok: false, response: new Response('denied', { status: 403 }) }) } } }).load('src/app/api/admin/revenue/route.ts');
  assert.equal((await denied.GET(new Request('https://example.test/api/admin/revenue'))).status, 403); assert.equal(queries, 0);
  const allowed = loadSquareModules({ mocks: { ...mocks, '@/lib/revenue-access': { requireRevenueContext: async () => ({ ok: true, admin: {} }) } } }).load('src/app/api/admin/revenue/route.ts');
  assert.equal((await allowed.GET(new Request('https://example.test/api/admin/revenue?date=2026-02-30'))).status, 400); assert.equal(queries, 0);
  const response = await allowed.GET(new Request(`https://example.test/api/admin/revenue?date=${date}`)); assert.equal(response.status, 200); assert.equal(queries, 1); assert.match(response.headers.get('cache-control'), /private, no-store/);
});

test('live provider reads validate order binding, amounts, tips and ambiguous refunds', async () => {
  const provider = (patch = {}) => loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async url => {
    if (url.includes('/orders/')) return Response.json({ order: { id: 'order', location_id: 'test-location', total_money: { amount: 1600, currency: 'USD' }, tenders: [{ payment_id: 'payment' }], ...patch.order } });
    return Response.json({ payment: { id: 'payment', order_id: 'order', location_id: 'test-location', status: 'COMPLETED', amount_money: { amount: 1600, currency: 'USD' }, created_at: '2026-11-09T16:00:00Z', ...patch.payment } });
  } }).load('src/lib/service-day-revenue-data.ts');
  const result = await provider().readRevenueEvidence('order'); assert.equal(result.payments[0].amount_cents, 1600);
  for (const patch of [{ payment: { order_id: 'wrong' } }, { order: { location_id: 'wrong' } }, { payment: { amount_money: { amount: 1600, currency: 'EUR' } } }, { payment: { status: 'APPROVED' } }, { order: { total_money: { amount: 1700, currency: 'USD' }, total_tip_money: { amount: 100, currency: 'USD' } }, payment: { tip_money: { amount: 100, currency: 'USD' }, refunded_money: { amount: 100, currency: 'USD' } } }]) await assert.rejects(provider(patch).readRevenueEvidence('order'));
});
test('source loader follows every full page and does not keep a deceptively complete prefix after failure', async () => {
  const { loadRevenueSources } = modules.load('src/lib/service-day-revenue-data.ts');
  let pages = 0;
  const admin = { from(table) { let cursor = ''; const q = { select() { return q; }, order() { return q; }, limit() { return q; }, gt(_field, value) { cursor = value; return q; }, then(resolve) {
    if (table !== 'checkins') return resolve({ data: [], error: null }); pages++;
    return resolve(cursor ? { data: null, error: { message: 'offline' } } : { data: Array.from({ length: 500 }, (_, i) => ({ id: String(i).padStart(4, '0') })), error: null });
  } }; return q; } };
  const result = await loadRevenueSources(admin); assert.equal(pages, 2); assert.equal(result.sources.visits.length, 0); assert.equal(result.issues.length, 1);
});
