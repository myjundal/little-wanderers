import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const saleId = '50000000-0000-4000-8000-000000000001';
test('receipt capability is signed, expires, is purpose bound and cannot become a staff login', () => {
  const tokens = loadSquareModules().load('src/lib/square-pos-return-token.ts');
  const now = Date.now(), token = tokens.createPosReturnState(saleId, now);
  assert.equal(tokens.verifyPosReturnState(token, now), saleId);
  for (const invalid of [saleId, token.replace(saleId, saleId.replace(/1$/, '2')), token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), 'x'.repeat(200)]) assert.equal(tokens.verifyPosReturnState(invalid, now), null);
  assert.equal(tokens.verifyPosReturnState(token, now + 86400001), null);
});
test('public return rejects forged state before reading records and only returns provider verified receipt status', async () => {
  let reads = 0, verifies = 0, syncs = 0, rejectReceipt = false;
  const modules = loadSquareModules({ mocks: {
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => ({ from(table) { assert.equal(table, 'admission_pos_sales'); reads++; const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: { id: saleId, launched_at: new Date().toISOString(), status: 'open' } }) }; return q; } }) },
    '@/lib/square-admission-pos': { verifyAdmissionPos: async () => { verifies++; if (rejectReceipt) throw Error('wrong order'); return { status: 'paid', household_id: 'must-not-leak' }; }, reconcileAdmissionPos: async () => { syncs++; return { status: 'pending' }; } },
  } });
  const token = modules.load('src/lib/square-pos-return-token.ts').createPosReturnState(saleId);
  const route = modules.load('src/app/api/square/pos-return/route.ts');
  const post = (state, origin = 'https://example.test') => route.POST(new Request('https://example.test/api/square/pos-return', { method: 'POST', headers: { origin }, body: JSON.stringify({ state, transaction_id: 'receipt' }) }));
  assert.equal((await post(saleId)).status, 400); assert.equal(reads, 0);
  assert.equal((await post(token, 'https://elsewhere.test')).status, 403); assert.equal(reads, 0);
  assert.deepEqual(await (await post(token)).json(), { ok: true, status: 'paid' }); assert.equal(verifies, 1);
  rejectReceipt = true;
  assert.deepEqual(await (await post(token)).json(), { ok: true, status: 'pending' }); assert.equal(syncs, 1);
});
