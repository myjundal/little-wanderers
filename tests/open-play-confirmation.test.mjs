import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const input = {
  reservationId: 'visit-id', email: 'parent@example.test', guardianName: 'Parent <Family>',
  childNames: ['Sam <Family>'], childCount: 1, adultCount: 2,
  startTime: '2026-11-11T14:00:00Z', endTime: '2026-11-11T15:00:00Z',
  amountCents: 1600, paymentStatus: 'due', paymentChoice: 'counter',
};
function harness() {
  const sent = [];
  const api = loadModule('src/lib/open-play-confirmation.ts', {
    '@/lib/private-party-open-play': { readPrivatePartyDays: async () => [], privatePartyWindow: () => ({ date: 'fixture' }) },
    '@/lib/email-campaigns': {
      validateEmail: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null,
      sendResendEmail: async mail => { sent.push(mail); return { ok: true, id: 'provider-id' }; },
    },
  }, { process: { env: { NEXT_PUBLIC_SITE_URL: 'https://www.thelittlewanderers.com/' } } });
  return { ...api, sent };
}

test('customer confirmation includes readable Eastern weekday, arrival window, names, guest counts and saved price', async () => {
  const h = harness();
  await h.sendOpenPlayConfirmation(input);
  const mail = h.sent[0];
  assert.equal(mail.to, input.email);
  assert.equal(mail.idempotencyKey, 'open-play-confirmation/visit-id');
  assert.match(mail.subject, /Wednesday, November 11, 2026/);
  for (const value of ['9:00 AM–10:00 AM (Eastern Time)', 'Parent &lt;Family&gt;', 'Sam &lt;Family&gt;', '1 child · 2 adults', '$16.00', 'Payment pending', 'not a one-hour play limit', 'not a payment receipt']) assert.ok(mail.html.includes(value), value);
  assert.match(mail.html, /https:\/\/www.thelittlewanderers.com\/landing\/waiver\?reservation=visit-id/);
  assert.match(mail.html, /https:\/\/www.thelittlewanderers.com\/landing\/soft-opening/);
  assert.doesNotMatch(mail.html, /Parent <Family>|Sam <Family>|\/staff\//);
  assert.equal(Object.hasOwn(mail, 'cc'), false);
});

test('paid, covered, mixed-family and review prices reflect the saved booking without recomputing admission', () => {
  const h = harness();
  for (const [paymentStatus, paymentChoice, amountCents, expected] of [
    ['paid', 'now', 2600, 'Paid'], ['covered', 'membership', 0, 'Included with your membership'],
    ['due', 'counter', 1600, 'Payment pending'], ['review', 'now', 1600, 'before paying again'],
  ]) {
    const { html } = h.renderOpenPlayConfirmation({ ...input, childCount: 3, paymentStatus, paymentChoice, amountCents });
    assert.ok(html.includes(expected));
    assert.ok(html.includes(`$${(amountCents / 100).toFixed(2)}`));
    assert.ok(html.includes('3 children'));
    if (paymentStatus !== 'paid') assert.doesNotMatch(html, />Paid</);
  }
});

test('Eastern formatting handles daylight saving time and never treats missing prices as free admission', () => {
  const h = harness();
  const summer = h.renderOpenPlayConfirmation({ ...input, startTime: '2027-07-04T13:00:00Z', endTime: '2027-07-04T14:00:00Z' });
  assert.match(summer.subject, /Sunday, July 4, 2027/);
  assert.match(summer.html, /9:00 AM–10:00 AM/);
  for (const amountCents of [undefined, null, -1, NaN, 0.5]) assert.throws(() => h.renderOpenPlayConfirmation({ ...input, amountCents }), /Invalid reservation amount/);
  assert.throws(() => h.renderOpenPlayConfirmation({ ...input, endTime: input.startTime }), /Invalid arrival window/);
});

test('missing customer emails do not send and retries use the same reservation key', async () => {
  const h = harness();
  assert.equal((await h.sendOpenPlayConfirmation({ ...input, email: '' })).ok, false);
  assert.equal(h.sent.length, 0);
  await h.sendOpenPlayConfirmation(input);
  await h.sendOpenPlayConfirmation(input);
  assert.deepEqual(h.sent[0], h.sent[1]);
});

test('morning delivery rechecks cancellation, future arrival, guardian and only children selected in the reservation', async () => {
  const h = harness();
  const row = { id: 'visit-id', status: 'reserved', household_id: 'family', contact_email: input.email,
    child_ids: ['chosen-child'], child_count: 1, adult_count: 2, amount_cents: 1600, payment_status: 'paid', payment_choice: 'now',
    slot: { starts_at: input.startTime, ends_at: input.endTime }, household: { name: 'Family', email: 'household@example.test' },
  };
  let peopleReads = 0;
  const filters = [];
  const admin = { from(table) {
    const q = {
      select() { return this; }, eq(...args) { filters.push([table, ...args]); return this; },
      maybeSingle: async () => ({ data: row, error: null }),
      order: async () => { peopleReads++; return { error: null, data: [
        { id: 'guardian', role: 'adult', first_name: 'Parent', last_name: 'Family' },
        { id: 'chosen-child', role: 'child', first_name: 'Sam', last_name: null },
        { id: 'other-child', role: 'child', first_name: 'Sibling', last_name: null },
      ] }; },
    }; return q;
  } };
  const loaded = await h.loadOpenPlayConfirmation(admin, row.id, new Date('2026-11-11T12:00:00Z'));
  assert.deepEqual(Array.from(loaded.childNames), ['Sam']);
  assert.equal(loaded.guardianName, 'Parent Family');
  assert.equal(loaded.email, input.email);
  assert.equal(loaded.amountCents, 1600);
  assert.equal(loaded.paymentStatus, 'paid');
  assert.ok(filters.some(([table, key, value]) => table === 'people' && key === 'household_id' && value === 'family'));
  row.status = 'cancelled';
  assert.equal(await h.loadOpenPlayConfirmation(admin, row.id, new Date('2026-11-11T12:00:00Z')), null);
  row.status = 'reserved';
  assert.equal(await h.loadOpenPlayConfirmation(admin, row.id, new Date('2026-11-11T14:00:00Z')), null);
  assert.equal(peopleReads, 1);
  row.contact_email = null;
  row.household.email = null;
  row.created_by_user_id = 'booking-user';
  admin.auth = { admin: { getUserById: async id => {
    assert.equal(id, 'booking-user');
    return { data: { user: { email: 'verified-login@example.test' } }, error: null };
  } } };
  assert.equal((await h.loadOpenPlayConfirmation(admin, row.id, new Date('2026-11-11T12:00:00Z'))).email, 'verified-login@example.test');
  admin.auth.admin.getUserById = async () => ({ data: { user: { email: null } }, error: null });
  await assert.rejects(() => h.loadOpenPlayConfirmation(admin, row.id, new Date('2026-11-11T12:00:00Z')), /contact email is unavailable/);
});

test('morning sending refuses an early run or an expired duplicate-protection window before touching the database', () => {
  for (const [notBefore, expiresAt] of [
    ['2099-11-11T12:00:00Z', '2099-11-11T23:00:00Z'],
    ['2020-11-11T12:00:00Z', '2020-11-11T23:00:00Z'],
  ]) {
    assert.throws(() => execFileSync(process.execPath, ['scripts/send-open-play-confirmations.mjs', '--send',
      '--created-before=2026-11-11T05:00:00Z', `--not-before=${notBefore}`, `--expires-at=${expiresAt}`,
    ], { encoding: 'utf8', stdio: 'pipe' }), error => /Outside the approved delivery window/.test(error.stderr));
  }
});

test('morning delivery stops when database reads cross the deadline without contacting the mail provider', () => {
  const now = Date.now();
  const deadline = now + 3600000;
  const fixture = `
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname !== 'database.example.test') throw new Error('Unexpected external request');
      if (parsed.pathname.endsWith('/people')) {
        Date.now = () => ${deadline + 1};
        return Response.json([{id:'parent',role:'adult',first_name:'Parent',last_name:'Family'}]);
      }
      if (parsed.pathname.endsWith('/party_bookings')) return Response.json([]);
      if (!parsed.searchParams.has('id')) return Response.json([{id:'visit'}]);
      return Response.json({id:'visit',status:'reserved',household_id:'family',contact_email:'parent@example.test',
        child_ids:[],child_count:1,adult_count:1,amount_cents:1600,payment_status:'due',payment_choice:'counter',
        slot:{starts_at:'2099-11-11T14:00:00Z',ends_at:'2099-11-11T15:00:00Z'},household:{name:'Family'}});
    };
  `;
  const result = execFileSync(process.execPath, [
    `--import=data:text/javascript,${encodeURIComponent(fixture)}`,
    'scripts/send-open-play-confirmations.mjs', '--send',
    `--created-before=${new Date(now).toISOString()}`, `--not-before=${new Date(now - 1000).toISOString()}`,
    `--expires-at=${new Date(deadline).toISOString()}`, '--site-url=https://www.thelittlewanderers.com',
  ], { encoding: 'utf8', env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://database.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key', RESEND_API_KEY: 'test-key' } });
  const summary = JSON.parse(result);
  assert.equal(summary.stoppedAtDeadline, true);
  assert.equal(summary.accepted, 0);
  assert.equal(summary.failed, 0);
});


test('a private-party date confirmation states the actual 4pm closing without changing the arrival window or price', () => {
  const h = harness();
  const { html } = h.renderOpenPlayConfirmation({ ...input, closingTime: '2026-11-11T21:00:00Z' });
  assert.match(html, /Open Play ends at 4:00 PM/);
  assert.match(html, /Please finish your visit by then/);
  assert.match(html, /9:00 AM–10:00 AM/);
  assert.match(html, /\$16.00/);
});
