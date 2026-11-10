import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

test('soft opening accepts authenticated phone-only members as well as email accounts', async () => {
  let lookups = 0;
  const admin = { from() { lookups++; return { select() { return this; }, eq() { return this; }, async limit() { return { data: [{ id: 'entry' }], error: null }; } }; } };
  const api = loadModule('src/lib/soft-opening-access.ts', {
    '@/lib/waitlist': { normalizeWaitlistEmail: value => value.trim().toLowerCase() },
  });
  const phone = await api.getSoftOpeningAccessForUser(admin, { id: 'phone-user', email: '', phone: '18605550123' });
  assert.equal(phone.allowed, true);
  assert.equal(lookups, 0, 'phone access must not depend on an email or waitlist match');
  const email = await api.getSoftOpeningAccessForUser(admin, { id: 'email-user', email: 'parent@example.test', phone: '' });
  assert.equal(email.allowed, true);
  assert.equal(email.on_wanderlist, true);
  assert.equal((await api.getSoftOpeningAccessForUser(admin, { id: '', email: 'parent@example.test', phone: '' })).allowed, false);
  assert.equal((await api.getSoftOpeningAccessForUser(admin, { id: 'anonymous', email: '', phone: '' })).allowed, false);
});

test('phone-only member can reserve an enrolled child with zero admission and continue to waiver', async () => {
  const slotId = '10000000-0000-4000-8000-000000000001';
  const writes = [], background = [];
  const admin = { from(table) {
    let inserted;
    const q = { select() { return q; }, eq() { return q; }, gt() { return q; }, limit() { return q; },
      insert(row) { inserted = row; writes.push(row); return q; },
      async maybeSingle() { return { error: null, data: table === 'open_play_reservation_slots' ? { id: slotId, starts_at: '2099-11-11T14:00:00Z', ends_at: '2099-11-11T15:00:00Z', status: 'open', capacity_children: 5 } : inserted ? { id: 'reservation', ...inserted } : null }; },
    }; return q;
  } };
  const { load } = loadSquareModules({ mocks: {
    '@vercel/functions': { waitUntil: promise => background.push(promise) },
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'phone-user', email: '', phone: '18605550123' } } }) } }) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/open-play-reservations': { SOFT_OPENING_START: '2099-11-11', SOFT_OPENING_END: '2100-01-01', isUuid: v => v === slotId, sanitizeReservationCount: v => v, getReservationOccupancy: async () => ({ children: 0, total: 0 }), isMissingOpenPlayReservationTable: () => false, formatOpenPlayReservationError: v => v },
    '@/lib/soft-opening-family': { saveSoftOpeningFamily: async () => ({ childIds: ['child'], memberships: [{ child_ids: ['child'], status: 'pending', start_date: null, paid_through: null }], children: [], guardianName: 'Parent Family' }) },
    '@/lib/admin-notifications': { sendOpenPlayReservationNotification: async () => ({ ok: true }) },
  } });
  const api = load('src/app/api/open-play-reservations/route.ts');
  const response = await api.POST({ json: async () => ({ slot_id: slotId, adult_count: 1, payment_choice: 'counter', children: [{ id: 'child' }] }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.waiver_url, '/landing/waiver?reservation=reservation');
  assert.equal(writes[0].amount_cents, 0);
  assert.equal(writes[0].payment_choice, 'membership');
  assert.equal(writes[0].payment_status, 'covered');
  assert.equal(writes[0].household_id, 'family');
  await Promise.all(background);
});
