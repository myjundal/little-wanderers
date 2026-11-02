import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

function emailHarness(replies = [], env = {}) {
  const calls = [], delays = [];
  const email = loadModule('src/lib/email-campaigns.ts', {
    '@/lib/signup-policy': {}, '@/lib/waitlist': {},
  }, {
    process: { env: { RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'Studio <hello@example.com>', ...env } },
    AbortSignal, setTimeout: (fn, delay) => { delays.push(delay); fn(); },
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      const reply = replies.shift() ?? { id: 'sent' };
      if (reply instanceof Error) throw reply;
      return Response.json(reply, { status: reply.status ?? 200 });
    },
  });
  return { email, calls, delays };
}

test('party cancellation emails use owner fallback, readable Eastern details, escaped text and a management link', async () => {
  for (const env of [{}, { OWNER_EMAIL: '  owner@example.com ' }, { ADMIN_NOTIFICATION_EMAIL: 'admin@example.com' }, { OWNER_NOTIFICATION_EMAIL: 'notify@example.com' }]) {
    const transport = emailHarness();
    const api = loadModule('src/lib/admin-notifications.ts', { '@/lib/email-campaigns': transport.email }, {
      process: { env: { NEXT_PUBLIC_SITE_URL: 'https://example.com/', ...env } },
    });
    const result = await api.sendPartyCancellationNotification({
      bookingId: 'party-id', requestedAt: '2026-11-02T18:00:00Z',
      startTime: '2026-11-07T15:00:00Z', endTime: '2026-11-07T18:00:00Z',
      familyName: '<Family>', familyEmail: 'parent@example.com', headcountExpected: 12, notes: '<script>bad()</script>',
    });
    assert.equal(result.ok, true);
    const sent = transport.calls[0];
    assert.equal(sent.body.to[0], (env.OWNER_EMAIL || env.ADMIN_NOTIFICATION_EMAIL || env.OWNER_NOTIFICATION_EMAIL || 'myjundal11@gmail.com').trim());
    assert.match(sent.body.subject, /Party cancellation request/);
    assert.match(sent.body.html, /November 7, 2026, 10:00 AM-1:00 PM/);
    assert.match(sent.body.html, /parent@example.com/);
    assert.match(sent.body.html, /&lt;Family&gt;/);
    assert.doesNotMatch(sent.body.html, /<script>/);
    assert.match(sent.body.html, /https:\/\/example.com\/staff\/parties/);
    assert.match(sent.body.html, /remains reserved until owner review/);
    assert.equal(sent.headers['Idempotency-Key'], 'party-cancel-owner/party-id/2026-11-02T18:00:00Z');
  }
});

test('class owner alerts identify the family, child and cancelled class', async () => {
  const transport = emailHarness();
  const api = loadModule('src/lib/admin-notifications.ts', { '@/lib/email-campaigns': transport.email }, { process: { env: { OWNER_EMAIL: 'owner@example.com', NEXT_PUBLIC_SITE_URL: 'https://example.com' } } });
  await api.sendClassCancellationNotification({ registrationId: 'class-reg', cancelledAt: '2026-11-02T18:00:00Z', familyName: 'Family', familyEmail: 'parent@example.com', childFirstName: 'Sam', classTitle: 'Art', classStartTime: '2026-11-07T20:00:00Z', classEndTime: '2026-11-07T21:00:00Z' });
  assert.equal(transport.calls[0].body.to[0], 'owner@example.com');
  assert.equal(transport.calls[0].body.subject, 'Class cancellation: Art');
  for (const value of ['Sam', 'Family', 'parent@example.com', '3:00 PM-4:00 PM', '/staff/classes']) assert.ok(transport.calls[0].body.html.includes(value));
  assert.equal(transport.calls[0].headers['Idempotency-Key'], 'class-cancel-owner/class-reg/2026-11-02T18:00:00Z');
});

test('temporary send failures retry with identical content and key; permanent failures do not retry', async () => {
  for (const first of [new Error('network interrupted'), { status: 429, message: 'rate limited' }, { status: 503, message: 'unavailable' }, { status: 409, name: 'concurrent_idempotent_requests' }]) {
    const h = emailHarness([first, { id: 'success' }]);
    assert.equal((await h.email.sendResendEmail({ to: 'owner@example.com', subject: 'Cancellation', html: '<p>Saved</p>', idempotencyKey: 'event/1' })).ok, true);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[0].body, h.calls[1].body);
    assert.equal(h.calls[0].headers['Idempotency-Key'], h.calls[1].headers['Idempotency-Key']);
    assert.ok(h.calls[0].signal instanceof AbortSignal);
    assert.deepEqual(h.delays, [500]);
  }
  for (const status of [401, 422, 409]) {
    const h = emailHarness([{ status, message: 'invalid request' }]);
    assert.equal((await h.email.sendResendEmail({ to: 'owner@example.com', subject: 'Cancel', html: '', idempotencyKey: 'event' })).ok, false);
    assert.equal(h.calls.length, 1);
  }
  const exhausted = emailHarness(Array.from({ length: 3 }, () => ({ status: 503 })));
  assert.equal((await exhausted.email.sendResendEmail({ to: 'owner@example.com', subject: 'Cancel', html: '', idempotencyKey: 'event' })).ok, false);
  assert.equal(exhausted.calls.length, 3);
  const unkeyed = emailHarness([{ status: 503 }]);
  await unkeyed.email.sendResendEmail({ to: 'owner@example.com', subject: 'Other mail', html: '' });
  assert.equal(unkeyed.calls.length, 1);
});

function partyHarness({ status = 'confirmed', notes = null, conflict = false, denied = false, failSend = false } = {}) {
  const notifications = [], writes = [], logs = [], filters = [];
  const booking = { id: 'party', household_id: 'family', start_time: '2099-11-07T15:00:00Z', end_time: '2099-11-07T18:00:00Z', headcount_expected: 12, notes, status };
  const admin = { from(table) {
    let patch;
    const query = {
      select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, is(key, value) { filters.push([key, value]); return this; },
      update(value) { patch = value; writes.push(value); return this; },
      maybeSingle: async () => ({ error: null, data: table === 'households' ? { name: 'Family', email: 'parent@example.com' } : patch ? conflict ? null : { id: 'party' } : booking }),
    }; return query;
  } };
  const route = loadModule('src/app/api/party-bookings/request-cancel/route.ts', {
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: denied ? null : { id: 'parent', email: 'fallback@example.com' } } }) } }) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/admin-notifications': { sendPartyCancellationNotification: async input => { notifications.push(input); if (failSend) throw new Error('provider unavailable'); return { ok: true }; } },
    '@/lib/logger': { logger: { error: (...args) => logs.push(args) } },
  }, { process: { env: {} } });
  return { notifications, writes, filters, logs, post: () => route.POST({ json: async () => ({ booking_id: 'party' }) }) };
}

test('party request persists before sending an owner email and keeps the time reserved', async () => {
  const h = partyHarness();
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).email_sent, true);
  assert.match(h.writes[0].notes, /\[Cancellation requested at /);
  assert.equal(Object.hasOwn(h.writes[0], 'status'), false);
  assert.equal(h.notifications[0].familyEmail, 'parent@example.com');
  assert.equal(h.notifications[0].familyName, 'Family');
  assert.ok(h.filters.some(([key, value]) => key === 'notes' && value === null));
  assert.ok(h.filters.some(([key, value]) => key === 'status' && value === 'confirmed'));
  for (const options of [{ denied: true }, { status: 'cancelled' }, { notes: '[Cancellation requested at 2026-11-02T18:00:00Z]' }, { conflict: true }]) {
    const skipped = partyHarness(options);
    const result = await skipped.post();
    assert.equal(result.status, options.denied ? 401 : options.conflict ? 409 : 200);
    assert.equal(skipped.notifications.length, 0);
  }
});

test('an email failure never loses the saved party request or returns provider details to customers', async () => {
  const h = partyHarness({ failSend: true });
  const response = await h.post();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.email_sent, false);
  assert.equal(JSON.stringify(body).includes('provider unavailable'), false);
  assert.equal(h.logs.length, 1);
  assert.equal(h.writes.length, 1);
});

test('class owner alert is registered with waitUntil and proceeds even if customer email fails', async () => {
  const background = [], notifications = [];
  let releaseOwner, conflict = false;
  const reg = { id: 'registration', class_id: 'class', person_id: 'child', household_id: 'family', status: 'preregistered' };
  const rows = { households: { name: 'Family', email: 'parent@example.com' }, people: { first_name: 'Sam' }, classes: { title: 'Art' } };
  const admin = { from(table) {
    let updated = false;
    const query = { select() { return this; }, eq() { return this; }, update() { updated = true; return this; }, maybeSingle: async () => ({ error: null, data: table === 'class_registrations' ? updated ? conflict ? null : { id: reg.id } : reg : rows[table] }) };
    return query;
  } };
  const route = loadModule('src/app/api/classes/cancel/route.ts', {
    '@supabase/supabase-js': { createClient: () => admin }, '@vercel/functions': { waitUntil: task => background.push(task) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'parent', email: 'parent@example.com' } } }) } }) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/class-waitlist': { sendClassCancellationEmail: async () => { throw new Error('Customer email failed'); }, offerNextWaitlistSpot: async () => { throw new Error('Interest does not occupy a seat'); } },
    '@/lib/admin-notifications': { sendClassCancellationNotification: input => { notifications.push(input); return new Promise(resolve => { releaseOwner = () => resolve({ ok: true }); }); } },
    '@/lib/family-profile': { getPrimaryGuardianProfile: async () => null }, '@/lib/logger': { logger: { warn() {}, error() {} } },
  }, { process: { env: {} } });
  const response = await route.POST({ url: 'https://example.com/api/classes/cancel', json: async () => ({ registration_id: reg.id }) });
  assert.equal(response.status, 200);
  assert.equal(background.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications[0].familyName, 'Family');
  assert.equal(notifications[0].childFirstName, 'Sam');
  assert.equal(notifications[0].classTitle, 'Art');
  assert.ok(notifications[0].cancelledAt);
  releaseOwner(); await Promise.all(background);
  const post = () => route.POST({ url: 'https://example.com/api/classes/cancel', json: async () => ({ registration_id: reg.id }) });
  conflict = true;
  assert.equal((await (await post()).json()).already_cancelled, true);
  reg.status = 'cancelled';
  assert.equal((await (await post()).json()).already_cancelled, true);
  reg.household_id = 'another-family';
  assert.equal((await post()).status, 403);
  assert.equal(background.length, 1);
  assert.equal(notifications.length, 1);
});
