import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, now } from './helpers/paid-family-fixture.mjs';
const source = 'source', target = 'target';

test('staff confirmation links a paid guest family to its verified account, including originally blank child details', async () => {
  const { db, admin, before, link, modules } = fixture();
  assert.equal((await link()).status, 'linked');
  assert.equal(db.waivers[0].household_id, target);
  assert.deepEqual(db.waivers[0].covered_person_ids, ['child']);
  const snapshot = { ...db.waivers[0].agreement_snapshot }; delete snapshot.payment_family_reconciliation;
  assert.deepEqual(snapshot, before.waivers[0].agreement_snapshot);
  for (const key of ['signed_at', 'waiver_expires_at', 'electronic_signature', 'photo_consent']) assert.equal(db.waivers[0][key], before.waivers[0][key]);
  assert.equal(db.people.find(row => row.id === 'child').birthdate, '2025-06-20');
  assert.equal(db.people.find(row => row.id === 'child').last_name, 'Example');
  assert.deepEqual(db.people.filter(row => row.household_id === source), before.people.filter(row => row.household_id === source));
  assert.deepEqual(db.household_members, before.household_members);
  assert.equal(db.checkins.length, 2);
  for (const visit of db.checkins) {
    const original = before.checkins.find(row => row.id === visit.id);
    for (const key of ['price_cents', 'payment_status', 'square_order_id', 'checked_in_at', 'square_environment']) assert.equal(visit[key], original[key]);
    assert.equal(visit.household_id, target);
  }
  assert.equal(db.square_customers[0].household_id, target);
  assert.equal(db.square_customers[0].square_customer_id, 'customer');
  assert.equal(db.party_guest_waivers[0].household_id, target);
  assert.equal(db.staff_family_search_aliases[0].canonical_household_id, target);
  const paid = modules.load('src/lib/reservation-admission-status.ts').reservationAdmissionStatus({ household_id: target, child_ids: ['child'], payment_status: 'due', payment_choice: 'counter', slot: { starts_at: '2026-11-15T15:00:00Z' } }, db.checkins, 'production');
  assert.equal(paid, 'paid_counter');
  const count = admin.writes.length;
  assert.equal((await link()).status, 'linked'); assert.equal(admin.writes.length, count);
});

test('birthday conflicts, ambiguous account matches and unverified incomplete child identities require review without writes', async () => {
  for (const change of [
    f => { f.db.people[1].birthdate = '2024-01-01'; },
    f => { f.db.household_members.push({ household_id: 'other', user_id: 'parent', role: 'primary_caregiver' }); f.db.households.push({ ...f.db.households[0], id: 'other' }); f.db.people.push(...f.db.people.slice(0, 2).map(row => ({ ...row, id: row.id + '-other', household_id: 'other' }))); },
    f => { f.admin.auth.admin.getUserById = async () => ({ data: { user: { email: 'parent@example.test', email_confirmed_at: null } }, error: null }); },
  ]) {
    const f = fixture(); change(f);
    assert.equal((await f.link()).status, 'review'); assert.equal(f.admin.writes.length, 0);
  }
});

test('unpaid, pending and sandbox attendance cannot be merged by a payment confirmation', async () => {
  for (const patch of [{ payment_status: 'due' }, { payment_status: 'pending' }, { square_environment: 'sandbox' }]) {
    const f = fixture(); Object.assign(f.db.checkins[1], patch);
    assert.equal((await f.link()).status, 'review'); assert.equal(f.admin.writes.length, 0);
  }
});

test('an existing target visit, a source purchase or conflicting Square customers prevent automatic merging', async () => {
  for (const change of [
    f => { f.db.checkins.push({ ...f.db.checkins[1], id: 'other-visit', household_id: target, person_id: 'child', child_id: 'child' }); },
    f => { f.db.square_checkout_attempts.push({ household_id: source }); },
    f => { f.db.square_customers.push({ id: 'other-map', household_id: target, square_customer_id: 'other-customer' }); },
  ]) {
    const f = fixture(); change(f);
    assert.equal((await f.link()).status, 'review'); assert.equal(f.admin.writes.length, 0);
  }
});

test('the source account never moves or gains account access', async () => {
  const f = fixture(); f.db.household_members.push({ household_id: source, user_id: 'someone', role: 'primary_caregiver' });
  assert.equal((await f.link()).status, 'none'); assert.equal(f.admin.writes.length, 0);
});

for (const table of ['party_guest_waivers', 'checkins', 'square_customers', 'staff_family_search_aliases']) {
  test(`a failed ${table} write resumes from the saved journal without changing the original receipt`, async () => {
    const f = fixture(), from = f.admin.from;
    let failed = false;
    f.admin.from = name => {
      const q = from(name), update = q.update, upsert = q.upsert;
      if (name === table) {
        const fail = () => { if (!failed) { failed = true; f.admin.failNext(name); } };
        q.update = value => { fail(); return update(value); };
        q.upsert = (value, options) => { fail(); return upsert(value, options); };
      }
      return q;
    };
    await assert.rejects(f.link());
    assert.equal(f.db.staff_family_search_aliases.length, 0);
    assert.equal((await f.link(true)).status, 'linked');
    assert.equal(f.db.checkins.length, 2);
    assert.equal(f.db.checkins[1].square_order_id, 'order-paid'); assert.equal(f.db.checkins[1].price_cents, 1600);
    assert.equal(f.db.waivers[0].electronic_signature, 'D. Example');
  });
}

test('simultaneous confirmations acquire one journal lease and preserve one visit per person', async () => {
  const f = fixture();
  const outcomes = await Promise.all([f.link(), f.link()]);
  assert.ok(outcomes.some(result => result.status === 'linked'));
  assert.ok(outcomes.every(result => ['linked', 'pending'].includes(result.status)));
  assert.equal(f.db.membership_events.length, 3); assert.equal(f.db.checkins.length, 2); assert.equal(f.db.staff_family_search_aliases.length, 1);
});

test('a changed receipt on retry requires owner review and remains unchanged', async () => {
  const f = fixture(), from = f.admin.from;
  let fail = true;
  f.admin.from = table => { const q = from(table), update = q.update; if (table === 'checkins') q.update = value => { if (fail) { fail = false; f.admin.failNext(table); } return update(value); }; return q; };
  await assert.rejects(f.link());
  f.db.checkins[1].square_order_id = 'different-order';
  assert.equal((await f.link(true)).status, 'review');
  assert.equal(f.db.checkins[1].square_order_id, 'different-order'); assert.equal(f.db.staff_family_search_aliases.length, 0);
});


test('changed guest details must still agree with the original signed child snapshot', async () => {
  const f = fixture(); f.db.people[3].birthdate = '2025-06-21';
  assert.equal((await f.link()).status, 'review'); assert.equal(f.admin.writes.length, 0);
});

test('duplicate source attendance requires review before any migration starts', async () => {
  const f = fixture(); f.db.checkins.push({ ...f.db.checkins[1], id: 'duplicate-visit' });
  assert.equal((await f.link()).status, 'review'); assert.equal(f.admin.writes.length, 0);
});

test('a retry refuses account access changes rather than attaching history to new caregivers', async () => {
  const f = fixture(), from = f.admin.from; let failed = false;
  f.admin.from = table => { const q = from(table), update = q.update; if (table === 'party_guest_waivers') q.update = value => { if (!failed) { failed = true; f.admin.failNext(table); } return update(value); }; return q; };
  await assert.rejects(f.link());
  f.db.household_members[0].user_id = 'different-parent';
  assert.equal((await f.link(true)).status, 'review'); assert.equal(f.db.staff_family_search_aliases.length, 0);
});


test('large signed snapshots never become oversized REST compare-and-set filters', async () => {
  const f = fixture(), from = f.admin.from;
  f.db.waivers[0].agreement_snapshot.paragraphs = ['Signed legal text '.repeat(10000)];
  f.admin.from = table => { const q = from(table), eq = q.eq; if (table === 'membership_events') q.eq = (key, value) => { if (key === 'notes') assert.ok(value.length < 1000); return eq(key, value); }; return q; };
  assert.equal((await f.link()).status, 'linked');
  const snapshot = f.db.membership_events.find(row => row.action === 'paid_family_reconciliation_snapshot');
  const header = f.db.membership_events.find(row => row.action === 'paid_family_reconciliation');
  assert.ok(snapshot.notes.length > 100000); assert.ok(header.notes.length < 1000);
});

test('two different guests cannot concurrently migrate attendance onto the same child', async () => {
  const f = fixture();
  const other = 'other-source';
  f.db.households.push({ ...f.db.households[1], id: other });
  f.db.people.push(...f.db.people.filter(row => row.household_id === 'source').map(row => ({ ...row, id: row.id + '-other', household_id: other })));
  f.db.waivers.push({ ...structuredClone(f.db.waivers[0]), id: 'other-waiver', household_id: other, covered_person_ids: ['guest-child-other'], agreement_snapshot: { ...f.db.waivers[0].agreement_snapshot, children: [{ ...f.db.people[3], id: 'guest-child-other' }] } });
  f.db.checkins.push(...f.db.checkins.map(row => ({ ...row, id: row.id + '-other', household_id: other, person_id: row.person_id + '-other', child_id: row.child_id ? row.child_id + '-other' : null })));
  const api = f.modules.load('src/lib/paid-family-reconciliation.ts');
  const outcomes = await Promise.all([f.link(), api.reconcilePaidFamily(f.admin, other, 'staff', now)]);
  assert.equal(outcomes.filter(row => row.status === 'linked').length, 1);
  assert.ok(outcomes.some(row => ['pending', 'review'].includes(row.status)));
  assert.equal(f.db.checkins.filter(row => row.household_id === 'target').length, 2);
  assert.equal(f.db.checkins.length, 4);
});
