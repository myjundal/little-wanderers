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

test('confirmation email uses pre-registration and payment terms for both stored statuses', async () => {
  for (const status of ['scheduled', 'waitlist']) {
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

function registrationApi({ existing = null, email = async () => ({ ok: true, id: 'email' }) } = {}) {
  const inserts = [];
  const emails = [];
  const admin = { from(table) {
    let inserted = false;
    const query = {
      select() { return query; }, eq() { return query; },
      insert(row) { inserts.push(row); inserted = true; return query; },
      update() { return query; },
      then(resolve) { resolve({ error: null }); },
      maybeSingle: async () => ({ error: null, data: {
        roles: { role: 'owner' }, people: { ...fixtureChild, role: 'child' }, classes: fixtureClass,
        class_registrations: inserted ? { id: 'registration' } : existing,
        households: { name: 'Family', email: 'parent@example.com' },
      }[table] }),
    };
    return query;
  } };
  const { POST } = loadModule('src/app/api/classes/register/route.ts', {
    '@/lib/signup-policy': { isWanderlistSignupWindow: () => true },
    '@/lib/class-config': classConfig,
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'parent', email: 'parent@example.com' } } }) } }) },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => 'family' },
    '@/lib/class-waitlist': {
      isUserOnWanderlist: async () => true,
      countConfirmedClassRegistrations: async () => 7,
      hasActiveWaitlistOffer: async () => false,
      countWaitlistRegistrations: async () => 2,
      sendClassRegistrationEmail: async (...args) => { emails.push(args); return email(); },
    },
    '@/lib/admin-notifications': { sendClassRegistrationNotification: async () => ({ ok: true }) },
    '@/lib/family-profile': {
      ensureGuardianProfile: async () => {}, getPrimaryGuardianProfile: async () => null,
      parseGuardianName: () => ({ firstName: 'Parent', lastName: 'Family' }),
    },
    '@/lib/logger': { logger: { warn() {}, error() {} } },
  }, { process: { env: {} } });
  return { inserts, emails, post: () => POST({ json: async () => ({ class_id: 'painting', person_id: 'child' }) }) };
}

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

test('the request stays alive until its confirmation email finishes', async () => {
  let release;
  let completed = false;
  const api = registrationApi({ email: () => new Promise(resolve => { release = resolve; }) });
  const request = api.post().then(response => { completed = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(api.inserts.length, 1);
  release({ ok: true, id: 'email' });
  const result = await (await request).json();
  assert.equal(result.ok, true);
  assert.equal(result.email.ok, true);
  assert.equal(api.emails[0][2], 'parent@example.com');
});

test('email delivery failure reports a warning without losing the saved pre-registration', async () => {
  const api = registrationApi({ email: async () => { throw new Error('Email provider unavailable'); } });
  const response = await api.post();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.id, 'registration');
  assert.equal(result.email.ok, false);
  assert.equal(api.inserts.length, 1);
});
