import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const config = loadModule('src/lib/party-config.ts');
const management = loadModule('src/lib/party-management.ts', { '@/lib/party-config': config });
const id = '2af2cb2b-db0b-4d28-bfa2-fb23d50c00bc';
const booking = { id, start_time: '2099-11-07T15:00:00Z', end_time: '2099-11-07T18:00:00Z', status: 'confirmed' };
const payload = { date: '2099-11-08', start_time: '15:30', end_time: '18:45', expected_start_time: booking.start_time, expected_end_time: booking.end_time };

test('operator schedules preserve Eastern wall times and minutes across DST changes', () => {
  for (const [date, offset] of [['2027-03-13', 5], ['2027-03-14', 4], ['2027-11-06', 4], ['2027-11-07', 5]]) {
    const schedule = management.parsePartySchedule(date, '10:15', '13:45');
    assert.equal(schedule.start_time, `${date}T${10 + offset}:15:00.000Z`);
    assert.equal(schedule.end_time, `${date}T${13 + offset}:45:00.000Z`);
    assert.equal(management.getPartyTimeValue(schedule.start_time), '10:15');
  }
  for (const [date, start, end] of [
    ['2027-02-30', '10:00', '13:00'], ['2027-13-01', '10:00', '13:00'],
    ['2027-03-14', '02:30', '05:00'], ['2027-11-07', '13:00', '10:00'],
    ['2027-11-07', '10:00', '10:00'], ['2027-11-07', '25:00', '26:00'],
    ['2027-11-07', '10:60', '13:00'], [null, '10:00', '13:00'],
  ]) assert.equal(management.parsePartySchedule(date, start, end), null);
});

function apiHarness({ current = booking, others = [], denied = false, conflictError = false, changedWhileSaving = false, writeError = null } = {}) {
  let saved, queries = 0;
  const filters = [];
  const admin = { from(table) {
    assert.equal(table, 'party_bookings');
    queries++;
    let update;
    const predicates = [];
    const q = {
      select() { return q; }, limit() { return q; },
      eq(key, value) { filters.push([key, value]); predicates.push(row => row[key] === value); return q; },
      neq(key, value) { predicates.push(row => row[key] !== value); return q; },
      lt(key, value) { predicates.push(row => Date.parse(row[key]) < Date.parse(value)); return q; },
      gt(key, value) { predicates.push(row => Date.parse(row[key]) > Date.parse(value)); return q; },
      update(value) { update = value; return q; },
      maybeSingle: async () => {
        if (!update) return { data: current, error: null };
        if (writeError) return { data: null, error: writeError };
        if (changedWhileSaving || !predicates.every(check => check(current))) return { data: null, error: null };
        saved = update;
        return { data: { id, start_time: update.start_time, end_time: update.end_time }, error: null };
      },
      then: resolve => resolve({ data: others.filter(row => predicates.every(check => check(row))), error: conflictError ? { message: 'offline' } : null }),
    };
    return q;
  } };
  const { PATCH } = loadModule('src/app/api/admin/party-bookings/[id]/schedule/route.ts', {
    '@/lib/authz': { requireOwnerContext: async () => denied ? { ok: false, response: Response.json({ ok: false }, { status: 403 }) } : { ok: true, admin } },
    '@/lib/open-play-reservations': { isUuid: value => value === id },
    '@/lib/party-management': management,
  });
  return {
    filters, get saved() { return saved; }, get queries() { return queries; },
    patch: (body = payload, bookingId = id) => PATCH(new Request('https://example.test/api', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({ id: bookingId }) }),
  };
}

test('owner schedule updates accept custom hours and return the persisted schedule', async () => {
  const h = apiHarness();
  const response = await h.patch();
  assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.equal(management.getPartyTimeValue(item.start_time), '15:30');
  assert.equal(management.getPartyTimeValue(item.end_time), '18:45');
  assert.equal(config.getPartyDateKey(item.start_time), payload.date);
  assert.equal(h.saved.start_time, item.start_time);
  assert.equal(Object.hasOwn(h.saved, 'status'), false);
  assert.equal(Object.hasOwn(h.saved, 'notes'), false);
  assert.ok(h.filters.some(([key, value]) => key === 'start_time' && value === booking.start_time));
  assert.ok(h.filters.some(([key, value]) => key === 'end_time' && value === booking.end_time));
  assert.ok(h.filters.some(([key, value]) => key === 'status' && value === 'confirmed'));
});

test('schedule saves reject overlapping active bookings but allow cancelled, adjacent and own bookings', async () => {
  const schedule = management.parsePartySchedule(payload.date, payload.start_time, payload.end_time);
  for (const status of ['pending', 'confirmed', 'early_access_hold']) {
    const h = apiHarness({ others: [{ id: 'other', ...schedule, status }] });
    assert.equal((await h.patch()).status, 409);
    assert.equal(h.saved, undefined);
  }
  const h = apiHarness({ others: [
    { id: 'cancelled', ...schedule, status: 'cancelled' },
    { id, ...schedule, status: 'confirmed' },
    { id: 'adjacent', start_time: schedule.end_time, end_time: '2099-11-09T03:00:00Z', status: 'confirmed' },
  ] });
  assert.equal((await h.patch()).status, 200);
  const failing = apiHarness({ conflictError: true });
  assert.equal((await failing.patch()).status, 500);
  assert.equal(failing.saved, undefined);
});

test('schedule API enforces access, input validation, current schedule and booking lifecycle', async () => {
  const denied = apiHarness({ denied: true });
  assert.equal((await denied.patch()).status, 403);
  assert.equal(denied.queries, 0);
  assert.equal((await apiHarness().patch(payload, 'invalid')).status, 400);
  assert.equal((await apiHarness().patch('{')).status, 400);
  assert.equal((await apiHarness().patch(null)).status, 400);
  assert.equal((await apiHarness().patch({ ...payload, end_time: '14:00' })).status, 400);
  assert.equal((await apiHarness().patch({ ...payload, expected_start_time: undefined })).status, 400);
  assert.equal((await apiHarness().patch({ ...payload, date: '2020-01-01' })).status, 400);
  assert.equal((await apiHarness({ current: null }).patch()).status, 404);
  assert.equal((await apiHarness({ current: { ...booking, status: 'cancelled' } }).patch()).status, 409);
  assert.equal((await apiHarness({ current: { ...booking, end_time: '2020-01-01T18:00:00Z' } }).patch()).status, 409);
  assert.equal((await apiHarness().patch({ ...payload, expected_start_time: '2099-11-07T16:00:00Z' })).status, 409);
  assert.equal((await apiHarness({ changedWhileSaving: true }).patch()).status, 409);
  assert.equal((await apiHarness({ writeError: { code: '23P01' } }).patch()).status, 409);
  assert.equal((await apiHarness({ writeError: { code: 'offline' } }).patch()).status, 500);
});

function editorHarness({ save = async () => Response.json({ ok: true, item: { id, ...management.parsePartySchedule(payload.date, payload.start_time, payload.end_time) } }) } = {}) {
  const hooks = [], requests = [], saved = [], events = [];
  let cursor = 0, tree;
  const react = { ...React, useId: () => 'schedule',
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
  };
  const Editor = loadModule('src/components/staff/PartyScheduleEditor.tsx', {
    react, '@/lib/party-config': config, '@/lib/party-management': management, './party-schedule-editor.module.css': {},
  }, { React: react,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent: event => events.push(event) },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return save(); },
  }).default;
  const render = () => { cursor = 0; tree = Editor({ booking, onSaved: item => saved.push(item) }); };
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
  render();
  return { requests, saved, events, render, all,
    field(type, value) { all(node => node.type === 'input' && node.props.type === type)[0].props.onChange({ target: { value } }); render(); },
    time(index, value) { all(node => node.type === 'input' && node.props.type === 'time')[index].props.onChange({ target: { value } }); render(); },
    submit: () => tree.props.onSubmit({ preventDefault() {} }),
  };
}

test('editor saves the selected date and custom times with the original schedule, then syncs views', async () => {
  const h = editorHarness();
  assert.equal(h.all(node => node.type === 'button')[0].props.disabled, true);
  h.field('date', payload.date); h.time(0, payload.start_time); h.time(1, payload.end_time);
  await h.submit(); h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `/api/admin/party-bookings/${id}/schedule`);
  assert.deepEqual(h.requests[0].body, payload);
  assert.equal(h.saved.length, 1);
  assert.equal(h.events[0].type, management.PARTY_SCHEDULE_UPDATED_EVENT);
  assert.equal(h.events[0].detail.start_time, h.saved[0].start_time);
});

test('editor keeps drafts after a conflict and blocks invalid times and duplicate submissions', async () => {
  const h = editorHarness({ save: async () => Response.json({ ok: false, error: 'Another party is already booked during this time.' }, { status: 409 }) });
  h.time(0, '18:00');
  await h.submit(); h.render();
  assert.equal(h.requests.length, 0);
  assert.ok(h.all(node => node.props.role === 'alert')[0]);
  h.time(0, '11:30');
  await Promise.all([h.submit(), h.submit()]); h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(h.saved.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal(h.all(node => node.type === 'input' && node.props.type === 'time')[0].props.value, '11:30');
  assert.match(h.all(node => node.props.role === 'alert')[0].props.children, /already booked/);
  assert.equal(h.all(node => node.type === 'fieldset')[0].props.disabled, false);
});
