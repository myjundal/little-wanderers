import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

const date = '2026-11-14';
const payment = { id: 'payment', order_id: 'order', location_id: 'test-location', status: 'COMPLETED', source_type: 'CARD',
  customer_id: 'customer', created_at: date + 'T15:01:00Z', amount_money: { amount: 1600, currency: 'USD' },
  card_details: { card: { last_4: '1234', cardholder_name: 'Parent Name', fingerprint: 'private', bin: 'private' } }, note: 'LW admission reference' };
const order = { id: 'order', location_id: 'test-location', total_money: { amount: 1600, currency: 'USD' },
  tenders: [{ payment_id: 'payment' }], line_items: [{ name: 'Open Play admission', note: 'booking reference', total_money: { amount: 1600, currency: 'USD' } }] };
function provider(patch = {}) {
  const requests = [];
  const modules = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' }, fetch: async (url, options) => {
    requests.push({ url, method: options.method });
    if (url.includes('/payments?')) return Response.json({ payments: [{ ...payment, ...patch.payment }] });
    if (url.includes('/orders/')) return Response.json({ order: { ...order, ...patch.order } });
    if (url.includes('/payments/')) return Response.json({ payment: { ...payment, ...patch.verifiedPayment } });
    if (url.includes('/customers/')) return Response.json({ customer: { id: 'customer', given_name: 'Parent', family_name: 'Name', email_address: 'private', phone_number: 'private', ...patch.customer } });
    throw new Error('Unexpected provider request');
  } });
  return { read: modules.load('src/lib/service-day-revenue-data.ts').readAdmissionReceiptCandidates, requests };
}

test('owner review exposes settled admission evidence with names and last four only, using provider reads only', async () => {
  const p = provider(); const receipts = await p.read(date);
  assert.equal(receipts.length, 1); assert.equal(receipts[0].order_id, 'order');
  assert.equal(receipts[0].payments[0].customer_name, 'Parent Name');
  assert.equal(receipts[0].payments[0].last_4, '1234');
  assert.equal(receipts[0].payments[0].amount_cents, 1600);
  assert(!JSON.stringify(receipts).includes('private'));
  assert(p.requests.every(request => request.method === 'GET'));
});
test('cash receipts retain their tender type and unrelated catalog sales are excluded', async () => {
  const cash = await provider({ payment: { source_type: 'CASH' } }).read(date);
  assert.equal(cash.length, 1); assert.equal(cash[0].payments[0].source_type, 'CASH');
  assert.equal((await provider({ order: { line_items: [{ name: 'Coffee', total_money: { amount: 1600, currency: 'USD' } }] } }).read(date)).length, 0);
});
test('party lookup uses its explicit category and never treats admission receipts as parties', async () => {
  assert.equal((await provider().read(date, 'party')).length, 0);
  const party = await provider({ order: { line_items: [{ name: 'Birthday Party - Base Package', total_money: { amount: 1600, currency: 'USD' } }] } }).read(date, 'party');
  assert.equal(party.length, 1);
});
test('binding errors fail instead of returning a plausible but unverified receipt', async () => {
  for (const patch of [{ order: { id: 'wrong' } }, { order: { location_id: 'wrong' } }, { verifiedPayment: { order_id: 'wrong' } }, { verifiedPayment: { id: 'wrong' } }, { verifiedPayment: { status: 'APPROVED' } }, { customer: { id: 'wrong' } }]) {
    await assert.rejects(provider(patch).read(date));
  }
});
test('receipt review API enforces the existing personal-owner gate, dates and private cache headers', async () => {
  let reads = 0;
  const data = { readAdmissionReceiptCandidates: async () => { reads++; return [{ order_id: 'verified' }]; } };
  const route = context => loadSquareModules({ mocks: { '@/lib/revenue-access': { requireRevenueContext: async () => context }, '@/lib/service-day-revenue-data': data } }).load('src/app/api/admin/revenue/admission-receipts/route.ts');
  for (const status of [401, 403]) {
    const denied = await route({ ok: false, response: new Response('denied', { status }) }).GET(new Request('https://example.test/?date=' + date));
    assert.equal(denied.status, status); assert.equal(reads, 0);
  }
  const allowed = route({ ok: true, admin: {} });
  assert.equal((await allowed.GET(new Request('https://example.test/?date=2026-02-30'))).status, 400); assert.equal(reads, 0);
  assert.equal((await allowed.GET(new Request('https://example.test/?kind=arbitrary'))).status, 400); assert.equal(reads, 0);
  const result = await allowed.GET(new Request('https://example.test/?date=' + date));
  assert.equal(result.status, 200); assert.equal(reads, 1);
  assert.match(result.headers.get('cache-control'), /private, no-store/); assert.equal(result.headers.get('vary'), 'Cookie');
});
