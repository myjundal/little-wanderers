import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const info = loadModule('src/lib/family-info.ts', { zod: { z }, '@/lib/birthdate': loadModule('src/lib/birthdate.ts') });
const child = { role: 'child', first_name: ' Sam ', last_name: '', gender: null, birthdate: '03/15/2022' };
function fixture({ signedIn = true, authError = null, householdId = 'new-family', lookupError = false, dbError = null, missingRow = false } = {}) {
  const inserts = [], logs = [], lookups = [];
  const admin = { from(table) {
    assert.equal(table, 'people');
    const q = {
      insert(row) { inserts.push(row); return q; },
      select() { return q; },
      async single() { return { data: dbError || missingRow ? null : { id: 'saved-child', ...inserts.at(-1) }, error: dbError }; },
    };
    return q;
  } };
  const route = loadModule('src/app/api/family/people/route.ts', {
    'next/server': { NextResponse: { json: Response.json } }, zod: { z },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'verified-user' } : null }, error: authError }) } }) },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/households': { getLatestHouseholdIdForUser: async (client, userId) => { assert.equal(client, admin); lookups.push(userId); if (lookupError) throw Error('lookup failed'); return householdId; } },
    '@/lib/family-info': info,
    '@/lib/logger': { logger: { error: context => logs.push(context) } },
  });
  return { inserts, logs, lookups, save: (body = child) => route.POST({ json: async () => body }) };
}

test('new signed-in family without a Wanderlist entry can add its first child', async () => {
  const f = fixture();
  const response = await f.save();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.person.id, 'saved-child');
  assert.equal(result.person.household_id, 'new-family');
  assert.equal(result.person.first_name, 'Sam');
  assert.equal(result.person.last_name, null);
  assert.equal(result.person.birthdate, '2022-03-15');
  assert.deepEqual(f.lookups, ['verified-user']);
  assert.equal(f.inserts.length, 1);
});

test('creation uses the verified family even when browser supplies a different household or user', async () => {
  const f = fixture();
  assert.equal((await f.save({ ...child, household_id: 'foreign-family', user_id: 'foreign-user', id: 'foreign-child', notes: 'untrusted' })).status, 200);
  assert.equal(f.inserts[0].household_id, 'new-family');
  for (const key of ['user_id', 'id', 'notes']) assert.equal(f.inserts[0][key], undefined);
});

test('optional gender and birthday remain optional for children and adults', async () => {
  for (const role of ['child', 'adult']) {
    const f = fixture();
    const response = await f.save({ ...child, role, birthdate: null });
    assert.equal(response.status, 200);
    assert.equal(f.inserts[0].role, role);
    assert.equal(f.inserts[0].birthdate, null);
    assert.equal(f.inserts[0].gender, null);
  }
});

test('anonymous, expired and unlinked logins cannot create a family member', async () => {
  for (const [options, expected] of [[{ signedIn: false }, 401], [{ authError: { message: 'expired' } }, 401], [{ householdId: null }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.save()).status, expected);
    assert.equal(f.inserts.length, 0);
  }
});

test('invalid names, roles, gender, birthday and malformed bodies fail before database access', async () => {
  for (const body of [null, {}, { ...child, first_name: ' ' }, { ...child, first_name: 'a'.repeat(81) }, { ...child, role: 'owner' }, { ...child, gender: 'unknown' }, { ...child, birthdate: '02/30/2022' }, { ...child, birthdate: '2099-01-01' }]) {
    const f = fixture();
    assert.equal((await f.save(body)).status, 400);
    assert.equal(f.inserts.length, 0);
    assert.equal(f.lookups.length, 0);
  }
});

test('database and lookup failures return retryable errors without exposing private database detail', async () => {
  for (const options of [{ dbError: { code: '42501', message: 'private diagnostic detail' } }, { missingRow: true }, { lookupError: true }]) {
    const f = fixture(options);
    const response = await f.save();
    assert.equal(response.status, 500);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.match(result.error, /entries are still here/);
    assert.doesNotMatch(JSON.stringify(result), /private diagnostic detail/);
    assert.equal(f.logs.length, 1);
  }
});

