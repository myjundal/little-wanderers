import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const schedule = loadModule('src/lib/open-play-reservations.ts');
const slotId = '10000000-0000-4000-8000-000000000001';
function harness({ startsAt = '2026-11-14T14:00:00Z', user = { id: 'new-user', email: 'new@example.test' } } = {}) {
  const filters = [], writes = [], background = [];
  const admin = { from(table) {
    let inserted;
    const q = { select() { return q; }, eq() { return q; }, neq() { return q; }, gt() { return q; }, lt() { return q; }, order() { return q; }, limit() { return q; },
      gte(key, value) { filters.push([table, key, value]); return q; },
      insert(row) { inserted = row; writes.push(row); return q; },
      async maybeSingle() { return { error: null, data: table === 'open_play_reservation_slots' ? { id: slotId, starts_at: startsAt, ends_at: startsAt.replace('14:00', '15:00'), status: 'open', capacity_children: 5 } : inserted ? { id: 'booking', ...inserted } : null }; },
      then(resolve) { resolve({ data: [], error: null }); },
    }; return q;
  } };
  const route = loadModule('src/app/api/open-play-reservations/route.ts', {
    '@vercel/functions': { waitUntil: promise => background.push(promise) },
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/soft-opening-access': { getSoftOpeningAccessForUser: async () => ({ allowed: true }) },
    '@/lib/open-play-reservations': { ...schedule, getReservationOccupancy: async () => ({ children: 0, total: 0 }) },
    '@/lib/soft-opening-family': { readSoftOpeningFamily: async () => ({ children: [] }), saveSoftOpeningFamily: async () => ({ childIds: ['child'], children: [{ name: 'Child' }], memberships: [], guardianName: 'Parent' }) },
    '@/lib/soft-opening-pricing': { softOpeningAmount: () => 1600 },
    '@/lib/admin-notifications': { sendOpenPlayReservationNotification: async () => ({ ok: true }) },
    '@/lib/open-play-confirmation': { sendOpenPlayConfirmation: async () => ({ ok: true }) },
    '@/lib/logger': { logger: { error() {}, warn() {} } },
  }, { Intl, Date: class extends Date { static now() { return Date.parse('2026-11-11T20:00:00Z'); } } });
  return { route, filters, writes, background };
}

test('public calendar begins November 14 Eastern while invited calendar retains November 11', async () => {
  for (const [query, start] of [['?source=public', schedule.PUBLIC_OPEN_PLAY_START], ['', schedule.SOFT_OPENING_START]]) {
    const h = harness();
    assert.equal((await h.route.GET(new Request(`https://example.test/api/open-play-reservations${query}`))).status, 200);
    assert.ok(h.filters.some(([table, key, value]) => table === 'open_play_reservation_slots' && key === 'starts_at' && value === start));
  }
});

test('public booking rejects a pre-Saturday slot before writing, and a new family can reserve Saturday at regular pricing', async () => {
  for (const [startsAt, source, expected] of [['2026-11-13T14:00:00Z', 'public', 409], ['2026-11-14T14:00:00Z', 'public', 200], ['2026-11-13T14:00:00Z', 'invitation', 200]]) {
    const h = harness({ startsAt });
    const response = await h.route.POST({ json: async () => ({ slot_id: slotId, booking_source: source, children: [{ id: 'child' }], adult_count: 1, payment_choice: 'counter' }) });
    assert.equal(response.status, expected);
    assert.equal(h.writes.length, expected === 200 ? 1 : 0);
    if (expected === 200) { assert.equal(h.writes[0].amount_cents, 1600); assert.equal(h.writes[0].payment_status, 'due'); assert.equal((await response.json()).waiver_url, '/landing/waiver?reservation=booking'); }
    await Promise.all(h.background);
  }
});

test('public calendar and booking require authentication', async () => {
  const h = harness({ user: null });
  assert.equal((await h.route.GET(new Request('https://example.test/api/open-play-reservations?source=public'))).status, 401);
  assert.equal((await h.route.POST({ json: async () => ({}) })).status, 401);
  assert.equal(h.writes.length, 0);
});

test('public sign-in keeps the public booking destination for both the URL and session continuation', () => {
  const saved = [];
  const Button = loadModule('src/components/soft-opening/SoftOpeningSignInButton.tsx', { 'next/link': 'a' }, { React, sessionStorage: { setItem: (...args) => saved.push(args) } }).default;
  const button = Button({ children: 'Reserve', destination: '/landing/open-play' });
  assert.equal(new URL(button.props.href, 'https://example.test').searchParams.get('next'), '/landing/open-play');
  button.props.onClick();
  assert.deepEqual(saved, [['post_login_redirect', '/landing/open-play']]);
});

test('a new email account without Wanderlist history is eligible without buying membership', async () => {
  const access = loadModule('src/lib/soft-opening-access.ts', { '@/lib/waitlist': { normalizeWaitlistEmail: value => value.trim().toLowerCase() } });
  const admin = { from(table) { assert.equal(table, 'waitlist_entries'); return { select() { return this; }, eq() { return this; }, async limit() { return { data: [], error: null }; } }; } };
  const result = await access.getSoftOpeningAccessForUser(admin, { id: 'new-user', email: 'new@example.test' });
  assert.equal(result.allowed, true);
  assert.equal(result.on_wanderlist, false);
  assert.equal(result.website_signup, true);
});
