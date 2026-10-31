import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const content = loadModule('src/lib/waiver-content.ts');
const waivers = loadModule('src/lib/waivers.ts', { '@/lib/waiver-content': content });
const signed = { waiver_version: content.WAIVER_VERSION, signed_at: '2026-10-28T12:00:00Z', waiver_expires_at: '2027-01-26T12:00:00Z', covered_person_ids: ['child'] };

test('waivers require the current text and every participating child, and expire at the precise timestamp', () => {
  const now = new Date('2026-10-28T12:01:00Z');
  assert.equal(waivers.getWaiverStatus([], now).status, 'required');
  assert.equal(waivers.getWaiverStatus([{ ...signed, waiver_version: 'old' }], now).status, 'required');
  assert.equal(waivers.getWaiverStatus([signed], now, ['child']).status, 'completed');
  assert.equal(waivers.getWaiverStatus([signed], now, ['child', 'new-child']).status, 'required');
  assert.equal(waivers.getWaiverStatus([signed], new Date('2027-01-26T11:59:59Z')).status, 'completed');
  assert.equal(waivers.getWaiverStatus([signed], new Date('2027-01-26T12:00:00Z')).status, 'expired');
  assert.equal(waivers.getWaiverStatus([signed], new Date('2026-10-27')).status, 'required');
});

test('explicit non-expiring records stay completed without renewal dates and still require valid coverage', () => {
  const permanent = { ...signed, waiver_expires_at: 'infinity' };
  const later = new Date('2036-10-28T12:00:00Z');
  assert.deepEqual({ ...waivers.getWaiverStatus([permanent], later, ['child']) }, {
    status: 'completed', signedAt: '2026-10-28T12:00:00.000Z', expiresAt: null, daysUntilExpiration: null,
  });
  assert.equal(waivers.getWaiverStatus([permanent, { ...signed, signed_at: '2026-10-29T12:00:00Z' }], later, ['child']).status, 'completed');
  assert.equal(waivers.getWaiverStatus([permanent], later, ['new-child']).status, 'required');
  assert.equal(waivers.getWaiverStatus([{ ...permanent, waiver_version: 'old' }], later).status, 'required');
  assert.equal(waivers.getWaiverStatus([permanent], new Date('2026-10-27')).status, 'required');
  assert.equal(waivers.getWaiverStatus([{ ...signed, waiver_expires_at: null }], later).status, 'expired');
});

function harness({ user = { id: 'guardian', email: 'parent@example.test' }, role = 'primary_caregiver', saveError = null, readError = null } = {}) {
  const writes = [];
  const children = [{ id: 'child', first_name: 'Child', last_name: 'Family', role: 'child', birthdate: '2023-01-01' }];
  const admin = { from(table) {
    const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
      insert(row) { writes.push(row); return Promise.resolve({ error: saveError }); },
      maybeSingle: async () => ({ data: { role }, error: null }),
      then(resolve) { resolve({ data: table === 'people' ? children : [], error: readError }); },
    }; return q;
  } };
  const api = loadModule('src/app/api/waivers/route.ts', {
    'node:crypto': crypto,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/family-roles': { isFamilyManagerRole: value => ['primary_caregiver', 'caregiver'].includes(value) },
    '@/lib/waivers': waivers, '@/lib/waiver-content': content,
  });
  const body = { version: content.WAIVER_VERSION, family_revision: crypto.createHash('sha256').update(JSON.stringify(children)).digest('hex'), signature: 'Parent Family', is_guardian: true, electronic_consent: true, photo_consent: false, child_ids: ['child'], agreements: Object.fromEntries(content.WAIVER_AGREEMENTS.map(item => [item.id, true])) };
  return { api, writes, body, post: patch => api.POST({ json: async () => ({ ...body, ...patch }) }) };
}

test('waiver endpoints authenticate and refuse unsigned, stale or unauthorized submissions', async () => {
  assert.equal((await harness({ user: null }).api.GET()).status, 401);
  assert.equal((await harness({ user: null }).post()).status, 401);
  assert.equal((await harness({ role: 'member' }).post()).status, 403);
  const h = harness();
  for (const patch of [{ signature: '' }, { is_guardian: false }, { electronic_consent: false }, { photo_consent: undefined }, { agreements: {} }]) assert.equal((await h.post(patch)).status, 400);
  assert.equal((await h.post({ version: 'stale' })).status, 409);
  assert.equal((await h.post({ child_ids: ['someone-else'] })).status, 409);
  assert.equal((await h.post({ family_revision: 'stale' })).status, 409);
  assert.equal(h.writes.length, 0);
});

test('server fixes signer, family, text, children and expiration; photo refusal is preserved', async () => {
  const h = harness();
  const result = await h.post({ household_id: 'forged', signed_by_user_id: 'forged', signed_at: '2099-01-01', waiver_expires_at: '2099-01-01' });
  assert.equal(result.status, 200);
  const row = h.writes[0];
  assert.equal(row.household_id, 'family');
  assert.equal(row.signed_by_user_id, 'guardian');
  assert.equal(row.photo_consent, false);
  assert.equal(row.agreement_snapshot.paragraphs, content.WAIVER_PARAGRAPHS);
  assert.equal(row.covered_person_ids[0], 'child');
  assert.equal(new Date(row.waiver_expires_at) - new Date(row.signed_at), 90 * 86400000);
  assert.equal((await result.json()).waiver.status, 'completed');
  assert.equal((await harness({ saveError: new Error('DB offline') }).post()).status, 503);
  assert.equal((await harness({ readError: new Error('DB offline') }).api.GET()).status, 503);
});

test('check-in only uses authenticated staff identity and never trusts QR-supplied amounts or group size', async () => {
  let args;
  const api = loadModule('src/app/api/checkin/route.ts', {
    '@/lib/authz': { requireStaffContext: async () => ({ ok: true, user: { id: 'staff' }, role: 'staff', admin: { rpc: async (_name, values) => { args = values; return { data: { ok: false, code: 'waiver_required' } }; } } }) },
    '@/lib/waiver-content': content,
    '@/lib/open-play-reservations': { isUuid: value => /^[a-f0-9-]{36}$/.test(value) },
  });
  const response = await api.POST({ json: async () => ({ person_id: 'a'.repeat(36), created_by_user_id: 'forged', created_by_role: 'owner', price_cents: 0, group_size: 99 }) });
  assert.equal(response.status, 409);
  assert.equal(args.p_staff_user_id, 'staff');
  assert.equal(args.p_staff_role, 'staff');
  assert.equal(Object.keys(args).length, 5);
});
