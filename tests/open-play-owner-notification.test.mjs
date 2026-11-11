import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

test('owner email contains family, ages, Eastern arrival window and honest pending payment status', async () => {
  const messages = [];
  const api = loadModule('src/lib/admin-notifications.ts', {
    '@/lib/email-campaigns': { sendResendEmail: async input => { messages.push(input); return { ok: true }; } },
  }, { process: { env: { OWNER_EMAIL: 'owner@example.test', NEXT_PUBLIC_SITE_URL: 'https://example.test' } } });
  const input = { reservationId: 'reservation', householdId: 'family', guardianName: 'Parent <Family>', email: 'parent@example.test', children: [{ name: 'Sam <Family>', ageLabel: '3 years' }], startTime: '2026-11-11T14:00:00Z', endTime: '2026-11-11T15:00:00Z', adultCount: 1, amountCents: 1600, paymentChoice: 'now', notes: '<script>bad</script>' };
  await api.sendOpenPlayReservationNotification(input);
  const mail = messages[0];
  assert.equal(mail.to, 'hello@thelittlewanderers.com');
  assert.equal(mail.idempotencyKey, 'open-play-reservation-owner/reservation');
  assert.match(mail.html, /Parent &lt;Family&gt;/);
  assert.match(mail.html, /Sam &lt;Family&gt; · 3 years/);
  assert.match(mail.html, /November 11, 2026, 9:00 AM-10:00 AM/);
  assert.match(mail.html, /\$16.00/);
  assert.match(mail.html, /payment pending/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /view=reservations&amp;family=family/);
  await api.sendOpenPlayReservationNotification({ ...input, amountCents: 0 });
  assert.match(messages[1].html, /Covered by membership/);
});

function reservationHarness({ failInsert = false, failEmail = false, denied = false } = {}) {
  const background = [], notifications = [], logs = [], writes = [];
  const slotId = '10000000-0000-4000-8000-000000000001';
  const slot = { id: slotId, starts_at: '2099-11-11T14:00:00Z', ends_at: '2099-11-11T15:00:00Z', status: 'open', capacity_children: 5, capacity_total: null };
  const admin = { from(table) {
    let inserted = false;
    const q = { select() { return q; }, insert(row) { writes.push(row); inserted = true; return q; },
      async maybeSingle() { return { data: table === 'households' ? { phone: 'saved-contact-phone', email: 'contact@example.test' } : table === 'open_play_reservation_slots' ? slot : inserted && !failInsert ? { id: 'reservation' } : null, error: failInsert && inserted ? { code: '23514', message: 'Full' } : null }; },
    };
    for (const method of ['eq', 'gt', 'limit']) q[method] = () => q;
    return q;
  } };
  const api = loadModule('src/app/api/open-play-reservations/route.ts', {
    '@vercel/functions': { waitUntil: promise => background.push(promise) },
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: denied ? null : { id: 'parent', email: 'parent@example.test', phone: 'auth-login-phone' } } }) } }) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/open-play-reservations': { SOFT_OPENING_START: '2099-11-11', SOFT_OPENING_END: '2100-01-01', isUuid: value => value === slotId, sanitizeReservationCount: value => value, getReservationOccupancy: async () => ({ children: 0, total: 0 }), formatOpenPlayReservationError: value => value, isMissingOpenPlayReservationTable: () => false },
    '@/lib/soft-opening-family': { saveSoftOpeningFamily: async () => ({ childIds: ['child'], memberships: [], guardianName: 'Parent Family', children: [{ name: 'Sam', ageLabel: '3 years' }] }) },
    '@/lib/soft-opening-pricing': { softOpeningAmount: () => 1600 },
    '@/lib/soft-opening-access': { getSoftOpeningAccessForUser: async () => ({ allowed: true }) },
    '@/lib/admin-notifications': { sendOpenPlayReservationNotification: async input => { notifications.push(input); if (failEmail === 'throw') throw new Error('Mail down'); return { ok: !failEmail }; } },
    '@/lib/logger': { logger: { error: value => logs.push(value) } },
  });
  return { background, notifications, logs, writes, post: () => api.POST({ json: async () => ({ slot_id: slotId, children: [{ name: 'Sam' }], adult_count: 1, payment_choice: 'now' }) }) };
}

test('only successful authenticated reservations schedule owner mail; provider failure never fails the saved booking', async () => {
  for (const failEmail of [false, true, 'throw']) {
    const h = reservationHarness({ failEmail });
    const response = await h.post();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).waiver_url, '/landing/waiver?reservation=reservation');
    await Promise.all(h.background);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].paymentChoice, 'now');
    assert.equal(h.notifications[0].guardianName, 'Parent Family');
    assert.equal(h.notifications[0].phone, 'saved-contact-phone');
    assert.equal(h.notifications[0].email, 'contact@example.test');
    assert.equal(h.notifications[0].children[0].name, 'Sam');
    assert.equal(h.logs.length, failEmail ? 1 : 0);
  }
  for (const options of [{ failInsert: true }, { denied: true }]) {
    const h = reservationHarness(options);
    assert.ok((await h.post()).status >= 400);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.background.length, 0);
  }
});
