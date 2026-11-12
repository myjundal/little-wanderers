import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { memoryAdmin } from './helpers/family-memory-admin.mjs';
const { matchGuestFamily, reconcileGuestWaiverFamily, reconcileWalkInRegistration } = loadSquareModules().load('src/lib/guest-family-reconciliation.ts');
const source = 'source', target = 'target';
const adult = { id: 'adult', household_id: target, first_name: 'Alex', last_name: 'Example', role: 'adult' };
const child = { id: 'child', household_id: target, first_name: 'Martín ', last_name: null, birthdate: '2023-01-01', role: 'child' };
const profile = { first_name: ' Alex ', last_name: 'EXAMPLE', phone: '+18605551234', children: [{ first_name: 'Martin', last_name: 'Example', birthdate: '2023-01-01' }] };
const family = { id: target, email: null, phone: '(860) 555-1234', created_at: '2020-01-01' };
function fixture() {
  const snapshot = { email_verified: false, paragraphs: ['Original signed legal text'], children: [{ ...profile.children[0], id: 'original-child' }] };
  const db = {
    households: [family, { id: source, email: 'parent@example.test', phone: profile.phone, created_at: '2026-11-11' }],
    people: [adult, child, { ...adult, id: 'original-adult', household_id: source }, { ...profile.children[0], id: 'original-child', household_id: source, role: 'child' }],
    waivers: [{ id: 'waiver', household_id: source, source: 'guest_website', signed_by_user_id: null, email: 'parent@example.test', phone: profile.phone, covered_person_ids: ['original-child'], agreement_snapshot: snapshot }],
    household_members: [{ household_id: target, user_id: 'user', role: 'primary_caregiver' }],
    memberships: [], party_bookings: [], open_play_reservations: [], class_series_sales: [], founding_memberships: [], guest_waiver_identities: [], checkins: [], class_registrations: [],
    party_guest_waivers: [{ waiver_id: 'waiver', household_id: source }], staff_family_search_aliases: [],
  };
  return { db, snapshot: structuredClone(snapshot), admin: memoryAdmin(db, { user: { email: 'parent@example.test', email_confirmed_at: '2020-01-01' } }) };
}
test('matching requires guardian, contact and unique nonconflicting children; accents and phone punctuation normalize', () => {
  assert.deepEqual(Array.from(matchGuestFamily(profile, 'parent@example.test', family, [adult, child], [])), ['child']);
  assert.equal(matchGuestFamily({ ...profile, phone: '+18605559999' }, 'stranger@example.test', family, [adult, child], []), null);
  assert.equal(matchGuestFamily({ ...profile, first_name: 'Someone' }, 'parent@example.test', family, [adult, child], ['parent@example.test']), null);
  assert.equal(matchGuestFamily(profile, 'parent@example.test', family, [adult, { ...child, birthdate: '2024-01-01' }], ['parent@example.test']), null);
  assert.equal(matchGuestFamily(profile, 'parent@example.test', family, [adult, child, { ...child, id: 'duplicate' }], []), null);
});
test('missing birthday requires exact child name plus verified caregiver email or both contact fields', () => {
  const missing = { ...child, last_name: 'Example', birthdate: null };
  assert.equal(matchGuestFamily(profile, 'parent@example.test', family, [adult, missing], []), null);
  assert.deepEqual(Array.from(matchGuestFamily(profile, 'parent@example.test', family, [adult, missing], ['parent@example.test'])), ['child']);
});
test('reconciliation preserves original signature and people, maps only signed children and grants no account access', async () => {
  const { db, snapshot, admin } = fixture();
  const dry = await reconcileGuestWaiverFamily(admin, 'waiver', false);
  assert.equal(dry.status, 'match'); assert.equal(admin.writes.length, 0);
  assert.equal((await reconcileGuestWaiverFamily(admin, 'waiver')).status, 'linked');
  assert.equal(db.waivers[0].household_id, target); assert.deepEqual(db.waivers[0].covered_person_ids, ['child']);
  assert.deepEqual(db.waivers[0].agreement_snapshot.children, snapshot.children);
  assert.deepEqual(db.waivers[0].agreement_snapshot.paragraphs, snapshot.paragraphs);
  assert.deepEqual(db.waivers[0].agreement_snapshot.family_reconciliation.original_covered_person_ids, ['original-child']);
  assert.equal(db.people.length, 4); assert.equal(db.household_members.length, 1);
  assert.equal(db.party_guest_waivers[0].household_id, target);
  assert.equal(db.staff_family_search_aliases[0].canonical_household_id, target);
  await reconcileGuestWaiverFamily(admin, 'waiver'); assert.equal(db.staff_family_search_aliases.length, 1);
  assert.ok(admin.writes.every(write => ['waivers', 'party_guest_waivers', 'staff_family_search_aliases'].includes(write.table)));
});
test('a failed directory write can retry from its saved reconciliation audit', async () => {
  const { db, admin } = fixture(); admin.failNext('staff_family_search_aliases');
  // The initial alias read fails before writing anything.
  await assert.rejects(reconcileGuestWaiverFamily(admin, 'waiver'));
  const original = admin.from;
  let failed = false;
  admin.from = table => { const q = original(table); if (table === 'party_guest_waivers' && !failed) { failed = true; admin.failNext(table); } return q; };
  await assert.rejects(reconcileGuestWaiverFamily(admin, 'waiver'));
  assert.equal(db.waivers[0].household_id, target); assert.equal(db.staff_family_search_aliases.length, 0);
  assert.equal((await reconcileGuestWaiverFamily(admin, 'waiver')).status, 'linked');
  assert.equal(db.staff_family_search_aliases.length, 1); assert.equal(db.party_guest_waivers[0].household_id, target);
});
test('established source accounts, live visits and ambiguous targets stay separate', async () => {
  for (const table of ['household_members', 'checkins', 'class_registrations']) {
    const { db, admin } = fixture();
    db[table].push(table === 'household_members' ? { household_id: source } : { person_id: 'original-child' });
    assert.equal((await reconcileGuestWaiverFamily(admin, 'waiver')).status, 'ineligible');
    assert.equal(admin.writes.length, 0);
  }
  const { db, admin } = fixture();
  db.households.push({ ...family, id: 'other' }); db.people.push({ ...adult, household_id: 'other' }, { ...child, id: 'other-child', household_id: 'other' });
  db.household_members.push({ household_id: 'other', user_id: 'user', role: 'caregiver' });
  assert.equal((await reconcileGuestWaiverFamily(admin, 'waiver')).status, 'review'); assert.equal(admin.writes.length, 0);
});

function walkInFixture(order = 'register_first') {
  const f = fixture();
  for (const table of Object.keys(f.db)) f.db[table] = structuredClone(f.db[table]);
  Object.assign(f.db.households[0], { name: 'Example', email: null, phone: null, created_at: order === 'register_first' ? '2026-11-12T16:07:00Z' : '2026-11-12T16:09:00Z' });
  f.db.households[1].created_at = '2026-11-12T16:08:00Z';
  f.db.people[0].last_name = null;
  f.db.people[1].birthdate = null;
  f.db.household_members = f.db.people.filter(p => p.household_id === target).map(p => ({
    household_id: target, user_id: null, role: 'member', full_name: `${p.first_name} ${p.last_name ?? ''}`.trim(), member_role: p.role,
  }));
  Object.assign(f.db.waivers[0], { signed_at: '2026-11-12T16:08:00Z', parent_name: 'Alex Example' });
  return f;
}

test('same-day register intake links missing surnames/birthdays in either order, preserving evidence and visits', async () => {
  for (const order of ['register_first', 'waiver_first']) {
    const { db, admin, snapshot } = walkInFixture(order);
    db.checkins.push({ id: 'visit', person_id: 'child', checked_in_at: '2026-11-12T16:09:00Z' });
    const peopleBefore = structuredClone(db.people), membersBefore = structuredClone(db.household_members), visitsBefore = structuredClone(db.checkins);
    if (order === 'register_first') assert.equal((await reconcileGuestWaiverFamily(admin, 'waiver')).status, 'linked');
    else await reconcileWalkInRegistration(admin, target);
    assert.equal(db.waivers[0].household_id, target);
    assert.deepEqual(db.waivers[0].covered_person_ids, ['child']);
    assert.equal(db.waivers[0].agreement_snapshot.family_reconciliation.match_basis, 'same_day_staff_walkin');
    assert.deepEqual(db.waivers[0].agreement_snapshot.children, snapshot.children);
    assert.deepEqual(db.people, peopleBefore); assert.deepEqual(db.household_members, membersBefore); assert.deepEqual(db.checkins, visitsBefore);
    assert.equal((await reconcileGuestWaiverFamily(admin, 'waiver')).status, 'linked');
    assert.equal(db.staff_family_search_aliases.length, 1);
  }
});

test('walk-in fallback rejects accounts, guest-only rows, prior days, conflicting names/birthdays and incomplete rosters', async () => {
  const cases = [
    f => { f.db.household_members[0].user_id = 'user'; },
    f => { f.db.household_members = []; },
    f => { f.db.households[0].created_at = '2026-11-11T16:08:00Z'; },
    f => { f.db.households[0].name = 'Someone Else'; },
    f => { f.db.households[0].email = 'other@example.test'; },
    f => { f.db.people[0].last_name = 'Other'; },
    f => { f.db.people[1].birthdate = '2024-01-01'; },
    f => { f.db.people.push({ ...child, id: 'extra', household_id: target }); },
    f => { f.db.household_members.pop(); },
  ];
  for (const change of cases) {
    const f = walkInFixture(); change(f);
    assert.equal((await reconcileGuestWaiverFamily(f.admin, 'waiver')).status, 'review');
    assert.equal(f.admin.writes.length, 0);
  }
});

test('multiple matching staff intakes remain separate and registration never reconciles another family', async () => {
  const { db, admin } = walkInFixture('waiver_first');
  db.households.push({ ...db.households[0], id: 'other' });
  db.people.push(...db.people.filter(p => p.household_id === target).map(p => ({ ...p, id: `other-${p.id}`, household_id: 'other' })));
  db.household_members.push(...db.household_members.map(m => ({ ...m, household_id: 'other' })));
  await reconcileWalkInRegistration(admin, target);
  assert.equal(db.waivers[0].household_id, source); assert.equal(admin.writes.length, 0);
});
