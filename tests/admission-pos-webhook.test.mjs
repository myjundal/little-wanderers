import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const sale = '50000000-0000-4000-8000-000000000001';
function fixture({ signed = true, pending = false, fail = false } = {}) {
  const reads = [], verifies = [];
  const admin = { from(table) { reads.push(table); const q = { select() { return q; }, eq() { return q; }, insert: async () => ({ error: null }),
    maybeSingle: async () => ({ data: { id: sale, status: 'open', environment: 'sandbox' } }) }; return q; } };
  const modules = loadSquareModules({ mocks: {
    'next/server': {}, '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/square-webhook': { verifySquareWebhook: () => signed },
    '@/lib/soft-opening-payments': {}, '@/lib/class-series-payments': {}, '@/lib/households': {}, '@/lib/founding-square': {},
    '@vercel/functions': {}, '@/lib/membership-notifications': {},
    '@/lib/square-admission-pos': { verifyAdmissionPos: async (_admin, stored, order) => { verifies.push({ stored, order }); if (fail) throw Error('receipt not verified'); } },
  } });
  const route = modules.load('src/app/api/webhooks/square/route.ts');
  const payment = { status: pending ? 'PENDING' : 'COMPLETED', order_id: pending ? undefined : 'order', note: `LW admission ${sale}` };
  return { reads, verifies, post: () => route.POST(new Request('https://example.test/api/webhooks/square', { method: 'POST', body: JSON.stringify({ type: 'payment.updated', event_id: 'event', data: { object: { payment } } }) })) };
}
test('signed completed admission webhook verifies frozen receipt before event logging and retries provider failures', async () => {
  const h = fixture(); assert.equal((await h.post()).status, 200);
  assert.deepEqual(h.reads, ['admission_pos_sales']); assert.equal(h.verifies[0].stored.id, sale); assert.equal(h.verifies[0].order, 'order');
  const failed = fixture({ fail: true }); assert.equal((await failed.post()).status, 503); assert.ok(!failed.reads.includes('webhook_log'));
});
test('unsigned events never read private records and pending payments never settle admission', async () => {
  const bad = fixture({ signed: false }); assert.equal((await bad.post()).status, 401); assert.equal(bad.reads.length, 0);
  const pending = fixture({ pending: true }); assert.equal((await pending.post()).status, 200); assert.equal(pending.verifies.length, 0);
});
