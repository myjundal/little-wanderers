import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const dates = loadModule('src/lib/birthdate.ts');
const info = loadModule('src/lib/family-info.ts', { zod: { z }, '@/lib/birthdate': dates });
const roles = loadModule('src/lib/family-roles.ts');
const original = { id: 'child', household_id: 'family', role: 'child', first_name: 'Old', last_name: 'Name', gender: 'male', birthdate: '2022-01-01' };
const edited = { first_name: ' New ', last_name: ' Family ', gender: 'female', birthdate: '03/15/2023' };

function fixture({ signedIn = true, householdId = 'family', role = 'primary_caregiver', fail = false, missing = false } = {}) {
  const people = [structuredClone(original), { ...original, id: 'foreign-child', household_id: 'other' }];
  const household = { id: 'family', phone: '+18605550001', city: 'Old City', state: 'CT' };
  const updates = [];
  const admin = { from(table) {
    const filters = [];
    let patch;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      update(value) { patch = value; return query; },
      async maybeSingle() {
        if (table === 'household_members') return { data: { role }, error: null };
        const rows = table === 'people' ? people : [household];
        const found = rows.find(row => filters.every(([key, value]) => row[key] === value));
        if (fail) return { data: null, error: { message: 'database unavailable' } };
        if (missing || !found) return { data: null, error: null };
        if (patch) { Object.assign(found, patch); updates.push({ table, filters, patch }); }
        return { data: structuredClone(found), error: null };
      },
    };
    return query;
  } };
  const deps = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'user' } : null } }) } }) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/households': { getLatestHouseholdIdForUser: async () => householdId },
    '@/lib/family-info': info,
    '@/lib/family-roles': roles,
    '@/lib/family-profile': {},
  };
  const person = loadModule('src/app/api/family/people/[id]/route.ts', deps);
  const profile = loadModule('src/app/api/family/profile/route.ts', deps);
  return {
    people, household, updates,
    savePerson: (body = edited, id = 'child') => person.PATCH({ json: async () => body }, { params: Promise.resolve({ id }) }),
    saveContact: body => profile.PATCH({ json: async () => body }),
  };
}

test('family member saves persist name, gender and exact birthday and return the saved row', async () => {
  const f = fixture();
  const response = await f.savePerson({ ...edited, household_id: 'other', role: 'adult' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.person, { ...original, first_name: 'New', last_name: 'Family', gender: 'female', birthdate: '2023-03-15' });
  assert.deepEqual(f.people[0], result.person);
  assert.deepEqual(f.people[1], { ...original, id: 'foreign-child', household_id: 'other' });
  assert.equal(f.updates[0].patch.household_id, undefined);
  assert.equal(f.updates[0].patch.role, undefined);
});

test('optional member fields can be cleared without restoring previous data', async () => {
  const f = fixture();
  const response = await f.savePerson({ first_name: 'Child', last_name: '', gender: null, birthdate: null });
  assert.equal(response.status, 200);
  assert.equal(f.people[0].last_name, null);
  assert.equal(f.people[0].birthdate, null);
  assert.equal(f.people[0].gender, null);
});

test('unauthenticated, unlinked and other-family edits cannot change a person', async () => {
  for (const [options, id, status] of [[{ signedIn: false }, 'child', 401], [{ householdId: null }, 'child', 403], [{}, 'foreign-child', 404]]) {
    const f = fixture(options);
    assert.equal((await f.savePerson(edited, id)).status, status);
    assert.equal(f.updates.length, 0);
  }
});

test('missing rows and database failures never report a successful member save', async () => {
  for (const [options, status] of [[{ missing: true }, 404], [{ fail: true }, 500]]) {
    const f = fixture(options);
    const response = await f.savePerson();
    assert.equal(response.status, status);
    assert.equal((await response.json()).ok, false);
    assert.equal(f.updates.length, 0);
  }
});

test('invalid birthdays, missing names and malformed input fail before updating', async () => {
  for (const body of [null, { ...edited, first_name: '  ' }, { ...edited, birthdate: '02/30/2023' }, { ...edited, birthdate: '2099-01-01' }, { ...edited, gender: 'invalid' }]) {
    const f = fixture();
    assert.equal((await f.savePerson(body)).status, 400);
    assert.equal(f.updates.length, 0);
  }
});

test('family caregivers save phone, city and state and can clear saved contact fields', async () => {
  const f = fixture({ role: 'caregiver' });
  let response = await f.saveContact({ phone: '+18605550002', city: ' New City ', state: 'MA', id: 'other' });
  assert.equal(response.status, 200);
  assert.deepEqual(f.household, (await response.json()).household);
  assert.deepEqual(f.household, { id: 'family', phone: '+18605550002', city: 'New City', state: 'MA' });
  response = await f.saveContact({ phone: null, city: '', state: 'CT' });
  assert.equal(response.status, 200);
  assert.equal(f.household.phone, null);
  assert.equal(f.household.city, null);
});

test('contact updates preserve caregiver permissions and reject invalid phone numbers', async () => {
  const body = { phone: '+18605550002', city: 'City', state: 'CT' };
  for (const [options, payload, status] of [[{ signedIn: false }, body, 401], [{ householdId: null }, body, 403], [{ role: 'member' }, body, 403], [{}, { ...body, phone: '123' }, 400], [{ missing: true }, body, 404], [{ fail: true }, body, 500]]) {
    const f = fixture(options);
    assert.equal((await f.saveContact(payload)).status, status);
    assert.equal(f.updates.length, 0);
  }
});
