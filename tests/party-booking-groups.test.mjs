import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const grouping = loadModule('src/lib/party-booking-groups.ts');
const now = Date.parse('2026-11-02T15:00:00Z');
const party = (id, patch = {}) => ({
  id, household_name: `${id} Family`, household_email: `${id}@example.test`, household_id: id,
  status: 'confirmed', notes: null,
  start_time: '2026-11-01T15:00:00-05:00', end_time: '2026-11-01T18:00:00-05:00',
  current_child_count: 5, current_adult_count: 12, attendance_finalized_at: null,
  final_child_count: null, final_adult_count: null, final_total_count: null,
  ...patch,
});

test('owners and admins see all bookings expanded on arrival; staff keep the attendance view', async () => {
  for (const role of ['owner', 'admin', 'staff']) {
    const Page = loadModule('src/app/staff/parties/page.tsx', {
      '@/lib/authz': { getCurrentUserRole: async () => ({ role }) },
      '@/components/staff/StaffDashboard': () => React.createElement('p', null, 'Upcoming bookings'),
      '@/components/staff/StaffToolNav': () => null,
      '@/components/staff/PartyManagement': () => React.createElement('p', null, 'Today’s parties'),
    }, { React }).default;
    const html = renderToStaticMarkup(await Page());
    assert.ok(html.includes('Today’s parties'));
    if (role === 'staff') assert.ok(!html.includes('Upcoming bookings'));
    else assert.match(html, /<details open=""[^>]*>.*Upcoming bookings/s);
  }
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
  const items = [party('today'), party('future', { start_time: '2026-11-07T10:00:00-05:00', end_time: '2026-11-07T13:00:00-05:00' }),
    party('cancellation', { start_time: '2026-11-13T15:00:00-05:00', end_time: '2026-11-13T18:00:00-05:00', notes: '[Cancellation requested at 2026-11-01]' })];
  const { default: Dashboard } = loadModule('src/components/staff/StaffDashboard.tsx', {
    react, 'next/link': 'a', '@/lib/party-booking-groups': grouping,
    '@/lib/party-config': { PARTY_TIME_ZONE: 'America/New_York' },
    '@/lib/party-management': { PARTY_SCHEDULE_UPDATED_EVENT: 'party-schedule-updated' },
    '@/components/staff/PartyScheduleEditor': () => null,
    '@/components/classes/ClassCheckIn': () => null,
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
  assert.equal(all(node => node.props.title)[0].props.title, 'Cancellation requests');
  assert.equal(group('Cancellation requests').count, 1);
  assert.equal(group('Cancellation requests').defaultOpen, true);
  assert.ok(all(node => node.props.role === 'status').some(node => JSON.stringify(node.props.children).includes('remain booked on the public calendar')));
  assert.ok(all(node => node.type === 'h3' && node.props.children === 'cancellation Family').length);
  assert.ok(all(node => node.type === 'span' && node.props.children === 'Cancellation requested').length >= 2);
  assert.equal(group('Confirmed parties').count, 2);
  assert.equal(group('Completed parties').count, 0);
  clock = Date.parse('2026-11-01T23:00:00Z'); tick(); render();
  assert.equal(group('Confirmed parties').count, 1);
  assert.equal(group('Completed parties').count, 1);
  assert.equal(group('Completed parties').defaultOpen, false);
  const completedCard = group('Completed parties').children[0];
  completedCard.props.children[0].props.onClick(); render();
  assert.ok(all(node => node.type === 'span' && node.props.children === 'Completed').length >= 2);
  assert.equal(all(node => node.type === 'button' && node.props.children === 'Cancel booking').length, 0);
  assert.equal(all(node => node.type === 'button' && node.props.children === 'Finalize attendance').length, 1);
  const expanded = group('Completed parties').children[0];
  assert.equal(expanded.props.children[0].props['aria-expanded'],true);
  assert.equal(expanded.props.children[1].props.role,'region');
  assert.equal(expanded.props.children[1].props.id,'party-details-today');
  assert.equal(all(node => node.type === 'a' && node.props.href === 'mailto:today@example.test').length,1);
  group('Confirmed parties').children[0].props.children[0].props.onClick(); render();
  assert.equal(group('Completed parties').children[0].props.children[1],false);
  assert.equal(group('Confirmed parties').children[0].props.children[1].props.id,'party-details-future');
  assert.equal(all(node => node.props.role === 'region' && node.props['aria-label'] === 'Selected party details').length,1);
});

test('public party calendar excludes cancelled bookings and uses no-store', async () => {
  const items = [party('cancelled', { status: 'cancelled', start_time: '2099-11-07T15:00:00Z' }), party('booked', { start_time: '2099-11-07T20:00:00Z' })];
  const filters = [];
  const query = {
    select() { return this; }, gt(key, value) { filters.push([key, value]); return this; },
    neq(key, value) { filters.push([key, value]); return this; },
    order: async () => ({ data: items.filter(item => item.status !== 'cancelled'), error: null }),
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

test('a cancellation request keeps its public calendar slot reserved until cancellation is approved', async () => {
  const item = party('requested', { start_time: '2099-11-13T20:00:00Z', notes: '[Cancellation requested at 2099-11-11]' });
  const query = {
    select() { return this; }, gt() { return this; },
    neq(key, value) { assert.equal(key, 'status'); assert.equal(value, 'cancelled'); return this; },
    order: async () => ({ data: [item], error: null }),
  };
  const { GET } = loadModule('src/app/api/party-bookings/calendar/route.ts', {
    '@supabase/supabase-js': { createClient: () => ({ from: () => query }) },
    '@/lib/party-config': { isVisiblePartyCalendarSlot: () => true },
  }, { process: { env: {} } });
  assert.deepEqual((await (await GET()).json()).items.map(row => row.id), ['requested']);
  assert.equal(item.status, 'confirmed');
});
