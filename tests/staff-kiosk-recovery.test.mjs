import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadSquareModules, localSquareAdmin } from './helpers/admission-pos-harness.mjs';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const user = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const oldDevice = '20000000-0000-4000-8000-000000000001';
const newDevice = '20000000-0000-4000-8000-000000000002';
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values ('${user}'), ('${other}');`);
  await db.exec(fs.readFileSync('db/migrations/20261016_staff_timeclock.sql', 'utf8'));
  await db.exec(`insert into staff_profiles(user_id,display_name,pin_hash,pin_version,failed_attempts) values
    ('${user}','Employee','hash',1,4),('${other}','Other','hash',1,0);
    insert into staff_kiosk_devices(id,name,secret_hash,failed_attempts) values
    ('${oldDevice}','Reception iPad','old-device',0),('${newDevice}','Reception iPad','new-device',1);
    insert into staff_kiosk_sessions(token_hash,user_id,device_id,pin_version) values ('old-session','${user}','${oldDevice}',1);
    insert into staff_time_entries(user_id,device_id,session_hash,clock_in) values ('${user}','${oldDevice}','old-session',now()-interval '2 hours');`);
  const admin = localSquareAdmin(db);
  const api = loadSquareModules().load('src/lib/staff-kiosk-recovery.ts');
  const resume = () => api.resumeKioskShift(admin, { userId: user, deviceId: newDevice, sessionHash: 'new-session', pinVersion: 1 });
  return { db, admin, api, resume };
}
test('PIN recovery after iPad re-registration preserves one original timecard and invalidates old access', async t => {
  const { db, admin, resume } = await fixture(t);
  const before = (await db.query('select * from staff_time_entries')).rows[0];
  const result = await resume();
  assert.equal(result.resumed, true);
  const rows = (await db.query('select * from staff_time_entries')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, before.id);
  assert.equal(rows[0].clock_in.getTime(), before.clock_in.getTime()); assert.equal(rows[0].clock_out, null);
  assert.equal(rows[0].device_id, newDevice); assert.equal(rows[0].session_hash, 'new-session');
  const sessions = (await db.query('select * from staff_kiosk_sessions order by token_hash')).rows;
  assert.equal(sessions[0].token_hash, 'new-session'); assert.equal(sessions[0].revoked_at, null);
  assert.ok(sessions[1].revoked_at); assert.equal(sessions[0].expires_at.getTime(), sessions[1].expires_at.getTime());
  assert.equal((await db.query('select failed_attempts from staff_profiles where user_id=$1', [user])).rows[0].failed_attempts, 0);
  assert.equal((await db.query('select failed_attempts from staff_kiosk_devices where id=$1', [newDevice])).rows[0].failed_attempts, 0);
  for (const [deviceToken, sessionToken, expected] of [['new-device', 'new-session', user], ['old-device', 'old-session', null]]) {
    const identity = loadSquareModules({ mocks: {
      'next/headers': { cookies: async () => ({ get: name => ({ value: name === 'lw_staff_device' ? deviceToken : sessionToken }) }) },
      '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
      '@/lib/staff-pin': { staffTokenHash: value => value },
    } }).load('src/lib/staff-kiosk.ts');
    assert.equal((await identity.getKioskIdentity())?.user_id ?? null, expected);
  }
  // A concurrent/late logout using the old session cannot clock out the recovered shift.
  await db.query("select staff_kiosk_clock_out('old-session','old-device')");
  assert.equal((await db.query('select clock_out from staff_time_entries')).rows[0].clock_out, null);
});
test('recovery cannot take a device with another employee clocked in', async t => {
  const { db, resume } = await fixture(t);
  await db.exec(`insert into staff_kiosk_sessions(token_hash,user_id,device_id,pin_version) values ('other-session','${other}','${newDevice}',1);
    insert into staff_time_entries(user_id,device_id,session_hash) values ('${other}','${newDevice}','other-session');`);
  await assert.rejects(resume(), /previous employee must clock out/);
  assert.equal((await db.query('select session_hash from staff_time_entries where user_id=$1', [user])).rows[0].session_hash, 'old-session');
  assert.ok((await db.query("select revoked_at from staff_kiosk_sessions where token_hash='new-session'")).rows[0].revoked_at);
});
test('expired shifts need owner review and do not receive a longer login', async t => {
  const { db, resume } = await fixture(t);
  await db.exec("update staff_kiosk_sessions set expires_at=now()-interval '1 minute'");
  await assert.rejects(resume(), /owner.*open timecard/);
  assert.equal((await db.query('select count(*)::int n from staff_kiosk_sessions')).rows[0].n, 1);
});
test('clock-out racing recovery never reopens or duplicates a timecard', async t => {
  const { db, admin, api } = await fixture(t);
  const originalFrom = admin.from.bind(admin);
  let updates = 0;
  admin.from = table => {
    const q = originalFrom(table);
    if (table === 'staff_time_entries') {
      const originalUpdate = q.update;
      q.update = value => {
        updates++;
        const originalThen = q.then;
        q.then = async resolve => {
          await db.exec("update staff_time_entries set clock_out=now() where session_hash='old-session'");
          return originalThen(resolve);
        };
        return originalUpdate(value);
      };
    }
    return q;
  };
  await assert.rejects(api.resumeKioskShift(admin, { userId: user, deviceId: newDevice, sessionHash: 'racing-session', pinVersion: 1 }), /shift changed/);
  assert.equal(updates, 1);
  const rows = (await db.query('select * from staff_time_entries')).rows;
  assert.equal(rows.length, 1); assert.ok(rows[0].clock_out); assert.equal(rows[0].session_hash, 'old-session');
});
test('closed shifts proceed to normal clock-in without creating a recovery session', async t => {
  const { db, resume } = await fixture(t);
  await db.exec('update staff_time_entries set clock_out=now()');
  assert.equal(await resume(), null);
  assert.equal((await db.query('select count(*)::int n from staff_kiosk_sessions')).rows[0].n, 1);
});

test('the login route verifies PIN, lockout, personal session and current role before recovery', async () => {
  for (const scenario of ['wrong-pin', 'locked', 'removed-role', 'personal', 'unpaired', 'valid']) {
    let resumes = 0, clocks = 0;
    const admin = {
      rpc: async name => {
        if (name === 'staff_kiosk_clock_in') clocks++;
        assert.equal(name, 'staff_kiosk_begin_attempt');
        return { data: scenario === 'locked' ? { ok: false } : { ok: true, pin_hash: 'hash', pin_version: 1 } };
      },
      from: table => {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: scenario === 'removed-role' ? 'user' : 'staff' } }), then: resolve => resolve({ data: [] }) };
        assert.ok(['roles', 'user_roles'].includes(table)); return q;
      },
    };
    const route = loadSquareModules({ mocks: {
      'next/server': { NextResponse: { json: body => { const r = Response.json(body); r.cookies = { set() {} }; return r; } } },
      'next/headers': { cookies: async () => ({ get: name => name === 'lw_staff_device' ? { value: 'registered-device' } : undefined }) },
      '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
      '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: scenario === 'personal' ? { id: user } : null } }) } }) },
      '@/lib/authz': { getCurrentUserRole: async () => ({ isKiosk: false }) },
      '@/lib/staff-kiosk': { sameOrigin: () => true, getKioskDevice: async () => scenario === 'unpaired' ? null : { id: newDevice }, KIOSK_DEVICE_COOKIE: 'lw_staff_device', KIOSK_SESSION_COOKIE: 'lw_staff_session', kioskCookieOptions: {} },
      '@/lib/staff-pin': { validStaffPin: () => true, verifyStaffPin: () => scenario !== 'wrong-pin', newStaffToken: () => 'token', staffTokenHash: () => 'hash' },
      '@/lib/staff-kiosk-recovery': { resumeKioskShift: async () => { resumes++; return { ok: true, resumed: true, clock_in: 'original' }; } },
    } }).load('src/app/api/staff/kiosk/route.ts');
    const response = await route.POST(new Request('https://example.test/api/staff/kiosk', { method: 'POST', body: JSON.stringify({ action: 'login', user_id: user, pin: '1234' }) }));
    const body = await response.json();
    assert.equal(resumes, scenario === 'valid' ? 1 : 0, scenario); assert.equal(clocks, 0);
    assert.equal(body.ok, scenario === 'valid', scenario);
    if (scenario === 'valid') assert.equal(body.next, '/staff/dashboard');
  }
});

test('a registered iPad returns to PIN login when staff access is lost', async () => {
  for (const paired of [true, false]) {
    const layout = loadModule('src/app/staff/layout.tsx', {
      '@/components/landing/LandingMoreMenu': {}, '@/components/staff/StaffSessionBar': {},
      '@/components/staff/StaffQuickNav': {}, '@/components/pastel/PastelShells': {},
      '@/lib/authz': { getCurrentUserRole: async () => ({ user: null }) },
      '@/lib/staff-kiosk': { getKioskDevice: async () => paired ? { id: newDevice } : null },
      'next/navigation': { redirect: path => { throw new Error(path); } },
    }).default;
    await assert.rejects(layout({ children: null }), error => error.message === (paired ? '/staff-login' : '/login'));
  }
});
