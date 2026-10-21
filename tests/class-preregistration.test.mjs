import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classPageHarness, loadModule, classConfig, fixtureChild, fixtureClass } from './helpers/class-preregistration-harness.mjs';

test('missing guardian details visibly explain why clicking Pre-register did not save', async () => {
  const page = await classPageHarness({ guardian: null });
  await page.click();
  await page.flush();
  assert.match(page.feedback(), /parent\/guardian/);
  assert.equal(page.toast.tone, 'error');
  assert.equal(page.focused, 'class-guardian-first-name');
  assert.equal(page.button().props.disabled, false);
  assert.equal(page.requests.filter(request => request.url === '/api/classes/register').length, 0);
});

test('a child without an age is directed to the age field rather than silently returning', async () => {
  const page = await classPageHarness({ children: [{ ...fixtureChild, birthdate: null }] });
  await page.click();
  await page.flush();
  assert.match(page.feedback(), /child’s age/);
  assert.equal(page.focused, 'class-child-age');
  assert.equal(page.toast.tone, 'error');
});

test('transport, server, and malformed-response failures show errors and allow retry', async () => {
  for (const register of [
    async () => { throw new Error('Network unavailable'); },
    async () => Response.json({ ok: false, error: 'Could not save right now' }, { status: 500 }),
    async () => new Response('<html>Unavailable</html>', { status: 502 }),
  ]) {
    const page = await classPageHarness({ register });
    await page.click();
    await page.flush();
    assert.ok(page.feedback());
    assert.equal(page.toast.tone, 'error');
    assert.equal(page.button().props.disabled, false);
    assert.equal(page.button().props['aria-busy'], false);
  }
});

test('successful pre-registration updates the class card immediately even if refresh fails', async () => {
  const page = await classPageHarness({ failRefresh: true });
  await page.click();
  await page.flush();
  assert.equal(page.button().props.children, 'Pre-registered');
  assert.equal(page.button().props.disabled, true);
  assert.match(page.feedback(), /first come, first served/);
  assert.match(page.feedback(), /payment is completed/);
  assert.doesNotMatch(page.feedback(), /waitlist/i);
});

test('a newly created child is immediately reflected on the successful class card', async () => {
  const page = await classPageHarness({ children: [], failRefresh: true });
  page.field('class-child-name', 'Sam Family');
  page.field('class-child-age', '3');
  await page.click();
  await page.flush();
  assert.equal(page.button().props.children, 'Pre-registered');
  assert.equal(page.toast.tone, 'success');
});

test('a failed child save unlocks the form and shows a visible error', async () => {
  const page = await classPageHarness({
    children: [], saveChild: async () => { throw new Error('Could not reach server'); },
  });
  page.field('class-child-name', 'Sam');
  page.field('class-child-age', '3');
  await page.click();
  await page.flush();
  assert.equal(page.button().props.disabled, false);
  assert.equal(page.toast.tone, 'error');
});

test('rapid clicks share one registration request and keep the Saving state until completion', async () => {
  let release;
  const page = await classPageHarness({
    register: () => new Promise(resolve => { release = resolve; }), failRefresh: true,
  });
  const first = page.click();
  await page.flush();
  assert.equal(page.button().props.children, 'Saving...');
  assert.equal(page.button().props.disabled, true);
  await page.click();
  assert.equal(page.requests.filter(request => request.url === '/api/classes/register').length, 1);
  release(Response.json({ ok: true, id: 'registration', status: 'scheduled', email: { ok: true } }));
  await first;
  await page.flush();
  assert.equal(page.button().props.children, 'Pre-registered');
});

test('confirmation email uses pre-registration and payment terms for interest and legacy statuses', async () => {
  for (const status of ['preregistered', 'scheduled', 'waitlist']) {
    let sent;
    const admin = { from(table) {
      const query = { select() { return query; }, eq() { return query; },
        maybeSingle: async () => ({ data: {
          class_registrations: { id: 'registration', class_id: 'painting', person_id: 'child', status },
          classes: { ...fixtureClass, title: 'Painting <Together>' },
          people: { ...fixtureChild, first_name: '<Sam>', household_id: 'family' },
        }[table], error: null }),
      };
      return query;
    } };
    const { sendClassRegistrationEmail } = loadModule('src/lib/class-waitlist.ts', {
      '@/lib/signup-policy': { WANDERLIST_CUTOFF: '2099-01-01' },
      '@/lib/class-config': classConfig,
      crypto: {},
      '@/lib/email-campaigns': { sendResendEmail: async input => { sent = input; return { ok: true }; } },
      '@/lib/waitlist': {},
    });
    await sendClassRegistrationEmail(admin, 'registration', 'parent@example.com');
    assert.equal(sent.subject, 'Pre-registration confirmation: Painting <Together>');
    assert.doesNotMatch(sent.html, /waitlist|next family in line|private claim/i);
    assert.match(sent.html, /first come, first served/);
    assert.match(sent.html, /payment is completed/);
    assert.match(sent.html, /does not reserve or guarantee a spot/);
    assert.match(sent.html, /&lt;Sam&gt;/);
    assert.match(sent.html, /Painting &lt;Together&gt;/);
  }
});

function registrationApi({ existing = null, klass = fixtureClass, email = async () => ({ ok: true, id: 'email' }) } = {}) {
  const inserts = [];
  const updates = [];
  const emails = [];
  const background = [];
  const warnings = [];
  const admin = { from(table) {
    let inserted = false;
    const query = {
      select() { return query; }, eq() { return query; },
      insert(row) { inserts.push(row); inserted = true; return query; },
      update(row) { updates.push(row); return query; },
      then(resolve) { resolve({ error: null }); },
      maybeSingle: async () => ({ error: null, data: {
        roles: { role: 'owner' }, people: { ...fixtureChild, role: 'child' }, classes: klass,
        class_registrations: inserted ? { id: 'registration' } : existing,
        households: { name: 'Family', email: 'parent@example.com' },
      }[table] }),
    };
    return query;
  } };
  const { POST } = loadModule('src/app/api/classes/register/route.ts', {
    '@/lib/signup-policy': { isWanderlistSignupWindow: () => true },
    '@vercel/functions': { waitUntil: task => { background.push(task); } },
    '@/lib/class-config': classConfig,
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'parent', email: 'parent@example.com' } } }) } }) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/class-waitlist': {
      isUserOnWanderlist: async () => true,
      countConfirmedClassRegistrations: async () => { throw new Error('Pre-registration must not check capacity'); },
      hasActiveWaitlistOffer: async () => { throw new Error('Pre-registration must not check seat offers'); },
      countWaitlistRegistrations: async () => { throw new Error('Pre-registration must not check queue priority'); },
      sendClassRegistrationEmail: async (...args) => { emails.push(args); return email(); },
    },
    '@/lib/admin-notifications': { sendClassRegistrationNotification: async () => ({ ok: true }) },
    '@/lib/family-profile': {
      ensureGuardianProfile: async () => {}, getPrimaryGuardianProfile: async () => null,
      parseGuardianName: () => ({ firstName: 'Parent', lastName: 'Family' }),
    },
    '@/lib/logger': { logger: { warn(message) { warnings.push(message); }, error() {} } },
  }, { process: { env: {} } });
  return { inserts, updates, emails, background, warnings, post: () => POST({ json: async () => ({ class_id: 'painting', person_id: 'child' }) }) };
}

test('pre-registration saves interest regardless of capacity, seat offers, or waitlist priority', async () => {
  for (const capacity of [0, 1, 7, null]) {
    const api = registrationApi({ klass: { ...fixtureClass, capacity } });
    const response = await api.post();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'preregistered');
    assert.equal(api.inserts[0].status, 'preregistered');
    await Promise.all(api.background);
  }
});

test('restoring cancelled interest does not reserve a seat and clears stale seat offers', async () => {
  const api = registrationApi({ existing: { id: 'existing', status: 'cancelled' } });
  const response = await api.post();
  const result = await response.json();
  assert.equal(result.restored, true);
  assert.equal(result.status, 'preregistered');
  assert.equal(api.inserts.length, 0);
  assert.equal(api.updates[0].status, 'preregistered');
  assert.equal(api.updates[0].waitlist_offer_token, null);
  await Promise.all(api.background);
});

test('retrying interest remains idempotent', async () => {
  const api = registrationApi({ existing: { id: 'existing', status: 'preregistered' } });
  const result = await (await api.post()).json();
  assert.equal(result.status, 'preregistered');
  assert.equal(result.already_registered, true);
  assert.equal(api.inserts.length, 0);
  assert.equal(api.emails.length, 0);
});

test('retrying a saved request returns the existing pre-registration without another insert or email', async () => {
  const api = registrationApi({ existing: { id: 'existing', status: 'waitlist' } });
  const response = await api.post();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.id, 'existing');
  assert.equal(result.already_registered, true);
  assert.equal(api.inserts.length, 0);
  assert.equal(api.emails.length, 0);
});

test('saving responds before email delivery while Vercel tracks the background work', async () => {
  let release;
  let completed = false;
  const api = registrationApi({ email: () => new Promise(resolve => { release = resolve; }) });
  const request = api.post().then(response => { completed = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true);
  assert.equal(api.inserts.length, 1);
  const result = await (await request).json();
  assert.equal(result.ok, true);
  assert.equal(result.email_pending, true);
  assert.equal(api.background.length, 1);
  release({ ok: true, id: 'email' });
  await Promise.all(api.background);
  assert.equal(api.emails[0][2], 'parent@example.com');
});

test('background email delivery failure is logged without losing the saved pre-registration', async () => {
  const api = registrationApi({ email: async () => { throw new Error('Email provider unavailable'); } });
  const response = await api.post();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.id, 'registration');
  assert.equal(result.email_pending, true);
  await Promise.all(api.background);
  assert.equal(api.warnings[0].action, 'class.registration_email_not_sent');
  assert.equal(api.inserts.length, 1);
});
