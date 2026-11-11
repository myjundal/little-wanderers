import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

const family = { id: '10000000-0000-4000-8000-000000000001', name: 'Older Family', email: 'parent@example.test', phone: '5551234567' };
const people = [{ id: 'child', household_id: family.id, first_name: 'Sam', last_name: 'Family', role: 'child' }, { id: 'parent', household_id: family.id, first_name: 'Alex', last_name: 'Family', role: 'adult' }];
const deskFamily = { ...family, people, waiver_status: 'completed', reservations: [] };
const booking = { id: 'booking', household_id: family.id, status: 'reserved', child_count: 1, adult_count: 1, slot: [{ label: 'Open Play', starts_at: '2026-10-29T14:00:00Z', ends_at: '2026-10-29T16:00:00Z' }] };

function apiHarness({ allowed = true, failTable = '', many = false, aliases = [], householdRows = [family], peopleRows = people, reservationRows = [booking], arrivalRows = [] } = {}) {
  const calls = [];
  const admin = { from(table) {
    const filters = [];
    let fields;
    const q = {
      select(value) { fields = value; return q; },
      then(resolve) {
        calls.push({ table, fields, filters });
        let data = table === 'staff_family_search_aliases' ? aliases : table === 'households' ? householdRows : table === 'people' ? peopleRows : table === 'checkins' ? arrivalRows : table === 'waivers' ? [] : reservationRows;
        for (const [op, key, values] of filters) if (op === 'in') data = data.filter(row => values.includes(row[key]));
        for (const [op, key, value] of filters) if (op === 'neq') data = data.filter(row => row[key] !== value);
        if (many && table === 'households' && fields === 'id') data = Array.from({ length: 101 }, () => family);
        resolve({ data, error: table === failTable ? { message: 'Database offline' } : table === 'checkins' && fields.includes('people') ? { code: 'PGRST201', message: 'Ambiguous people relationships: person_id and child_id' } : null });
      },
    };
    for (const method of ['eq', 'neq', 'gte', 'lt', 'or', 'order', 'in', 'limit']) q[method] = (...args) => { filters.push([method, ...args]); return q; };
    return q;
  } };
  const modules = loadSquareModules({ mocks: { '@/lib/authz': { requireStaffContext: async () => allowed ? { ok: true, admin } : { ok: false, response: Response.json({ ok: false }, { status: 403 }) } } } });
  const api = modules.load('src/app/api/admin/admission/desk/route.ts');
  return { calls, get: query => api.GET(new Request(`https://example.test/api/admin/admission/desk${query || ''}`)) };
}

test('desk authenticates staff before any family lookup', async () => {
  const h = apiHarness({ allowed: false });
  assert.equal((await h.get('?q=Sam')).status, 403);
  assert.equal(h.calls.length, 0);
});

test('today list uses Eastern midnight boundaries, excludes cancelled bookings and normalizes joined slots', async () => {
  const h = apiHarness();
  const data = await (await h.get()).json();
  const query = h.calls.find(call => call.table === 'open_play_reservations');
  assert.ok(query.filters.some(([op, key, value]) => op === 'neq' && key === 'status' && value === 'cancelled'));
  const start = query.filters.find(([op]) => op === 'gte')[2];
  const end = query.filters.find(([op]) => op === 'lt')[2];
  assert.equal(new Date(start).toLocaleTimeString('en-US', { timeZone: 'America/New_York' }), '12:00:00 AM');
  assert.equal(new Date(end).toLocaleTimeString('en-US', { timeZone: 'America/New_York' }), '12:00:00 AM');
  const tomorrow = new Date(Date.parse(`${data.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  assert.equal(new Date(end).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), tomorrow);
  assert.equal(data.items[0].reservations[0].slot.label, 'Open Play');
  assert.equal(data.items[0].people.length, 2);
});

test('today list also includes walk-in families without a reservation and a search keeps them in the same results', async () => {
  const h = apiHarness({ reservationRows: [], arrivalRows: [{ person_id: 'child' }] });
  assert.equal((await (await h.get()).json()).items[0].id, family.id);
  assert.equal((await (await h.get('?q=Sam')).json()).items[0].id, family.id);
  assert.equal((await (await h.get()).json()).items[0].reservations.length, 0);
  assert.equal(h.calls.find(call => call.table === 'checkins').fields, 'person_id');
  assert.ok(h.calls.some(call => call.table === 'people' && call.filters.some(([op, key, ids]) => op === 'in' && key === 'id' && ids.includes('child'))));
});

test('empty signup placeholders sharing a populated family contact do not duplicate search cards, and remain directly accessible', async () => {
  const placeholder = { ...family, id: '10000000-0000-4000-8000-000000000002', name: 'My Household' };
  const h = apiHarness({ householdRows: [family, placeholder] });
  assert.equal((await (await h.get('?q=parent@example.test')).json()).items.length, 1);
  assert.equal((await (await h.get(`?family=${placeholder.id}`)).json()).items[0].id, placeholder.id);
  const populated = apiHarness({ householdRows: [family, placeholder], peopleRows: [...people, { ...people[1], household_id: placeholder.id }] });
  assert.equal((await (await populated.get('?q=parent@example.test')).json()).items.length, 2);
});

test('search looks up people in database, supports full child/parent names, and does not restrict to recent families', async () => {
  const h = apiHarness();
  assert.equal((await (await h.get('?q=Sam%20Family')).json()).items[0].id, family.id);
  const search = h.calls.find(call => call.table === 'people' && call.fields === 'household_id');
  assert.ok(search.filters.some(([op, value]) => op === 'or' && value.includes('first_name.ilike.*sam*')));
  assert.ok(!search.filters.some(([op]) => op === 'gte'));
  assert.equal((await (await h.get('?q=nonexistent')).json()).items.length, 0);
  assert.equal((await (await apiHarness({ many: true }).get('?q=Sam')).json()).truncated, true);
});

test('desk rejects invalid family ids, strips filter operators, and reports failed reads', async () => {
  const h = apiHarness();
  assert.equal((await h.get('?family=not-a-uuid')).status, 400);
  assert.equal(h.calls.length, 0);
  await h.get('?q=Sam%2Cname.eq.hacked%25*');
  const search = h.calls.find(call => call.table === 'people' && call.fields === 'household_id');
  assert.equal(search.filters.find(([op]) => op === 'or')[1], 'first_name.ilike.*sam*,last_name.ilike.*sam*');
  assert.equal((await apiHarness({ failTable: 'waivers' }).get(`?family=${family.id}`)).status, 503);
});

test('surname search attaches dated bookings only to the booked family, across dates and excluding cancellations', async () => {
  const alondra = { ...family, name: 'Alondra Gardner' };
  const other = { ...family, id: '10000000-0000-4000-8000-000000000002', name: 'Other Gardner' };
  const future = { ...booking, id: 'future', slot: { label: 'Open Play', starts_at: '2026-11-12T00:30:00Z', ends_at: '2026-11-12T02:00:00Z' } };
  const h = apiHarness({ householdRows: [alondra, other], peopleRows: [], reservationRows: [future, { ...booking, id: 'cancelled', household_id: other.id, status: 'cancelled' }, booking] });
  const data = await (await h.get('?q=Gardner')).json();
  assert.equal(data.items.length, 2);
  assert.deepEqual(data.items.find(item => item.id === family.id).reservations.map(row => row.id), ['booking', 'future']);
  assert.deepEqual(data.items.find(item => item.id === other.id).reservations, []);
  const query = h.calls.find(call => call.table === 'open_play_reservations');
  assert.ok(query.filters.some(([op, key, value]) => op === 'neq' && key === 'status' && value === 'cancelled'));
  assert.ok(!query.filters.some(([op]) => op === 'gte' || op === 'lt'));
  assert.equal(data.items[0].reservations[0].slot.starts_at, booking.slot[0].starts_at);
});

test('search and direct family lookup include confirmed alternate-profile bookings once and surface read failures', async () => {
  const alternate = { ...family, id: '10000000-0000-4000-8000-000000000002' };
  const options = { householdRows: [family, alternate], aliases: [{ alias_household_id: alternate.id, canonical_household_id: family.id }], reservationRows: [{ ...booking, household_id: alternate.id }] };
  for (const query of ['?q=Family', `?family=${alternate.id}`]) {
    const data = await (await apiHarness(options).get(query)).json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].id, family.id);
    assert.equal(data.items[0].reservations.length, 1);
  }
  assert.equal((await apiHarness({ failTable: 'open_play_reservations' }).get('?q=Family')).status, 503);
  assert.equal((await apiHarness({ reservationRows: Array.from({ length: 501 }, () => booking) }).get('?q=Family')).status, 503);
});

function uiHarness({ waiver = 'completed', failPerson = '', failRefresh = false, pending = false, squareEnabled = true, checkinCode = '', covered = false, initialSearch = '', role = 'owner', verifyFailure = false, deskItems, failCheckout = false, syncStatus = 'pending', prepaid = false, homeScreen = false } = {}) {
  const hooks = [], effects = [], requests = [], navigations = [], listeners = {};
  let cursor = 0, tree, visits = [], timers = [], refreshes = 0, saleOpen = false, holdRead = false;
  const storage = new Map(), intervals = [], heldReads = [];
  const memo = (factory, deps) => {
    const i = cursor++;
    if (!hooks[i] || !deps || deps.some((value, n) => !Object.is(value, hooks[i].deps?.[n]))) hooks[i] = { value: factory(), deps };
    return hooks[i].value;
  };
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useRef: value => memo(() => ({ current: value }), []),
    useEffect: (fn, deps) => memo(() => { effects.push(fn); }, deps),
  };
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body });
    if (url.includes('/desk')) return Response.json({ ok: true, items: deskItems ?? [{ ...deskFamily, waiver_status: waiver }] });
    if (url === '/api/admin/admission/checkout') {
      if (failCheckout) return Response.json({ ok: false, error: 'Unable to record checkout' }, { status: 409 });
      const checkouts = body.checkin_ids.map(id => ({ id, checked_out_at: '2026-11-11T17:00:00Z' }));
      visits = visits.map(visit => checkouts.some(row => row.id === visit.id) ? { ...visit, checked_out_at: checkouts.find(row => row.id === visit.id).checked_out_at } : visit);
      return Response.json({ ok: true, checkouts });
    }
    if (url === '/api/checkin') {
      if (checkinCode) return Response.json({ ok: false, code: checkinCode, error: 'The family waiver must be renewed.' }, { status: 409 });
      if (body.person_id === failPerson) return Response.json({ ok: false, error: 'Birthday required' }, { status: 409 });
      visits.push({ id: `visit-${body.person_id}`, person_id: body.person_id, household_id: family.id, household_name: family.name, name: body.person_id, checked_in_at: '2026-11-11T15:00:00Z', checked_out_at: null, price_cents: !covered && !prepaid && body.person_id === 'child' ? 1600 : 0, payment_status: prepaid && body.person_id === 'child' ? 'prepaid' : !covered && body.person_id === 'child' ? 'due' : 'covered' });
      return Response.json({ ok: true });
    }
    if (body?.mode === 'verify') return Response.json({ ok: !verifyFailure, error: verifyFailure ? 'Receipt pending' : undefined }, { status: verifyFailure ? 409 : 200 });
    if (body?.mode === 'sync') {
      if (syncStatus === 'paid') { visits = visits.map(visit => ({ ...visit, payment_status: visit.price_cents > 0 ? 'paid' : visit.payment_status })); saleOpen = false; }
      return Response.json({ ok: true, status: syncStatus });
    }
    if (body) { saleOpen = true; return Response.json({ ok: true, id: 'sale', url: 'square-commerce-v1://payment/create?fixture' }); }
    refreshes++;
    if (failRefresh && refreshes > 2) return Response.json({ ok: false, error: 'Connection lost' }, { status: 503 });
    const snapshot = JSON.parse(JSON.stringify({ ok: true, visits, enabled: squareEnabled, pending_sales: (pending || saleOpen) && visits.some(visit => visit.payment_status === 'due') ? [{ id: 'sale', checkin_ids: visits.map(visit => visit.id), launched_at: new Date().toISOString() }] : [] }));
    if (holdRead) { holdRead = false; await new Promise(resolve => heldReads.push(resolve)); }
    return Response.json(snapshot);
  };
  const logic = loadModule('src/lib/admission-pos-ui.ts');
  const page = loadModule('src/app/staff/checkin/page.tsx', { react, 'next/link': 'a', '@/components/staff/AdmissionVisits': 'admission-visits', '@/components/staff/AdmissionStayStatistics': 'admission-statistics', '@/components/staff/StaffToolNav': 'nav', '@/components/staff/StaffDashboard': 'occupancy-controls', '@/components/staff/OpenPlayReservationsAdmin': 'reservations-admin', '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ role }) }, './checkin.module.css': { default: {} }, '@/lib/admission-stays': loadModule('src/lib/admission-stays.ts'), '@/lib/admission-payment-status': loadModule('src/lib/admission-payment-status.ts'), '@/lib/admission-pos-ui': logic }, {
    React, fetch, AbortController,
    document: { visibilityState: 'visible', addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener(name) { delete listeners[name]; } },
    navigator: { userAgent: 'iPad', standalone: homeScreen },
    window: { addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener(name) { delete listeners[name]; }, location: { search: initialSearch, href: `https://example.test/staff/checkin${initialSearch}`, assign(url) { navigations.push(url); }, replace(url) { navigations.push(url); } }, history: { replaceState() {} }, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {}, sessionStorage: { setItem(key, value) { storage.set(key, value); }, getItem(key) { return storage.get(key) ?? (key === 'admission-family' ? family.id : null); }, removeItem(key) { storage.delete(key); } } },
  }).default;
  const render = () => { cursor = 0; tree = page(); return tree; };
  async function flush() {
    for (let i = 0; i < 8; i++) {
      render();
      for (const effect of effects.splice(0)) effect();
      for (const fn of timers.splice(0)) await fn();
      await new Promise(resolve => setImmediate(resolve));
    }
    render();
  }
  const nodes = () => { const all = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; all.push(node); walk(node.props?.children); }; walk(tree); return all; };
  const label = node => { if (Array.isArray(node)) return node.map(label).join(''); if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return label(node.props?.children); };
  const button = text => nodes().find(node => node.type === 'button' && label(node).includes(text));
  return { render, flush, nodes, button, requests, text: () => label(tree), visits: () => visits, navigations, resume: () => listeners.focus(), visible: () => listeners.visibilitychange(), poll: () => intervals.find(timer => timer.ms === 5000)?.fn(), holdNextRead: () => { holdRead = true; }, releaseReads: () => { for (const resolve of heldReads.splice(0)) resolve(); }, setSyncStatus: value => { syncStatus = value; }, setWaiver: value => { waiver = value; } };
}

async function choose(h) { await h.flush(); await h.button('Choose family').props.onClick(); await h.flush(); }

test('family search cards show reservation date and time in Eastern time and identify families without bookings', async () => {
  const h = uiHarness({ deskItems: [
    { ...deskFamily, name: 'Alondra Gardner', reservations: [{ ...booking, slot: { label: 'Open Play', starts_at: '2026-11-12T00:30:00Z', ends_at: '2026-11-12T02:00:00Z' } }] },
    { ...deskFamily, id: 'other', name: 'Other Gardner' },
  ] });
  await h.flush();
  h.nodes().find(node => node.props?.id === 'family-search').props.onChange({ target: { value: 'Gardner' } });
  await h.flush();
  assert.ok(h.text().includes('Open Play reservation · Wed, Nov 11, 2026'));
  assert.ok(h.text().includes('7:30 PM–9:00 PM ET'));
  assert.equal(h.text().split('Open Play reservation ·').length - 1, 1);
  assert.ok(h.text().includes('No Open Play reservations'));
  assert.equal(h.requests.filter(request => request.url === '/api/checkin').length, 0);
});

test('live occupancy stays beside check-in and payment without losing selected visitors', async () => {
  const h = uiHarness(); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  assert.equal(h.nodes().find(node => node.type === 'occupancy-controls').props.view, 'occupancy');
  assert.equal(h.button('Occupancy management'), undefined);
  assert.equal(h.requests.filter(request => request.url === '/api/checkin').length, 0);
  assert.equal(h.button('Check in 2').props.disabled, false);
  const before = h.nodes().find(node => node.type === 'occupancy-controls').props.refreshKey;
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.ok(h.nodes().find(node => node.type === 'occupancy-controls').props.refreshKey > before);
});

test('occupancy links open the integrated workspace directly', async () => {
  const h = uiHarness({ initialSearch: '?view=occupancy' }); await h.flush();
  assert.equal(h.nodes().find(node => node.type === 'occupancy-controls').props.view, 'occupancy');
});

test('name-based UI checks in selected visitors manually, skips covered charges and sends one server-total family payment', async () => {
  const h = uiHarness(); await h.flush();
  h.nodes().find(node => node.props?.id === 'family-search').props.onChange({ target: { value: 'Family' } });
  await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  assert.equal(h.button('Check in 2').props.disabled, false);
  await h.button('Check in 2').props.onClick(); await h.flush();
  const entries = h.requests.filter(request => request.url === '/api/checkin');
  assert.deepEqual(entries.map(request => request.body), [{ person_id: 'child', source: 'staff_manual' }, { person_id: 'parent', source: 'staff_manual' }]);
  assert.ok(h.text().includes('Total due: $16.00'));
  assert.equal(h.nodes().find(node => node.props?.id === 'family-search').props.value, '');
  assert.ok(h.text().includes('Today’s reservations & visitors'));
  assert.ok(h.requests.some(request => request.url === '/api/admin/admission/desk?q='));
  assert.equal(h.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.disabled).length, 2);
  assert.ok(h.nodes().some(node => node.type === 'dialog'));
  assert.equal(h.navigations.length, 0);
  await h.button('Continue to Square').props.onClick(); await h.flush();
  assert.equal(h.navigations.length, 1);
  assert.ok(!h.nodes().some(node => node.type === 'dialog'));
  assert.deepEqual(h.requests.find(request => request.body?.checkin_ids).body.checkin_ids, ['visit-child']);
});

test('waiver blocks entry and partial check-in failure keeps successful records visible for retry', async () => {
  const unsigned = uiHarness({ waiver: 'required' }); await choose(unsigned);
  unsigned.button('Select everyone remaining').props.onClick(); await unsigned.flush();
  const blocked = unsigned.button('Waiver required before check-in');
  assert.equal(blocked.props.disabled, true);
  assert.equal(blocked.props.style.cursor, 'not-allowed');
  assert.equal(blocked.props['aria-describedby'], 'checkin-block-reason');
  assert.ok(unsigned.text().includes('Check-in blocked — family waiver needed'));
  assert.equal(unsigned.requests.filter(request => request.url === '/api/checkin').length, 0);
  const h = uiHarness({ failPerson: 'parent' }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.equal(h.visits().length, 1);
  assert.ok(h.text().includes('Birthday required'));
  assert.equal(h.button('Pay $16.00').props.disabled, true);
});

test('failed payment-status refresh and pending Square checkout disable further entry/payment', async () => {
  for (const options of [{ failRefresh: true }, { pending: true }]) {
    const h = uiHarness(options); await choose(h);
    h.button('Select everyone remaining').props.onClick(); await h.flush();
    await h.button('Check in 2').props.onClick(); await h.flush();
    assert.ok(!h.button('Pay $16.00') || h.button('Pay $16.00').props.disabled);
    assert.equal(h.button('Select everyone remaining').props.disabled, true);
  }
});


test('confirmed alternate profiles produce one family with its children, including alternate email searches and direct links', async () => {
  const alternate = { ...family, id: '10000000-0000-4000-8000-000000000002', email: 'alternate@example.test' };
  const alternateAdult = { ...people[1], id: 'other-parent', household_id: alternate.id };
  const h = apiHarness({ aliases: [{ alias_household_id: alternate.id, canonical_household_id: family.id }], householdRows: [family, alternate], peopleRows: [...people, alternateAdult] });
  for (const query of ['?q=Family', '?q=alternate@example.test', `?family=${alternate.id}`]) {
    const data = await (await h.get(query)).json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].id, family.id);
    assert.deepEqual(data.items[0].people.map(person => person.id), ['child', 'parent']);
  }
});

test('families with identical names remain separate without an explicit confirmed directory link', async () => {
  const unrelated = { ...family, id: '10000000-0000-4000-8000-000000000002', email: 'someone-else@example.test' };
  const h = apiHarness({ householdRows: [family, unrelated], peopleRows: [...people, { ...people[1], id: 'unrelated', household_id: unrelated.id }] });
  const data = await (await h.get('?q=Family')).json();
  assert.equal(data.items.length, 2);
});

test('directory aliases fail visibly on database errors or ambiguous chains', async () => {
  assert.equal((await apiHarness({ failTable: 'staff_family_search_aliases' }).get('?q=Sam')).status, 503);
  const h = apiHarness({ aliases: [{ alias_household_id: family.id, canonical_household_id: 'other' }, { alias_household_id: 'other', canonical_household_id: 'third' }] });
  assert.equal((await h.get('?q=Sam')).status, 503);
});

test('directory link configuration is service-only and preserves both source households', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table households(id uuid primary key);');
  await db.exec(fs.readFileSync('db/migrations/20261029_staff_family_search_aliases.sql', 'utf8'));
  const alternate = '10000000-0000-4000-8000-000000000002';
  await db.query('insert into households values($1),($2)', [family.id, alternate]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from staff_family_search_aliases'), /permission denied/);
  await assert.rejects(db.query('insert into staff_family_search_aliases values($1,$2,$3,now())', [alternate, family.id, 'Confirmed by family']), /permission denied/);
  await db.exec('reset role; set role service_role');
  await db.query('insert into staff_family_search_aliases(alias_household_id,canonical_household_id,reason) values($1,$2,$3)', [alternate, family.id, 'Confirmed by family']);
  assert.equal((await db.query('select * from staff_family_search_aliases')).rows.length, 1);
  await assert.rejects(db.query('insert into staff_family_search_aliases(alias_household_id,canonical_household_id,reason) values($1,$1,$2)', [family.id, 'Self']), /check constraint/);
  await db.exec('reset role');
  assert.equal((await db.query('select * from households')).rows.length, 2);
});


test('waiver recheck retains selected visitors and enables entry only after a completed waiver is returned', async () => {
  const h = uiHarness({ waiver: 'required' }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Recheck waiver').props.onClick(); await h.flush();
  assert.equal(h.button('Waiver required before check-in').props.disabled, true);
  assert.equal(h.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked).length, 2);
  h.setWaiver('completed');
  await h.button('Recheck waiver').props.onClick(); await h.flush();
  assert.equal(h.button('Check in 2').props.disabled, false);
  assert.ok(h.text().includes('Your visitor selection is saved'));
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.equal(h.visits().length, 2);
});

test('check-in records visitors independently of Square handoff being enabled', async () => {
  const h = uiHarness({ squareEnabled: false }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  assert.equal(h.button('Check in 2').props.disabled, false);
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.equal(h.visits().length, 2);
  assert.equal(h.button('Pay $16.00').props.disabled, true);
});

test('a waiver rejected by the server updates the local block and keeps feedback beside the check-in controls', async () => {
  const h = uiHarness({ checkinCode: 'waiver_required' }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.equal(h.button('Waiver required before check-in').props.disabled, true);
  const feedback = h.nodes().find(node => node.props?.role === 'status' && node.type === 'p' && node.props.children.includes('waiver must be renewed'));
  assert.ok(feedback);
  assert.equal(h.visits().length, 0);
});

test('covered visits show a completion dialog without creating or opening a Square payment', async () => {
  const h = uiHarness({ covered: true }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.ok(h.nodes().some(node => node.type === 'dialog'));
  assert.ok(h.text().includes('No admission payment due.'));
  assert.equal(h.button('Continue to Square'), undefined);
  assert.equal(h.requests.filter(request => request.body?.checkin_ids).length, 0);
  await h.button('Done').props.onClick(); await h.flush();
  assert.ok(!h.nodes().some(node => node.type === 'dialog'));
  assert.equal(h.visits().length, 2);
});

test('partial or unconfirmed check-ins never show a completion dialog or launch Square', async () => {
  for (const options of [{ failPerson: 'parent' }, { failRefresh: true }]) {
    const h = uiHarness(options); await h.flush();
    h.nodes().find(node => node.props?.id === 'family-search').props.onChange({ target: { value: 'Family' } });
    await choose(h);
    h.button('Select everyone remaining').props.onClick(); await h.flush();
    await h.button('Check in 2').props.onClick(); await h.flush();
    assert.equal(h.nodes().find(node => node.props?.id === 'family-search').props.value, 'Family');
    assert.ok(!h.nodes().some(node => node.type === 'dialog'));
    assert.equal(h.navigations.length, 0);
    assert.equal(h.requests.filter(request => request.body?.checkin_ids).length, 0);
  }
});

test('dismissing confirmation retains check-ins and the unpaid total; rapid Square clicks prepare only once', async () => {
  const h = uiHarness(); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  const continueAction = h.button('Continue to Square').props.onClick;
  await continueAction(); await continueAction(); await h.flush();
  assert.equal(h.requests.filter(request => request.body?.checkin_ids).length, 1);
  const other = uiHarness(); await choose(other);
  other.button('Select everyone remaining').props.onClick(); await other.flush();
  await other.button('Check in 2').props.onClick(); await other.flush();
  await other.button('Back to desk').props.onClick(); await other.flush();
  assert.equal(other.visits().length, 2);
  assert.equal(other.button('Pay $16.00').props.disabled, false);
});

test('legacy calendar deep links open the separate Open Play page', async () => {
  const h = uiHarness({ initialSearch: '?view=reservations', role: 'staff' }); await h.flush();
  assert.deepEqual(h.navigations, ['/staff/open-play-reservations']);
  assert.ok(!h.nodes().some(node => node.type === 'reservations-admin'));
});


test('Square return keeps occupancy available, refreshes its count and never records duplicate visits or charges', async () => {
  const data = encodeURIComponent(JSON.stringify({ status: 'ok', transaction_id: 'receipt', state: 'sale' }));
  for (const verifyFailure of [false, true]) {
    const h = uiHarness({ initialSearch: `?data=${data}`, verifyFailure });
    await h.flush();
    assert.ok(h.nodes().some(node => node.type === 'occupancy-controls'));
    assert.equal(h.requests.filter(request => request.body?.mode === 'verify').length, 1);
    assert.equal(h.requests.filter(request => request.url === '/api/checkin').length, 0);
    assert.equal(h.requests.filter(request => request.body?.checkin_ids).length, 0);
    assert.equal(h.navigations.length, 0);
    if (verifyFailure) assert.ok(h.text().includes('Do not charge again'));
    else assert.ok(h.text().includes('Payment verified'));
    const before = h.nodes().find(node => node.type === 'occupancy-controls').props.refreshKey;
    h.resume(); await h.flush();
    assert.ok(h.nodes().find(node => node.type === 'occupancy-controls').props.refreshKey > before);
  }
});

test('checked-in families stay in the same results with checkout and retain their unpaid balance', async () => {
  const h = uiHarness(); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  await h.button('Back to desk').props.onClick(); await h.flush();
  assert.equal(h.button('Choose family'), undefined);
  assert.ok(h.button('Open family / payment'));
  assert.ok(h.text().includes('Checked in · 2 guests here'));
  assert.ok(!h.nodes().some(node => node.type === 'admission-visits'));
  const checkout = h.button('Check out family (2)').props.onClick;
  checkout();
  checkout();
  await h.flush();
  assert.ok(h.visits().every(visit => visit.checked_out_at));
  assert.ok(h.text().includes('Checked out'));
  assert.equal(h.button('Check out family'), undefined);
  assert.ok(h.text().includes('Total due: $16.00'));
  assert.equal(h.requests.filter(request => request.url === '/api/admin/admission/checkout').length, 1);
  assert.equal(h.requests.filter(request => request.url === '/api/checkin').length, 2);
  assert.ok(h.text().includes('Family checked out.'));
});

test('failed checkout keeps the active visitors and displays an actionable error', async () => {
  const h = uiHarness({ failCheckout: true }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  await h.button('Back to desk').props.onClick(); await h.flush();
  h.button('Check out family (2)').props.onClick();
  await h.flush();
  assert.ok(h.visits().every(visit => !visit.checked_out_at));
  assert.ok(h.text().includes('Unable to record checkout'));
});

test('Home Screen app verifies a payment without a callback, refreshes on visibility and releases the payment lock', async () => {
  const h = uiHarness(); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  await h.button('Continue to Square').props.onClick(); await h.flush();
  assert.equal(h.navigations.length, 1);
  h.setSyncStatus('paid');
  h.visible(); await h.flush();
  assert.ok(h.requests.some(request => request.body?.mode === 'sync' && request.body.state === 'sale'));
  assert.ok(h.text().includes('Payment verified'));
  assert.ok(!h.button('Pay $16.00'));
  assert.equal(h.nodes().find(node => node.props?.id === 'family-search').props.disabled, false);
  assert.equal(h.requests.filter(request => request.body?.checkin_ids).length, 1);
  assert.equal(h.requests.filter(request => request.url === '/api/checkin').length, 2);
});

test('pending receipt is retried and an older read cannot restore the unpaid state after verification', async () => {
  const h = uiHarness(); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  await h.button('Continue to Square').props.onClick(); await h.flush();
  h.visible(); await h.flush();
  assert.ok(!h.text().includes('Payment verified'));
  h.holdNextRead();
  h.button('Show / refresh today').props.onClick();
  await h.flush();
  h.setSyncStatus('paid'); h.poll(); await h.flush();
  assert.ok(h.text().includes('Payment verified'));
  h.releaseReads(); await h.flush();
  assert.ok(!h.button('Pay $16.00'));
  assert.equal(h.nodes().find(node => node.props?.id === 'family-search').props.disabled, false);
  assert.equal(h.requests.filter(request => request.body?.checkin_ids).length, 1);
});


test('prepaid visitors display paid in advance and only an explicit checkout reveals recorded stay times', async () => {
  const h = uiHarness({ prepaid: true }); await choose(h);
  h.button('Select everyone remaining').props.onClick(); await h.flush();
  await h.button('Check in 2').props.onClick(); await h.flush();
  assert.ok(h.text().includes('Paid in advance'));
  assert.equal(h.button('Pay $16.00'), undefined);
  assert.ok(!h.text().includes(' · In 10:00 AM'));
  await h.button('Done').props.onClick(); await h.flush();
  await h.button('Check out family (2)').props.onClick(); await h.flush();
  assert.ok(h.text().includes(' · In 10:00 AM'));
  assert.ok(h.text().includes('Out 12:00 PM'));
  assert.ok(h.text().includes('2 hrs'));
});

test('iPad staff screen distinguishes the Safari-created Home Screen app from a browser tab', async () => {
  const home = uiHarness({ homeScreen: true }); await home.flush();
  assert.ok(home.text().includes('Staff screen: Home Screen app'));
  const tab = uiHarness(); await tab.flush();
  assert.ok(tab.text().includes('Staff screen: browser tab'));
});
