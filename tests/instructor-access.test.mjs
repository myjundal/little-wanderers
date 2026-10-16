import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { if (!(name in mocks)) throw Error(`Unexpected import: ${name}`); return mocks[name]; }, Response, Date, Set });
  return exports;
}
function auth({ primary = 'user', extra = [], assigned = false, signedIn = true, assignmentError = null } = {}) {
  const filters = [];
  const admin = { from(table) {
    const query = { select() { return query; }, eq(key, value) { filters.push([table, key, value]); return query; }, maybeSingle: async () => table === 'roles' ? { data: { role: primary } } : { data: assigned ? { class_id: 'mine' } : null, error: assignmentError }, then(resolve) { resolve({ data: extra.map(role => ({ role })), error: null }); } };
    return query;
  } };
  return { filters, api: load('src/lib/authz.ts', {
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'teacher' } : null } }) } }) },
  }) };
}
test('staff plus instructor retains staff access and teaching access', async () => {
  const { api } = auth({ primary: 'staff', extra: ['instructor'] });
  const current = await api.getCurrentUserRole();
  assert.equal(current.role, 'staff');
  assert.deepEqual(Array.from(current.roles), ['staff', 'instructor']);
  assert.equal((await api.requireStaffContext()).ok, true);
  assert.equal((await api.requireTeachingContext()).ok, true);
  assert.equal((await api.requireOwnerContext()).response.status, 403);
});
test('customer plus instructor cannot use staff tools', async () => {
  const { api } = auth({ extra: ['instructor'] });
  assert.equal((await api.getCurrentUserRole()).role, 'instructor');
  assert.equal((await api.requireTeachingContext()).ok, true);
  assert.equal((await api.requireStaffContext()).response.status, 403);
});
test('ordinary customer and staff without instructor role cannot access teaching', async () => {
  for (const primary of ['user', 'staff']) assert.equal((await auth({ primary }).api.requireTeachingContext()).response.status, 403);
});
test('anonymous teaching access returns 401', async () => {
  assert.equal((await auth({ signedIn: false }).api.requireTeachingContext()).response.status, 401);
});
test('assigned instructor can mark only assigned classes', async () => {
  const { api, filters } = auth({ extra: ['instructor'], assigned: true });
  assert.equal((await api.requireClassAttendanceContext('mine')).ok, true);
  assert.ok(filters.some(([table, key, value]) => table === 'class_instructors' && key === 'class_id' && value === 'mine'));
  assert.ok(filters.some(([table, key, value]) => table === 'class_instructors' && key === 'user_id' && value === 'teacher'));
  assert.equal((await auth({ extra: ['instructor'] }).api.requireClassAttendanceContext('someone-elses')).response.status, 403);
});
test('assignment lookup errors fail closed', async () => {
  assert.equal((await auth({ extra: ['instructor'], assignmentError: { message: 'db failure' } }).api.requireClassAttendanceContext('mine')).response.status, 500);
});
test('legacy owners retain attendance access without instructor assignment', async () => {
  assert.equal((await auth({ primary: 'owner' }).api.requireClassAttendanceContext('any')).ok, true);
});
function attendance({ registrationClass = 'mine', registrationStatus = 'scheduled', classStatus = 'scheduled' } = {}) {
  let writes = 0;
  const admin = { from(table) {
    const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: table === 'classes' ? { status: classStatus } : { id: 'registration', class_id: registrationClass, status: registrationStatus } }), update() { writes++; return query; }, then(resolve) { resolve({ error: null }); } };
    return query;
  } };
  const api = load('src/app/api/admin/classes/[id]/attendance/route.ts', { '@/lib/authz': { requireClassAttendanceContext: async () => ({ ok: true, role: 'instructor', user: { id: 'teacher' }, admin }) } });
  return { writes: () => writes, run: status => api.PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ registration_id: 'registration', attendance_status: status }) }), { params: { id: 'mine' } }) };
}
test('instructor cannot modify registration from another class', async () => {
  const handler = attendance({ registrationClass: 'other' });
  assert.equal((await handler.run('attended')).status, 404);
  assert.equal(handler.writes(), 0);
});
test('instructor cannot cancel registrations or mark waitlisted/cancelled sessions', async () => {
  for (const [options, status, code] of [[{}, 'cancelled', 403], [{ registrationStatus: 'waitlist' }, 'attended', 409], [{ classStatus: 'cancelled' }, 'attended', 409]]) {
    const handler = attendance(options);
    assert.equal((await handler.run(status)).status, code);
    assert.equal(handler.writes(), 0);
  }
});
test('instructor can mark registered child present', async () => {
  const handler = attendance();
  assert.equal((await handler.run('attended')).status, 200);
  assert.equal(handler.writes(), 1);
});

test('teaching endpoint scopes every class and roster query to assignments and excludes private fields', async () => {
  const scopes = [];
  const rows = {
    class_instructors: [{ class_id: 'mine' }],
    classes: [{ id: 'mine', title: 'Music', start_time: '2026-10-01T10:00:00Z', status: 'scheduled' }],
    class_registrations: [{ id: 'reg', class_id: 'mine', person_id: 'child', status: 'scheduled', attendance_status: 'attended' }],
    people: [{ id: 'child', first_name: 'Child', last_name: 'Name', birthdate: '2021-01-01', email: 'private@example.com', household_id: 'private-household' }],
  };
  const admin = { from(table) {
    const query = { select() { return query; }, eq(key, value) { scopes.push([table, key, value]); return query; }, in(key, values) { scopes.push([table, key, Array.from(values)]); return query; }, order() { return query; }, then(resolve) { resolve({ data: rows[table], error: null }); } };
    return query;
  } };
  const api = load('src/app/api/teaching/route.ts', { '@/lib/authz': { requireTeachingContext: async () => ({ ok: true, user: { id: 'teacher' }, admin }) } });
  const response = await api.GET();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(scopes.find(row => row[0] === 'class_instructors'), ['class_instructors', 'user_id', 'teacher']);
  assert.deepEqual(scopes.find(row => row[0] === 'classes'), ['classes', 'id', ['mine']]);
  assert.deepEqual(scopes.find(row => row[0] === 'class_registrations'), ['class_registrations', 'class_id', ['mine']]);
  assert.equal(result.items[0].registrants[0].name, 'Child Name');
  assert.equal(result.items[0].registrants[0].attendance_status, 'attended');
  const serialized = JSON.stringify(result);
  for (const privateValue of ['private@example.com', 'private-household', 'birthdate', '2021-01-01']) assert.equal(serialized.includes(privateValue), false);
});
