import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

function scheduler(hidden = false) {
  const timers = new Map();
  let next = 0, now = 0;
  const document = Object.assign(new EventTarget(), { hidden });
  const window = Object.assign(new EventTarget(), {
    setInterval(fn, ms) { timers.set(++next, { fn, ms }); return next; },
    clearInterval(id) { timers.delete(id); },
  });
  const api = loadModule('src/lib/visible-polling.ts', {}, {
    window, document, Date: class extends Date { static now() { return now; } },
  });
  return { ...api, timers, window, document,
    tick(ms = 60000) { now += ms; for (const timer of [...timers.values()]) timer.fn(); },
    advance(ms) { now += ms; },
    visible(value) { document.hidden = !value; document.dispatchEvent(new Event('visibilitychange')); },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('automatic reads stop in hidden tabs, resume once on return, and remove all timers on cleanup', async () => {
  const h = scheduler(); let reads = 0;
  const stop = h.startVisiblePolling(() => { reads++; }, 60000);
  await flush(); assert.equal(reads, 1); assert.equal(h.timers.size, 1);
  h.tick(); await flush(); assert.equal(reads, 2);
  h.visible(false); assert.equal(h.timers.size, 0);
  h.tick(3600000); await flush(); assert.equal(reads, 2);
  h.visible(true); h.window.dispatchEvent(new Event('focus')); h.window.dispatchEvent(new Event('pageshow'));
  await flush(); assert.equal(reads, 3); assert.equal(h.timers.size, 1);
  stop(); h.advance(5000); h.visible(true); h.window.dispatchEvent(new Event('focus'));
  assert.equal(reads, 3); assert.equal(h.timers.size, 0);
});

test('background mounts wait for visibility and slow or failed requests never overlap or disable retries', async () => {
  const h = scheduler(true); let reads = 0, release;
  const stop = h.startVisiblePolling(() => { reads++; return new Promise(resolve => { release = resolve; }); }, 15000);
  assert.equal(reads, 0); assert.equal(h.timers.size, 0);
  h.visible(true); assert.equal(reads, 1);
  h.tick(15000); h.tick(15000); assert.equal(reads, 1);
  release(); await flush(); h.tick(15000); assert.equal(reads, 2);
  release(); await flush(); stop();
  let attempts = 0;
  const stopErrors = h.startVisiblePolling(async () => { attempts++; throw Error('offline'); }, 60000);
  await flush(); h.tick(); await flush(); assert.equal(attempts, 2); stopErrors();
});

test('public availability is uncached, exposes only loader output, and never caches failures', async () => {
  for (const fail of [false, true]) {
    const api = loadModule('src/app/api/open-play-availability/route.ts', {
      '@/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
      '@/lib/public-open-play': { loadPublicOpenPlaySlots: async () => { if (fail) throw Error('private schema detail'); return [{ id: 'slot', remaining_children: 2 }]; } },
    });
    const response = await api.GET();
    assert.equal(response.status, fail ? 503 : 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.json(); assert.equal(body.ok, !fail);
    assert.doesNotMatch(JSON.stringify(body), /private schema/);
  }
});

test('Open Play shell has no request-time database work and uses a live calendar', () => {
  const page = fs.readFileSync('src/app/(public)/open-play/page.tsx', 'utf8');
  assert.doesNotMatch(page, /force-dynamic|createAdminSupabaseClient|loadPublicOpenPlaySlots/);
  assert.match(page, /<LiveOpenPlayCalendar/);
});

test('live calendar recovers from an initial read error before mounting dated controls and aborts obsolete reads', async () => {
  const values = [], effects = [], cleanups = [], reads = [], polls = [];
  let cursor = 0, fail = true;
  const slots = [{ id: 'live', starts_at: '2099-01-01T15:00:00Z' }];
  function Calendar() {}
  const Live = loadModule('src/components/soft-opening/LiveOpenPlayCalendar.tsx', {
    react: { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial;
      return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
      useCallback: fn => fn, useEffect: fn => effects.push(fn) },
    '@/lib/visible-polling': { startVisiblePolling: refresh => { polls.push(refresh); void refresh(); return () => {}; } },
    './PublicOpenPlayCalendar': Calendar, './public-open-play.module.css': {},
  }, { React, AbortController, fetch: async (url, options) => {
    reads.push({ url, options });
    return Response.json(fail ? { ok: false } : { ok: true, slots }, { status: fail ? 503 : 200 });
  } }).default;
  const render = () => { cursor = 0; effects.length = 0; return Live(); };
  render(); effects.splice(0).forEach(fn => cleanups.push(fn())); await flush();
  assert.notEqual(render().type, Calendar, 'failed initial read must not initialize an empty calendar date');
  fail = false; await polls[0]();
  const result = render(); assert.equal(result.type, Calendar); assert.deepEqual(result.props.slots, slots);
  assert.equal(reads[0].url, '/api/open-play-availability'); assert.equal(reads[0].options.cache, 'no-store');
  cleanups.forEach(fn => fn()); assert.equal(reads[0].options.signal.aborted, true);
});

test('class metadata cache is shared while registration counts stay fresh and metadata errors fail closed', async () => {
  let registrations = 1, fail = false, metadataReads = 0;
  const klass = { id: 'class', title: 'Art', start_time: '2099-01-01T15:00:00Z', end_time: '2099-01-01T16:00:00Z', capacity: 6 };
  const api = loadModule('src/app/api/classes/route.ts', {
    '@/lib/public-class-data': { getPublicClassCatalog: async () => { metadataReads++; if (fail) throw Error('metadata unavailable'); return [klass]; } },
    '@supabase/supabase-js': { createClient: () => ({ from(table) {
      assert.equal(table, 'class_registrations');
      return { select() { return this; }, in: async () => ({ data: Array.from({ length: registrations }, (_, i) => ({ class_id: 'class', person_id: String(i), status: 'scheduled' })), error: null }) };
    } }) },
  }, { process: { env: {} } });
  const request = { nextUrl: new URL('https://example.test/api/classes?limit=200') };
  assert.equal((await (await api.GET(request)).json()).items[0].seats_left, 5);
  registrations = 3;
  assert.equal((await (await api.GET(request)).json()).items[0].seats_left, 3);
  assert.equal(metadataReads, 2);
  fail = true; assert.equal((await api.GET(request)).status, 500);
});

test('successful class changes invalidate metadata; rejected and failed changes do not', async () => {
  for (const outcome of ['success', 'denied', 'failed']) {
    const tags = [];
    const admin = { from() {
      const query = { insert: async () => ({ error: outcome === 'failed' ? { message: 'write failed' } : null }),
        select() { return query; }, order: async () => ({ data: [], error: null }) };
      return query;
    } };
    const api = loadModule('src/app/api/admin/classes/route.ts', {
      'next/cache': { revalidateTag: tag => tags.push(tag) },
      '@/lib/authz': { requireClassManagementContext: async () => outcome === 'denied'
        ? { ok: false, response: Response.json({ ok: false }, { status: 403 }) } : { ok: true, admin } },
    });
    const response = await api.POST({ json: async () => ({ title: 'Art', start_time: '2099-01-01T15:00:00Z', end_time: '2099-01-01T16:00:00Z' }) });
    assert.equal(response.status, outcome === 'success' ? 200 : outcome === 'denied' ? 403 : 500);
    assert.deepEqual(tags, outcome === 'success' ? ['public-class-catalog'] : []);
  }
});
