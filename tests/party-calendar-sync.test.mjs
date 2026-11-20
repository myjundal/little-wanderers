import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const config = loadModule('src/lib/party-config.ts');
const info = loadModule('src/lib/party-info.ts');
const booking = (id, date, hour, status = 'confirmed') => ({
  id, status, start_time: config.toPartyDateTimeIso(date, hour),
  end_time: config.toPartyDateTimeIso(date, hour + 3), notes: null,
});
const original = [booking('saturday', '2026-11-28', 10), booking('sunday-am', '2026-11-29', 10), booking('sunday-pm', '2026-11-29', 15)];
const cancelled = original.map(item => ({ ...item, status: item.id === 'sunday-am' ? 'confirmed' : 'cancelled' }));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const hooks = [], effects = [], cleanups = [], requests = [], polls = [];
  let cursor = 0, tree, items = original, failed = false, delayNext = false, release;
  const memo = (read, deps) => {
    const index = cursor++;
    if (!hooks[index] || deps.some((dep, i) => !Object.is(dep, hooks[index].deps[i]))) hooks[index] = { value: read(), deps };
    return hooks[index].value;
  };
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }];
    },
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => memo(() => { effects.push(fn); }, deps),
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-20T17:00:00Z'])); }
    static now() { return Date.parse('2026-11-20T17:00:00Z'); }
  }
  const Page = loadModule('src/app/landing/party/page.tsx', {
    react, 'next/link': 'a', 'next/image': 'img',
    '@/components/calendar/AvailabilityCalendar': 'calendar', '@/components/ui/ActionToast': () => null,
    '@/lib/party-config': config, '@/lib/party-info': info,
    '@/lib/supabase/browser': { createBrowserSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'parent' } } }) } }) },
    '@/lib/visible-polling': { startVisiblePolling: (refresh, interval, options) => {
      const poll = { refresh, interval, options, stopped: false }; polls.push(poll);
      return () => { poll.stopped = true; };
    } },
  }, { React: react, Date: Clock, window: { location: { search: '' } },
    fetch: async (url, options) => {
      assert.equal(options.cache, 'no-store'); requests.push(url);
      if (url.startsWith('/api/family/profile')) return Response.json({ ok: true });
      const snapshot = items;
      if (url.startsWith('/api/party-bookings/calendar')) {
        if (delayNext) { delayNext = false; await new Promise(resolve => { release = resolve; }); }
        return Response.json({ ok: !failed, items: snapshot.filter(item => item.status !== 'cancelled') }, { status: failed ? 503 : 200 });
      }
      return Response.json({ ok: true, items: snapshot });
    },
  }).default;
  function render() { cursor = 0; tree = Page(); effects.splice(0).forEach(fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }); }
  function all(predicate) {
    const found = [];
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      if (predicate(node)) found.push(node);
      visit(node.props.children);
    }
    visit(tree); return found;
  }
  render(); await flush(); render();
  return {
    polls, requests, render, all,
    get slots() { return all(node => node.type === 'calendar')[0].props.slots; },
    update(next) { items = next; }, fail(value) { failed = value; },
    delay() { delayNext = true; }, release() { release(); },
    async refresh() { await polls[0].refresh(); render(); },
    cleanup() { cleanups.forEach(fn => fn()); },
  };
}

test('returning from the dashboard removes Nov 28 and Nov 29 afternoon cancellations and preserves only Sunday morning', async () => {
  const h = await harness();
  assert.equal(h.polls[0].interval, 60000);
  assert.equal(h.polls[0].options.immediate, false);
  assert.equal(h.slots.filter(slot => slot.status === 'mine').length, 3);
  h.all(node => node.type === 'input' && node.props.type === 'date')[0].props.onChange({ target: { value: '2026-12-13' } });
  h.render();
  h.update(cancelled);
  const refreshing = h.polls[0].refresh(); h.render();
  assert.equal(h.all(node => node.type === 'input' && node.props.type === 'date').length, 1); // Background refresh keeps the form mounted.
  await refreshing; h.render();
  assert.equal(h.all(node => node.type === 'input' && node.props.type === 'date')[0].props.value, '2026-12-13');
  assert.deepEqual(Array.from(h.slots.filter(slot => slot.status === 'mine'), slot => slot.id), ['mine-sunday-am']);
  for (const [date, hour, available] of [['2026-11-28', 10, true], ['2026-11-28', 15, true], ['2026-11-29', 10, false], ['2026-11-29', 15, true]]) {
    assert.equal(h.slots.some(slot => slot.status === 'available' && slot.start === config.toPartyDateTimeIso(date, hour)), available);
  }
  assert.equal(h.slots.some(slot => /saturday|sunday-pm/.test(slot.id)), false);
  h.cleanup(); assert.equal(h.polls[0].stopped, true);
});

test('a delayed old response cannot restore a cancelled party or its original schedule', async () => {
  const h = await harness(); h.delay();
  const old = h.polls[0].refresh();
  h.update(cancelled.map(item => item.id === 'sunday-am' ? { ...item, start_time: config.toPartyDateTimeIso('2026-11-29', 11), end_time: config.toPartyDateTimeIso('2026-11-29', 14) } : item));
  await h.refresh(); h.release(); await old; h.render();
  const mine = h.slots.filter(slot => slot.status === 'mine');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].start, config.toPartyDateTimeIso('2026-11-29', 11));
  assert.equal(mine[0].end, config.toPartyDateTimeIso('2026-11-29', 14));
  h.cleanup();
});

test('an unsuccessful background refresh disables stale availability and recovers on the next refresh', async () => {
  const h = await harness(); h.fail(true); await h.refresh();
  assert.equal(h.slots.some(slot => slot.status === 'available'), false);
  assert.equal(h.all(node => node.props.role === 'status' && /Could not refresh/.test(node.props.children)).length, 1);
  h.fail(false); h.update(cancelled); await h.refresh();
  assert.equal(h.slots.some(slot => slot.status === 'available' && slot.start === config.toPartyDateTimeIso('2026-11-28', 10)), true);
  assert.equal(h.all(node => node.props.role === 'status' && /Could not refresh/.test(node.props.children)).length, 0);
  h.cleanup();
});
