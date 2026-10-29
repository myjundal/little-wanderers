import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const slot = { id: 'slot', label: 'Open Play', starts_at: '2026-10-29T14:00:00Z', ends_at: '2026-10-29T16:00:00Z', capacity_children: 10, capacity_total: 30, status: 'open' };
const booking = { id: 'booking', slot_id: slot.id, household_id: 'family', household_name: 'Test Family', people: ['Parent', 'Child'], child_count: 1, adult_count: 1, status: 'reserved', created_at: '2026-10-28T12:00:00Z', slot };
function harness({ canManage = false, failMutation = false } = {}) {
  const hooks = [], effects = [], requests = [], selected = [];
  let cursor = 0, tree, changes = 0;
  const memo = (factory, deps) => { const i = cursor++; if (!hooks[i] || !deps || deps.some((d, n) => d !== hooks[i].deps?.[n])) hooks[i] = { value: factory(), deps }; return hooks[i].value; };
  const react = { ...React, useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps), useEffect: (fn, deps) => memo(() => { effects.push(fn); }, deps),
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
  };
  class TestDate extends Date { constructor(...args) { if (args.length) super(...args); else super('2026-10-29T16:00:00Z'); } }
  const component = loadModule('src/components/staff/OpenPlayReservationsAdmin.tsx', { react,
    '@/lib/open-play-reservations': { SOFT_OPENING_START_DATE: '2026-10-28' }, '@/components/calendar/AvailabilityCalendar': 'calendar',
  }, { React, Date: TestDate, fetch: async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    if (options.method) { if (failMutation) throw new Error('Connection lost'); return Response.json({ ok: true, updated_count: 1 }); }
    return Response.json({ ok: true, slots: [slot], reservations: [booking, { ...booking, id: 'cancelled', status: 'cancelled' }] });
  } }).default;
  const render = () => { cursor = 0; tree = component({ canManage, onCheckIn: id => selected.push(id), onReservationsChange: () => changes++, checkedInFamilyIds: ['family'] }); };
  const flush = async () => { for (let i = 0; i < 6; i++) { render(); effects.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); } render(); };
  const nodes = () => { const out = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; out.push(node); walk(node.props?.children); }; walk(tree); return out; };
  const label = node => Array.isArray(node) ? node.map(label).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? label(node.props?.children) : String(node);
  const buttons = text => nodes().filter(node => node.type === 'button' && label(node).includes(text));
  return { flush, nodes, buttons, text: () => label(tree), requests, selected, changes: () => changes };
}

test('staff can inspect reservations and open real family check-in without owner mutation controls', async () => {
  const h = harness(); await h.flush();
  assert.equal(h.buttons('Check in & pay').length, 1);
  h.buttons('Check in & pay')[0].props.onClick();
  assert.deepEqual(h.selected, ['family']);
  assert.equal(h.buttons('Cancel reservation').length, 0);
  assert.ok(!h.text().includes('Close or reopen windows'));
  assert.ok(h.text().includes('Reservations for 2026-10-29'));
  assert.ok(h.text().includes('Admission recorded today'));
  assert.equal(h.requests.filter(r => r.method !== 'GET').length, 0);
});

test('owner reservation management remains available and refreshes the desk after an update', async () => {
  const h = harness({ canManage: true }); await h.flush();
  assert.ok(h.text().includes('Close or reopen windows'));
  assert.equal(h.buttons('checked in').length, 0);
  await h.buttons('Mark no-show')[0].props.onClick(); await h.flush();
  assert.equal(h.requests.find(r => r.method === 'PATCH').body.status, 'no_show');
  assert.equal(h.changes(), 1);
});

test('failed reservation mutations show feedback and release the busy state for retry', async () => {
  const h = harness({ canManage: true, failMutation: true }); await h.flush();
  await h.buttons('Mark no-show')[0].props.onClick(); await h.flush();
  assert.ok(h.text().includes('Connection lost'));
  assert.equal(h.buttons('Mark no-show')[0].props.disabled, false);
  assert.equal(h.changes(), 0);
});

test('old Open Play management bookmarks redirect to the unified reservation workspace', () => {
  let target;
  const page = loadModule('src/app/staff/open-play-reservations/page.tsx', { 'next/navigation': { redirect: url => { target = url; } } }).default;
  page(); assert.equal(target, '/staff/checkin?view=reservations');
});
