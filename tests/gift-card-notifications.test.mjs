import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const amount = value => ({ amount: value, currency: 'USD' });
const order = () => ({ id: 'gift-order', location_id: 'live-location', state: 'COMPLETED', total_money: amount(6600),
  tenders: [{ payment_id: 'paid-receipt' }], line_items: [{ item_type: 'GIFT_CARD', total_money: amount(5000) }, { item_type: 'ITEM', total_money: amount(1600) }] });
const payment = () => ({ id: 'paid-receipt', order_id: 'gift-order', location_id: 'live-location', status: 'COMPLETED',
  created_at: '2026-11-21T17:00:00Z', total_money: amount(6600), buyer_email_address: '<parent>@example.com', receipt_url: 'https://squareup.com/receipt/preview/example' });
function fixture({ environment = 'production' } = {}) {
  const rows = new Map(), mails = [], reads = [], state = { mailOk: true, failSave: false, payment: payment() };
  const admin = { from() {
    let operation = 'read', record, filters = {};
    const q = { select() { return q; }, eq(k, v) { filters[k] = v; return q; }, maybeSingle() { return q; }, single() { return q; },
      insert(value) { operation = 'insert'; record = value; return q; }, update(value) { operation = 'update'; record = value; return q; },
      async then(resolve) {
        const key = `${record?.provider || filters.provider}:${record?.event_id || filters.event_id}`;
        if (operation === 'insert') { if (rows.has(key)) return resolve({ error: { code: '23505' } }); rows.set(key, structuredClone(record)); return resolve({ error: null }); }
        if (operation === 'update') { if (state.failSave) return resolve({ error: { message: 'write interrupted' } }); Object.assign(rows.get(key), structuredClone(record)); return resolve({ error: null }); }
        resolve({ data: rows.get(key) || null, error: null });
      } };
    return q;
  } };
  const api = loadSquareModules({ env: { SQUARE_ENVIRONMENT: environment, SQUARE_LOCATION_ID: 'live-location' }, mocks: {
    '@/lib/email-campaigns': { sendResendEmail: async input => { mails.push(structuredClone(input)); return state.mailOk ? { ok: true, id: 'email-id' } : { ok: false }; } },
    '@/lib/square-client': { squareConfig: () => ({ environment, locationId: 'live-location' }), squareRequest: async path => { reads.push(path); return path.includes('/payments/') ? { payment: state.payment } : { order: order() }; } },
  } }).load('src/lib/gift-card-notifications.ts');
  return { api, admin, rows, mails, reads, state };
}

test('a completed mixed receipt emails only the gift-card amount, with Eastern time and no gift-card secrets', async () => {
  const h = fixture(); assert.equal((await h.api.notifyGiftCardOrder(h.admin, order())).sent, true);
  assert.equal(h.mails.length, 1); const email = h.mails[0];
  assert.equal(email.to, 'hello@thelittlewanderers.com');
  assert.equal(email.subject, 'Gift card purchased: $50.00');
  assert.match(email.html, /12:00:00 PM/); assert.match(email.html, /&lt;parent&gt;@example.com/);
  assert.match(email.html, /https:\/\/squareup.com\/receipt\/preview\/example/);
  assert.doesNotMatch(email.html, /\$66\.00|gift_card_gan|card_number/);
  assert.equal(email.idempotencyKey, 'gift-card-purchase/production/gift-order');
  assert.equal((await h.api.notifyGiftCardOrder(h.admin, order())).reason, 'already_sent'); assert.equal(h.mails.length, 1);
});

test('gift-card redemptions, lookalike product names, free cards, sandbox and refund updates do not email', async () => {
  const h = fixture(), ordinary = { ...order(), line_items: [{ item_type: 'ITEM', name: 'Gift card holder', total_money: amount(5000) }] };
  assert.equal((await h.api.notifyGiftCardOrder(h.admin, ordinary)).reason, 'not_gift_card');
  assert.equal(h.reads.length, 0); assert.equal(h.mails.length, 0);
  assert.equal((await h.api.notifyGiftCardOrder(h.admin, { ...order(), line_items: [{ item_type: 'GIFT_CARD', total_money: amount(0) }] })).reason, 'no_payment');
  const sandbox = fixture({ environment: 'sandbox' }); assert.equal((await sandbox.api.notifyGiftCardOrder(sandbox.admin, order())).reason, 'sandbox');
  h.state.payment.refunded_money = amount(100); assert.equal((await h.api.notifyGiftCardOrder(h.admin, order())).reason, 'refunded');
  assert.equal(h.mails.length, 0); assert.equal(sandbox.mails.length, 0);
});

test('unpaid, mismatched, foreign-currency and partially settled purchases remain retryable without email', async () => {
  for (const change of [p => p.status = 'PENDING', p => p.order_id = 'other', p => p.location_id = 'other', p => p.total_money = amount(1000), p => p.total_money.currency = 'EUR']) {
    const h = fixture(); change(h.state.payment); await assert.rejects(() => h.api.notifyGiftCardOrder(h.admin, order())); assert.equal(h.mails.length, 0);
  }
  const h = fixture(); await assert.rejects(() => h.api.notifyGiftCardOrder(h.admin, { ...order(), state: 'OPEN' }));
});

test('mail failures and uncertain database saves retry the frozen payload with the same key', async () => {
  for (const failSave of [false, true]) {
    const h = fixture(); h.state.failSave = failSave; h.state.mailOk = failSave;
    await assert.rejects(() => h.api.notifyGiftCardOrder(h.admin, order()));
    h.state.mailOk = true; h.state.failSave = false; h.state.payment.buyer_email_address = 'changed@example.com';
    assert.equal((await h.api.notifyGiftCardOrder(h.admin, order())).sent, true);
    assert.deepEqual(h.mails[0], h.mails[1]);
    assert.equal((await h.api.notifyGiftCardOrder(h.admin, order())).reason, 'already_sent'); assert.equal(h.mails.length, 2);
  }
});

test('concurrent event types share a durable record and stale uncertain sends require review', async () => {
  const h = fixture(); await Promise.all([h.api.notifyGiftCardOrder(h.admin, order()), h.api.notifyGiftCardOrder(h.admin, order())]);
  assert.equal(h.rows.size, 1); assert.ok(h.mails.every(mail => JSON.stringify(mail) === JSON.stringify(h.mails[0])));
  const row = [...h.rows.values()][0]; delete row.payload.sent_at; row.payload.prepared_at = '2020-01-01T00:00:00Z';
  const count = h.mails.length; await assert.rejects(() => h.api.notifyGiftCardOrder(h.admin, order()), /delivery review/); assert.equal(h.mails.length, count);
});

function routeFixture({ authorized = true, production = true } = {}) {
  const calls = [], admin = {};
  const route = loadModule('src/app/api/admin/gift-card-notifications/route.ts', {
    '@/lib/revenue-access': { requireRevenueContext: async () => authorized ? { ok: true, admin } : { ok: false, response: new Response('Forbidden', { status: 403 }) } },
    '@/lib/gift-card-notifications': { giftCardWebhookStatus: async () => ({ enabled: true }), enableGiftCardWebhooks: async () => { calls.push('enable'); return { enabled: true }; },
      notifyGiftCardPayment: async (_admin, id) => { calls.push(id); return { sent: true }; } },
  }, { process: { env: { VERCEL_ENV: production ? 'production' : 'preview' } } });
  const post = (body, origin = 'https://example.com') => route.POST(new Request('https://example.com/api/admin/gift-card-notifications', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { route, calls, post };
}
test('setup and replay require the personal owner, production and same origin', async () => {
  const denied = routeFixture({ authorized: false }); assert.equal((await denied.route.GET()).status, 403); assert.equal((await denied.post({ action: 'enable' })).status, 403); assert.equal(denied.calls.length, 0);
  const preview = routeFixture({ production: false }); assert.equal((await preview.post({ action: 'enable' })).status, 409);
  const h = routeFixture(); assert.equal((await h.post({ action: 'enable' }, 'https://attacker.com')).status, 403);
  assert.equal((await h.post({ action: 'enable' })).status, 200);
  assert.equal((await h.post({ action: 'replay', payment_id: 'paid-receipt' })).status, 200);
  assert.equal((await h.post({ action: 'replay', payment_id: '../credentials' })).status, 400);
  assert.deepEqual(h.calls, ['enable', 'paid-receipt']);
});

test('enabling purchase webhooks preserves other events, URL and signing key', async () => {
  const calls = [], subscription = { id: 'existing', notification_url: 'https://example.com/api/webhooks/square', signature_key: 'existing-key', enabled: true, event_types: ['invoice.payment_made'] };
  const api = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production', SQUARE_WEBHOOK_URL: subscription.notification_url, SQUARE_WEBHOOK_SIGNATURE_KEY: subscription.signature_key }, mocks: {
    '@/lib/square-client': { squareConfig: () => ({ environment: 'production' }), squareRequest: async (path, method = 'GET', body) => { calls.push({ path, method, body }); if (method === 'PUT') Object.assign(subscription, body.subscription); return { subscriptions: [subscription] }; } },
  } }).load('src/lib/gift-card-notifications.ts');
  assert.equal((await api.enableGiftCardWebhooks()).purchase_notifications_enabled, true);
  const changed = calls.find(call => call.method === 'PUT').body.subscription;
  assert.ok(changed.event_types.includes('invoice.payment_made'));
  for (const event of ['payment.created', 'payment.updated', 'gift_card.activity.created']) assert.ok(changed.event_types.includes(event));
  assert.ok(!('notification_url' in changed)); assert.ok(!('signature_key' in changed));
  await api.enableGiftCardWebhooks(); assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
});

test('signed gift-card purchase activities are handled before legacy event logging; failures remain retryable', async () => {
  for (const fails of [false, true]) {
    const calls = [];
    const route = loadSquareModules({ mocks: {
      'next/server': {}, '@supabase/supabase-js': { createClient: () => ({ from() { throw Error('Legacy event log must not consume this event'); } }) },
      '@/lib/square-webhook': { verifySquareWebhook: () => true },
      '@/lib/gift-card-notifications': { notifyGiftCardOrder: async (_admin, receipt) => { calls.push(receipt.id); if (fails) throw Error('retry'); } },
      '@/lib/square-client': { squareRequest: async () => ({ order: order() }), squareEnvironment: () => 'production' },
      '@/lib/party-deposit': {}, '@/lib/soft-opening-payments': {}, '@/lib/class-series-payments': {}, '@/lib/households': {},
      '@/lib/founding-square': {}, '@vercel/functions': {}, '@/lib/membership-notifications': {}, '@/lib/square-admission-pos': {}, '@/lib/class-checkout': {},
    } }).load('src/app/api/webhooks/square/route.ts');
    const post = type => route.POST(new Request('https://example.com/api/webhooks/square', { method: 'POST', body: JSON.stringify({ type: 'gift_card.activity.created', data: { object: { gift_card_activity: { type, activate_activity_details: { order_id: 'gift-order' } } } } }) }));
    assert.equal((await post('ACTIVATE')).status, fails ? 503 : 200); assert.deepEqual(calls, ['gift-order']);
    assert.equal((await post('REDEEM')).status, 200); assert.equal(calls.length, 1);
  }
});
