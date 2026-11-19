import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, now } from './helpers/paid-family-fixture.mjs';
import { loadSquareModules, ids } from './helpers/admission-pos-harness.mjs';
const confirm = f => f.modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'source', 'staff', now);

test('Payment confirmed connects a settled family and returns its canonical identity', async () => {
  const f = fixture(), result = await confirm(f);
  assert.equal(result.status, 'confirmed'); assert.equal(result.family_link, 'linked'); assert.equal(result.household_id, 'target');
  assert.equal(f.db.checkins[1].payment_status, 'paid'); assert.equal(f.db.checkins[1].price_cents, 1600);
});

test('the button cannot declare an unpaid, partial, wrong-environment or unvisited family paid', async () => {
  for (const change of [
    f => { f.db.checkins[1].payment_status = 'due'; },
    f => { f.db.checkins[1].payment_status = 'pending'; },
    f => { f.db.checkins[1].square_environment = 'sandbox'; },
    f => { f.db.checkins = [f.db.checkins[0]]; },
    f => { f.db.checkins.push({ ...f.db.checkins[1], id: 'unpaid-sibling', payment_status: 'due', person_id: 'sibling' }); f.db.people.push({ ...f.db.people[3], id: 'sibling', first_name: 'Taylor' }); },
  ]) {
    const f = fixture(); change(f); const before = structuredClone(f.db.checkins);
    const result = await confirm(f); assert.ok(['pending', 'review'].includes(result.status));
    assert.deepEqual(f.db.checkins, before); assert.equal(f.db.membership_events.length, 0);
  }
});

test('existing Square launches are reconciled server-side before family linking', async () => {
  const f = fixture(); f.db.checkins[1].payment_status = 'due';
  f.db.admission_pos_sales.push({ id: 'sale', environment: 'production', status: 'open', checkin_ids: ['child-visit'] });
  let reconciled = 0;
  const modules = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, mocks: { '@/lib/square-admission-pos': {
    refreshAdmissionPosSales: async (_admin, sales) => { reconciled++; assert.equal(sales[0].id, 'sale'); f.db.checkins[1].payment_status = 'paid'; f.db.admission_pos_sales[0].status = 'paid'; return new Map([['sale', 'paid']]); },
  } } });
  const result = await modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'source', 'staff', now);
  assert.equal(reconciled, 1); assert.equal(result.status, 'confirmed'); assert.equal(result.family_link, 'linked');
});

test('a pending or ambiguous provider receipt causes no family mutations', async () => {
  for (const state of ['pending', 'review']) {
    const f = fixture(); f.db.admission_pos_sales.push({ id: 'sale', environment: 'production', status: 'open', checkin_ids: ['child-visit'] });
    const modules = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, mocks: { '@/lib/square-admission-pos': { refreshAdmissionPosSales: async () => new Map([['sale', state]]) } } });
    const result = await modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'source', 'staff', now);
    assert.equal(result.status, state); assert.equal(f.admin.writes.length, 0);
  }
});

test('a paid family remains confirmed when an ambiguous duplicate needs owner review', async () => {
  const f = fixture(); f.db.people[1].birthdate = '2024-01-01';
  const result = await confirm(f);
  assert.equal(result.status, 'confirmed'); assert.equal(result.family_link, 'review');
  assert.equal(f.db.checkins[1].payment_status, 'paid'); assert.equal(f.admin.writes.length, 0);
});

test('failed linking can retry after all visits have moved, with payment and signature intact', async () => {
  const f = fixture(), from = f.admin.from; let failed = false;
  f.admin.from = table => { const q = from(table), upsert = q.upsert; if (table === 'staff_family_search_aliases') q.upsert = (v, options) => { if (!failed) { failed = true; f.admin.failNext(table); } return upsert(v, options); }; return q; };
  const first = await confirm(f); assert.equal(first.status, 'confirmed'); assert.equal(first.family_link, 'pending');
  assert.equal(f.db.checkins.every(row => row.household_id === 'target'), true);
  const second = await confirm(f); assert.equal(second.status, 'confirmed'); assert.equal(second.family_link, 'linked');
  assert.equal(f.db.waivers[0].electronic_signature, 'D. Example');
});

test('a completed old merge never confirms a new unpaid visit', async () => {
  const f = fixture(); await confirm(f);
  f.db.checkins.push({ ...f.db.checkins[1], id: 'new-unpaid', payment_status: 'due' });
  const result = await confirm(f);
  assert.equal(result.status, 'pending'); assert.equal(f.db.checkins.at(-1).payment_status, 'due');
});

test('confirmation recovers a missing or expired membership term only from a fully paid existing Square invoice', async () => {
  for (const paidThrough of [null, '2026-11-14']) {
    const f = fixture(); f.db.checkins[1].payment_status = 'due';
    f.db.founding_memberships.push({ id: 'enrollment', household_id: 'source', environment: 'production', status: 'active',
      child_ids: ['guest-child'], square_subscription_id: 'sub', square_customer_id: 'customer', square_card_id: 'card',
      start_date: '2026-11-14', paid_through: paidThrough, created_at: '2026-11-01T12:00:00Z' });
    const before = structuredClone(f.db.checkins), calls = [];
    const modules = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async (url, options) => {
      calls.push({ url, method: options.method }); assert.equal(options.method, 'GET');
      if (url.includes('/subscriptions/')) return Response.json({ subscription: { id: 'sub', customer_id: 'customer', location_id: 'test-location', status: 'ACTIVE', charged_through_date: '2026-12-14', invoice_ids: ['invoice'] } });
      assert.ok(url.endsWith('/invoices/invoice'));
      return Response.json({ invoice: { subscription_id: 'sub', location_id: 'test-location', status: 'PAID', primary_recipient: { customer_id: 'customer' }, payment_requests: [{ computed_amount_money: { amount: 5000, currency: 'USD' }, total_completed_amount_money: { amount: 5000, currency: 'USD' } }] } });
    } });
    const result = await modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'source', 'staff', now);
    assert.equal(result.status, 'confirmed'); assert.equal(result.payment_status, 'included');
    assert.equal(f.db.founding_memberships[0].paid_through, '2026-12-14');
    assert.deepEqual(f.db.checkins, before); assert.equal(calls.length, 2);
  }
});

test('an unpaid or failed membership verification cannot approve admission or request another payment', async () => {
  for (const invoiceStatus of ['UNPAID', 'FAILED']) {
    const f = fixture(); f.db.checkins[1].payment_status = 'due';
    f.db.founding_memberships.push({ id: 'enrollment', household_id: 'source', environment: 'production', status: 'active', child_ids: ['guest-child'], square_subscription_id: 'sub', square_customer_id: 'customer', start_date: '2026-11-14', paid_through: null });
    const modules = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async (url, options) => {
      assert.equal(options.method, 'GET');
      if (invoiceStatus === 'FAILED') throw new Error('Square unavailable');
      if (url.includes('/subscriptions/')) return Response.json({ subscription: { id: 'sub', customer_id: 'customer', location_id: 'test-location', status: 'ACTIVE', charged_through_date: '2026-12-14', invoice_ids: ['invoice'] } });
      return Response.json({ invoice: { subscription_id: 'sub', location_id: 'test-location', status: 'UNPAID', primary_recipient: { customer_id: 'customer' } } });
    } });
    const run = () => modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'source', 'staff', now);
    if (invoiceStatus === 'FAILED') await assert.rejects(run(), /Square unavailable/);
    else assert.equal((await run()).status, 'review');
    assert.equal(f.db.founding_memberships[0].paid_through, null); assert.equal(f.db.checkins[1].payment_status, 'due');
  }
});

test('staff authorization and a valid family ID are required; client payment assertions are ignored', async () => {
  for (const status of [401, 403]) {
    let called = false;
    const modules = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: false, response: Response.json({ ok: false }, { status }) }) },
      '@/lib/family-payment-confirmation': { confirmFamilyPayment: async () => { called = true; } } } });
    const response = await modules.load('src/app/api/admin/admission/confirm/route.ts').POST({ json: async () => ({ household_id: ids.household }) });
    assert.equal(response.status, status); assert.equal(called, false);
  }
  let args;
  const modules = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => ({ ok: true, admin: 'server-db', user: { id: 'real-staff' } }) },
    '@/lib/family-payment-confirmation': { confirmFamilyPayment: async (...values) => { args = values; return { status: 'pending' }; } } } });
  const route = modules.load('src/app/api/admin/admission/confirm/route.ts');
  assert.equal((await route.POST({ json: async () => ({ household_id: 'invalid' }) })).status, 400);
  const response = await route.POST({ json: async () => ({ household_id: ids.household, paid: true, price_cents: 0, created_by_user_id: 'fake' }) });
  assert.equal((await response.json()).status, 'pending');
  assert.deepEqual(args, ['server-db', ids.household, 'real-staff']);
});


test('confirmation from the existing reservation finds today’s paid guest duplicate by verified caregiver email', async () => {
  const f = fixture();
  const result = await f.modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'target', 'staff', now);
  assert.equal(result.status, 'confirmed'); assert.equal(result.family_link, 'linked'); assert.equal(result.household_id, 'target');
  assert.equal(f.db.checkins[1].person_id, 'child'); assert.equal(f.db.checkins[1].price_cents, 1600);
});

test('reverse lookup never claims another family or merges two paid guest candidates', async () => {
  for (const change of [
    f => { f.admin.auth.admin.getUserById = async () => ({ data: { user: { email: 'other@example.test', email_confirmed_at: '2026-11-12' } }, error: null }); },
    f => { f.db.waivers.push({ ...f.db.waivers[0], id: 'other-waiver', household_id: 'other-guest' }); f.db.checkins.push({ ...f.db.checkins[1], id: 'other-visit', household_id: 'other-guest' }); },
  ]) {
    const f = fixture(); change(f);
    const result = await f.modules.load('src/lib/family-payment-confirmation.ts').confirmFamilyPayment(f.admin, 'target', 'staff', now);
    assert.ok(['pending', 'review'].includes(result.status)); assert.equal(f.admin.writes.length, 0);
  }
});
