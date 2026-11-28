import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { directoryAdmin } from './helpers/family-directory-fixture.mjs';

function fixture() {
  const households = Array.from({ length: 501 }, (_, i) => ({ id: `f${String(i).padStart(3, '0')}`, name: `Family ${i}`,
    email: `family${i}@example.test`, phone: null, city: null, state: 'CT', created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  const members = households.map((h, i) => ({ id: h.id, household_id: h.id, user_id: `u${i}` }));
  const people = Array.from({ length: 501 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, household_id: households[Math.floor(i / 2)].id,
    first_name: `Child ${i}`, last_name: 'Example', role: 'child' }));
  return { households, household_members: members, people, memberships: [], waivers: [], roles: [], user_roles: [], staff_family_search_aliases: [] };
}
function api(admin, authorized = true) {
  return loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => authorized
    ? { ok: true, admin } : { ok: false, response: Response.json({ ok: false }, { status: 401 }) } } } }).load('src/app/api/admin/families/route.ts');
}
async function get(admin, query = '') {
  const response = await api(admin).GET(new Request(`https://example.test/api/admin/families?q=${encodeURIComponent(query)}`));
  return { status: response.status, ...await response.json() };
}
test('family metrics and search read all pages, including old families beyond the former 400-row window', async () => {
  const db = directoryAdmin(fixture());
  const result = await get(db);
  assert.equal(result.total, 501); assert.equal(result.linked_families, 501); assert.equal(result.guest_families, 0);
  assert.equal(result.families_with_children, 251); assert.equal(result.matching_families, 501); assert.equal(result.items.length, 100);
  for (const table of ['households', 'household_members', 'people']) assert.ok(db.visited.some(([t, offset]) => t === table && offset === 500));
  const oldest = await get(db, 'family0@example.test');
  assert.equal(oldest.items.length, 1); assert.equal(oldest.items[0].household_id, 'f000');
  assert.equal(oldest.total, 501); assert.equal(oldest.matching_families, 1);
});
test('confirmed duplicates share one result and one metric; guest/manual and internal families use the same population', async () => {
  const data = fixture();
  const family = data.households[0];
  data.households.push({ ...family, id: 'alias', name: 'Previous Surname', email: 'previous@example.test' },
    { ...family, id: 'guest', name: 'Guest' }, { ...family, id: 'employee' }, { ...family, id: 'instructor' });
  data.staff_family_search_aliases.push({ alias_household_id: 'alias', canonical_household_id: 'f000' });
  data.household_members.push({ id: 'alias', household_id: 'alias', user_id: 'u-alias' },
    { id: 'manual', household_id: 'guest', user_id: null }, { id: 'staff', household_id: 'employee', user_id: 'staff' },
    { id: 'instructor', household_id: 'instructor', user_id: 'teacher' });
  data.people.push({ ...data.people[0], id: 'old-child', household_id: 'alias' },
    { ...data.people[0], id: 'staff-child', household_id: 'employee' }, { ...data.people[0], id: 'guest-child', household_id: 'guest' });
  data.roles.push({ id: 'staff', role: 'staff' }); data.user_roles.push({ user_id: 'teacher', role: 'instructor' });
  const db = directoryAdmin(data); const result = await get(db);
  assert.equal(result.total, 502); assert.equal(result.linked_families, 501); assert.equal(result.guest_families, 1);
  assert.equal(result.families_with_children, 252); assert.equal(result.duplicate_records_grouped, 1);
  for (const query of ['Previous Surname', 'previous@example.test']) {
    const search = await get(db, query);
    assert.equal(search.items.length, 1); assert.equal(search.items[0].household_id, 'f000');
    assert.equal(search.items[0].children_names.length, 2); assert.equal(search.total, 502);
  }
  assert.equal((await get(db, 'employee')).items.length, 0);
});
test('a login present only on a confirmed duplicate still counts its representative as linked', async () => {
  const data = fixture(); data.household_members = [{ id: 'm', household_id: 'alias', user_id: 'user' }];
  data.households.push({ ...data.households[0], id: 'alias' });
  data.staff_family_search_aliases.push({ alias_household_id: 'alias', canonical_household_id: 'f000' });
  const result = await get(directoryAdmin(data));
  assert.equal(result.total, 501); assert.equal(result.linked_families, 1); assert.equal(result.guest_families, 500);
});
test('directory read failures never return partial customer counts', async () => {
  for (const table of ['households', 'people', 'household_members', 'memberships', 'waivers', 'roles', 'user_roles', 'staff_family_search_aliases']) {
    const result = await get(directoryAdmin(fixture(), table));
    assert.equal(result.status, 503); assert.equal(result.ok, false); assert.equal(result.total, undefined);
  }
});
test('person-linked memberships from POS remain recognized on the representative family', async () => {
  const data = fixture();
  data.memberships.push({ id: 'membership', household_id: null, person_id: 'p000', renews_at: null });
  const result = await get(directoryAdmin(data), 'family0@example.test');
  assert.equal(result.items.length, 1); assert.equal(result.items[0].membership_status, 'active');
});
test('invalid duplicate links fail closed and unauthorized callers cannot read families', async () => {
  const data = fixture(); data.staff_family_search_aliases.push({ alias_household_id: 'missing', canonical_household_id: 'f000' });
  assert.equal((await get(directoryAdmin(data))).status, 503);
  const db = directoryAdmin(data);
  assert.equal((await api(db, false).GET(new Request('https://example.test/api/admin/families'))).status, 401);
  assert.equal(db.visited.length, 0);
});
