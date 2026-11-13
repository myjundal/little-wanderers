import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

function setup({ production = true, owner = true } = {}) {
  const calls = [];
  const loader = loadSquareModules({ env: { RESEND_API_KEY: 'private-provider-test-key', VERCEL_ENV: production ? 'production' : 'preview' }, mocks: {
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/lib/authz': { requireOwnerContext: async () => owner ? { ok: true, admin: {} } : { ok: false, response: Response.json({ ok: false }, { status: 403 }) } },
    '@/lib/membership-billing-notice-runner.mjs': { runMembershipBillingNotices: async input => { calls.push(input); return { checked_at: '2026-11-14T01:00:00Z', results: [{ status: 'already_sent', recipient: 'private@example.com', family: 'Private Family' }], review: [], pending: 0 }; } },
  } });
  const auth = loader.load('src/lib/membership-billing-notice-auth.ts');
  const route = loader.load('src/app/api/membership-billing-notices/route.ts');
  const admin = loader.load('src/app/api/admin/membership-billing-notices/route.ts');
  const request = (body, token = auth.membershipNoticeTriggerToken(), origin) => new Request('https://www.thelittlewanderers.com/api/membership-billing-notices', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  return { auth, route, admin, calls, request };
}

test('only the scoped scheduler credential authenticates; provider key and absent credentials fail', async () => {
  const s = setup();
  assert.match(s.auth.membershipNoticeTriggerToken(), /^[a-f0-9]{64}$/);
  for (const token of ['', 'private-provider-test-key', '0'.repeat(64)]) assert.equal((await s.route.POST(s.request({ dry_run: false }, token))).status, 401);
  assert.equal(s.calls.length, 0);
});

test('production and explicit boolean are required before any runner access', async () => {
  const s = setup();
  assert.equal((await s.route.POST(s.request({ dry_run: 'false' }))).status, 400);
  const preview = setup({ production: false });
  assert.equal((await preview.route.POST(preview.request({ dry_run: false }))).status, 409);
  assert.equal(s.calls.length + preview.calls.length, 0);
});

test('dry run stays read-only and public workflow output omits recipient data', async () => {
  const s = setup();
  const response = await s.route.POST(s.request({ dry_run: true }));
  assert.equal(response.status, 200);
  assert.equal(s.calls[0].mode, 'preview');
  const text = await response.text();
  assert.doesNotMatch(text, /private@example.com|Private Family/);
  assert.equal(JSON.parse(text).charges_executed, false);
  await s.route.POST(s.request({ dry_run: false }));
  assert.equal(s.calls[1].mode, 'send_due');
});

test('only the personal owner may preview or provision, and cross-origin provisioning is rejected', async () => {
  const denied = setup({ owner: false });
  assert.equal((await denied.admin.GET()).status, 403);
  assert.equal((await denied.admin.POST(denied.request({ action: 'provision_scheduler_token' }))).status, 403);
  const s = setup();
  assert.equal((await s.admin.POST(s.request({ action: 'provision_scheduler_token' }, undefined, 'https://other.example'))).status, 403);
  const response = await s.admin.POST(s.request({ action: 'provision_scheduler_token' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  assert.equal(body.token, s.auth.membershipNoticeTriggerToken());
  assert.notEqual(body.token, 'private-provider-test-key');
});
