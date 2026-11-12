import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const config = loadModule('src/lib/party-config.ts');
const management = loadModule('src/lib/party-management.ts', { '@/lib/party-config': config });
const id = '2af2cb2b-db0b-4d28-bfa2-fb23d50c00bc';

test('today uses Eastern midnight boundaries, including both daylight saving transitions', () => {
  for (const [now, date, start, end] of [
    ['2026-11-01T03:00:00Z', '2026-10-31', '2026-10-31T04:00:00.000Z', '2026-11-01T04:00:00.000Z'],
    ['2026-11-01T18:00:00Z', '2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['2026-03-08T18:00:00Z', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
  ]) assert.deepEqual({ ...management.getTodayPartyRange(new Date(now)) }, { date, start, end });
});

test('staff and owner tool navigation contains the current operational destinations', () => {
  const Nav = loadModule('src/components/staff/StaffToolNav.tsx', {
    'next/link': 'a',
    '@/lib/operator-navigation': loadModule('src/lib/operator-navigation.ts'),
    './operator-navigation.module.css': {},
  }, { React }).default;
  const html = renderToStaticMarkup(React.createElement(Nav));
  assert.deepEqual([...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map(match => [match[1], match[2]]), [
    ['/', 'Main homepage'], ['/staff/dashboard', 'My dashboard'],
    ['/staff/admin', 'Timecard &amp; admin'], ['/staff/checkin', 'Check-in &amp; occupancy management'],
    ['/staff/open-play-reservations', 'Open Play reservations'],
    ['/staff/parties', 'Party management'], ['/staff/families', 'Family management'], ['/staff/classes', 'Class management'],
  ]);
});

test('party page admits staff as well as owners/admins and rejects other roles', async () => {
  for (const role of ['staff', 'owner', 'admin', 'user', 'instructor', null]) {
    const Layout = loadModule('src/app/staff/parties/layout.tsx', {
      'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
      '@/lib/authz': { getCurrentUserRole: async () => ({ role }), isStaffRole: value => ['staff', 'owner', 'admin'].includes(value) },
    }, { React }).default;
    if (['staff', 'owner', 'admin'].includes(role)) assert.equal((await Layout({ children: 'party' })).props.children, 'party');
    else await assert.rejects(Layout({ children: 'party' }), /redirect:\/staff/);
  }
});

function apiHarness({ booking = { id, current_child_count: 4, current_adult_count: 3, attendance_finalized_at: null }, conflict = false, denied = false } = {}) {
  const filters = [];
  let payload;
  let guardCalls = 0;
  const query = {
    select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
    is(key, value) { filters.push([key, value]); return this; },
    update(value) { payload = value; return this; },
    maybeSingle: async () => ({ data: payload ? (conflict ? null : { ...booking, ...payload }) : booking, error: null }),
  };
  const route = loadModule('src/app/api/admin/party-bookings/[id]/headcount/route.ts', {
    '@/lib/authz': { requireStaffContext: async () => {
      guardCalls++;
      return denied ? { ok: false, response: Response.json({ ok: false }, { status: 403 }) } : { ok: true, user: { id: 'operator' }, admin: { from: () => query } };
    } },
    '@/lib/open-play-reservations': { isUuid: value => value === id },
    '@/lib/party-management': management,
  });
  return { filters, get payload() { return payload; }, get guardCalls() { return guardCalls; }, patch: async (action, extra = {}) => route.PATCH(new Request('https://example.test/api', { method: 'PATCH', body: JSON.stringify({ action, ...extra }) }), { params: Promise.resolve({ id }) }) };
}

test('staff attendance updates return saved counts and compare counts/finalization before writing', async () => {
  const h = apiHarness();
  const response = await h.patch('increment_child');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.current_child_count, 5);
  assert.equal(h.guardCalls, 1);
  assert.ok(h.filters.some(([key, value]) => key === 'current_child_count' && value === 4));
  assert.ok(h.filters.some(([key, value]) => key === 'current_adult_count' && value === 3));
  assert.ok(h.filters.some(([key, value]) => key === 'attendance_finalized_at' && value === null));
  assert.equal((await apiHarness({ conflict: true }).patch('increment_adult')).status, 409);
  assert.equal((await apiHarness({ denied: true }).patch('increment_child')).status, 403);
});

test('attendance cannot go below zero or change after finalization until explicitly reopened', async () => {
  const empty = apiHarness({ booking: { id, current_child_count: 0, current_adult_count: 0, attendance_finalized_at: null } });
  await empty.patch('decrement_child');
  assert.equal(empty.payload.current_child_count, 0);
  const finalized = apiHarness({ booking: { id, current_child_count: 4, current_adult_count: 3, attendance_finalized_at: '2026-11-01T18:00:00Z' } });
  assert.equal((await finalized.patch('increment_child')).status, 409);
  assert.equal(finalized.payload, undefined);
  assert.equal((await finalized.patch('reopen')).status, 200);
  assert.equal(finalized.payload.attendance_finalized_at, null);
  const current = apiHarness();
  await current.patch('finalize');
  assert.equal(current.payload.final_total_count, 7);
  assert.equal(current.payload.attendance_recorded_by, 'operator');
  assert.equal(Object.hasOwn(current.payload, 'attendance_notes'), false);
  assert.equal((await apiHarness().patch(undefined)).status, 400);
});

test('today API filters by local day and confirmed status before returning bookings', async () => {
  const calls = [];
  const query = {
    select: () => query, order: () => query,
    gte: (...args) => { calls.push(['gte', ...args]); return query; },
    lt: (...args) => { calls.push(['lt', ...args]); return query; },
    in: (...args) => { calls.push(['in', ...args]); return query; },
    then: resolve => resolve({ data: [], error: null }),
  };
  const { GET } = loadModule('src/app/api/admin/party-bookings/route.ts', {
    '@/lib/authz': { requireStaffContext: async () => ({ ok: true, admin: { from: () => query } }) },
    '@/lib/party-management': { getTodayPartyRange: () => ({ date: '2026-11-01', start: 'start', end: 'end' }) },
  });
  const response = await GET(new Request('https://example.test/api?today=1'));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['gte', 'start_time', 'start'], ['lt', 'start_time', 'end'], ['in', 'status', ['confirmed', 'early_access_hold']]]);
  assert.equal((await response.json()).date, '2026-11-01');
  calls.length = 0;
  await GET(new Request('https://example.test/api'));
  assert.deepEqual(calls, []);
});

test('party management includes the host parent email only after staff authorization', async () => {
  const lookups = [];
  let allowed = false;
  const admin = { from(table) {
    const query = { select(columns) { lookups.push([table,columns]); return query; }, order() { return query; },
      in(column,values) { lookups.push([column,...values]); return query; },
      then(resolve) { resolve({data:table==='party_bookings'?[{id,household_id:'host-family',status:'confirmed'}]:[{id:'host-family',name:'Host Family',email:'parent@example.test'}],error:null}); },
    }; return query;
  } };
  const api = loadModule('src/app/api/admin/party-bookings/route.ts',{
    '@/lib/authz':{requireStaffContext:async()=>allowed?{ok:true,admin}:{ok:false,response:Response.json({ok:false},{status:403})}},
    '@/lib/party-management':management,
  });
  assert.equal((await api.GET(new Request('https://example.test/api'))).status,403);
  assert.equal(lookups.length,0);
  allowed=true;
  const result=await (await api.GET(new Request('https://example.test/api'))).json();
  assert.equal(result.items[0].household_email,'parent@example.test');
  assert.equal(result.items[0].household_name,'Host Family');
  assert.ok(lookups.some(([column,value])=>column==='id'&&value==='host-family'));
});
