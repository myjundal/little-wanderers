import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const grouping = loadModule('src/lib/party-booking-groups.ts');
const now = Date.parse('2026-11-02T15:00:00Z');
const party = (id, patch = {}) => ({
  id, household_name: `${id} Family`, household_id: id,
  status: 'confirmed', notes: null,
  start_time: '2026-11-01T15:00:00-05:00', end_time: '2026-11-01T18:00:00-05:00',
  current_child_count: 5, current_adult_count: 12, attendance_finalized_at: null,
  final_child_count: null, final_adult_count: null, final_total_count: null,
  ...patch,
});

test('only ended confirmed parties move to completed, newest first, with records intact', () => {
  const items = [
    party('older', { end_time: '2026-10-31T18:00:00-04:00', attendance_finalized_at: '2026-10-31T18:01:00-04:00', final_total_count: 17 }),
    party('recent', { status: 'early_access_hold' }),
    party('upcoming', { end_time: '2026-11-07T18:00:00-05:00' }),
    party('pending', { status: 'pending' }),
    party('cancelled', { status: 'cancelled', notes: '[Cancellation requested at 2026-10-13]' }),
    party('request', { notes: '[Cancellation requested at 2026-10-13]' }),
    party('bad-date', { end_time: 'invalid' }),
  ];
  const groups = grouping.groupPartyBookings(items, now);
  assert.deepEqual(Array.from(groups.completed, x => x.id), ['recent', 'older']);
  assert.deepEqual(Array.from(groups.confirmed, x => x.id), ['upcoming', 'bad-date']);
  assert.equal(groups.requests[0].id, 'pending');
  assert.equal(groups.cancelled[0].id, 'cancelled');
  assert.equal(groups.cancellationRequests[0].id, 'request');
  assert.equal(Object.values(groups).flat().length, items.length);
  assert.equal(new Set(Object.values(groups).flat()).size, items.length);
  assert.equal(groups.completed[1], items[0]);
  assert.equal(items[0].status, 'confirmed');
  assert.equal(items[0].final_total_count, 17);
});

test('completion uses the exact end instant across Eastern daylight saving changes', () => {
  for (const end of ['2026-11-01T18:00:00-05:00', '2026-03-08T18:00:00-04:00']) {
    const item = party('boundary', { end_time: end });
    assert.equal(grouping.isCompletedParty(item, Date.parse(end) - 1), false);
    assert.equal(grouping.isCompletedParty(item, Date.parse(end)), true);
  }
  assert.equal(grouping.isCompletedParty(party('finalized-early', { attendance_finalized_at: '2026-11-01T12:00:00-05:00' }), Date.parse('2026-11-01T17:00:00-05:00')), false);
});

test('dashboard moves parties while open, labels completed details and keeps attendance editable', async () => {
  let clock = Date.parse('2026-11-01T22:59:59Z');
  class Clock extends Date { static now() { return clock; } }
  const hooks = [], effects = [];
  let cursor = 0, tree, tick;
  const memo = (read, deps) => {
    const i = cursor++;
    if (!hooks[i] || deps.some((dep, j) => !Object.is(dep, hooks[i].deps[j]))) hooks[i] = { value: read(), deps };
    return hooks[i].value;
  };
  const react = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, next => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }];
    },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => memo(() => { effects.push(fn); }, deps),
  };
  const items = [party('today'), party('future', { start_time: '2026-11-07T10:00:00-05:00', end_time: '2026-11-07T13:00:00-05:00' })];
  const { default: Dashboard } = loadModule('src/components/staff/StaffDashboard.tsx', {
    react, 'next/link': 'a', '@/lib/party-booking-groups': grouping,
    '@/components/staff/StaffFamilyRegistration': () => null,
    '@/components/waivers/PartyGuestWaivers': () => null,
    '@/components/classes/ClassPreRegistrationRosters': { __esModule: true, default: () => null, ClassViewSwitcher: () => null },
  }, {
    React: react, Date: Clock,
    window: { setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    fetch: async () => Response.json({ ok: true, items }),
  });
  const render = () => { cursor = 0; tree = Dashboard({ view: 'parties' }); effects.splice(0).forEach(fn => fn()); };
  const all = predicate => {
    const found = [];
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      if (predicate(node)) found.push(node);
      visit(node.props.children);
    };
    visit(tree); return found;
  };
  const group = title => all(node => node.props.title === title)[0].props;
  render(); await new Promise(resolve => setImmediate(resolve)); render();
  assert.equal(group('Confirmed parties').count, 2);
  assert.equal(group('Completed parties').count, 0);
  clock = Date.parse('2026-11-01T23:00:00Z'); tick(); render();
  assert.equal(group('Confirmed parties').count, 1);
  assert.equal(group('Completed parties').count, 1);
  assert.equal(group('Completed parties').defaultOpen, false);
  const completedButton = group('Completed parties').children[0];
  completedButton.props.onClick(); render();
  assert.ok(all(node => node.type === 'span' && node.props.children === 'Completed').length >= 2);
  assert.equal(all(node => node.type === 'button' && node.props.children === 'Cancel booking').length, 0);
  assert.equal(all(node => node.type === 'button' && node.props.children === 'Finalize attendance').length, 1);
});

test('public party calendar excludes cancelled bookings and uses no-store', async () => {
  const items = [party('cancelled', { status: 'cancelled', start_time: '2099-11-07T15:00:00Z' }), party('booked', { start_time: '2099-11-07T20:00:00Z' })];
  const filters = [];
  const query = {
    select() { return this; }, gte() { return this; },
    neq(key, value) { filters.push([key, value]); return this; },
    order: async () => ({ data: items.filter(item => filters.every(([key, value]) => item[key] !== value)), error: null }),
  };
  const { GET } = loadModule('src/app/api/party-bookings/calendar/route.ts', {
    '@supabase/supabase-js': { createClient: () => ({ from: () => query }) },
    '@/lib/party-config': { isVisiblePartyCalendarSlot: () => true },
  }, { process: { env: {} } });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map(item => item.id), ['booked']);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
