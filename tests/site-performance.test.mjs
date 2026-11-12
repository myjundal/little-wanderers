import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { classConfig, fixtureClass, loadModule } from './helpers/class-preregistration-harness.mjs';

function cacheFixture() {
  let now = 0;
  return {
    advance: seconds => { now += seconds; },
    unstable_cache: (read, _key, { revalidate }) => {
      const results = new Map();
      return (...args) => {
        const key = JSON.stringify(args);
        const previous = results.get(key);
        if (previous && previous.expires > now) return previous.value;
        const value = read(...args);
        results.set(key, { expires: now + revalidate, value });
        return value;
      };
    },
  };
}

test('public class metadata is cached for a minute and never reads registrations', async () => {
  const cache = cacheFixture();
  const tables = [];
  const admin = { from(table) {
    tables.push(table);
    assert.equal(table, 'classes');
    const query = { select() { return query; }, gte() { return query; }, lt(_field, value) { assert.equal(value, classConfig.CLASS_TERM_END_AT); return query; }, eq() { return query; }, order() { return query; },
      limit() { return query; }, abortSignal: async () => ({ data: [{ id: 'painting', title: fixtureClass.title, start_time: fixtureClass.start_time, end_time: fixtureClass.end_time, capacity: 7, price_cents: 15000 }], error: null }),
    };
    return query;
  } };
  const api = loadModule('src/lib/public-class-data.ts', {
    'server-only': {}, 'next/cache': cache, '@/lib/class-config': classConfig,
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' } }, AbortSignal });
  const first = await api.getPublicClasses(60);
  assert.equal(first[0].duration_minutes, 45);
  assert.equal('booked_count' in first[0], false);
  await api.getPublicClasses(80);
  assert.equal(tables.length, 1);
  cache.advance(61);
  await api.getPublicClasses(60);
  assert.equal(tables.length, 2);
});

test('class cards are included in server HTML without a follow-up API request', () => {
  const { default: Classes } = loadModule('src/components/classes/PublicUpcomingClasses.tsx', {
    react: React, '@/lib/class-config': classConfig,
    '@/lib/public-classes': loadModule('src/lib/public-classes.ts'),
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    './ClassDescription': ({ description }) => React.createElement('p', null, description),
  }, { React });
  const markup = renderToStaticMarkup(React.createElement(Classes, { classes: [fixtureClass] }));
  assert.match(markup, /Little Hands, Big Canvases/);
  assert.match(markup, /Choose dates &amp; pay/);
  assert.match(markup, /href="\/landing\/classschedule"/);
  assert.match(markup, /Class size: 7 kids/);
  assert.doesNotMatch(markup, /Waitlist|seats left/);
});

test('closed Wanderlist count stays at the verified total without external reads', async () => {
  // No Supabase, legacy endpoint, cache, or environment imports are needed.
  const api = loadModule('src/lib/waitlist-count.ts');
  const [header, home] = await Promise.all([api.getWaitlistCount(), api.getWaitlistCount()]);
  assert.equal(header.displayCount, 460);
  assert.equal(home.displayCount, 460);
  assert.deepEqual(Object.keys(header), ['displayCount']);
});

test('simultaneous menus share permission lookup but subsequent lookups read fresh permissions', async () => {
  let fetches = 0;
  let release;
  const api = loadModule('src/lib/use-owner-dashboard-access.ts', { react: {} }, {
    fetch: () => {
      fetches++;
      return new Promise(resolve => { release = resolve; });
    },
  });
  const menu = api.loadOperatorAccess();
  const bar = api.loadOperatorAccess();
  assert.equal(menu, bar);
  assert.equal(fetches, 1);
  release(Response.json({ ok: true, role: 'owner', is_staff: true }));
  assert.equal((await menu).role, 'owner');
  const changed = api.loadOperatorAccess();
  assert.equal(fetches, 2);
  release(Response.json({ ok: true, role: 'user', is_staff: false }));
  assert.equal((await changed).role, 'user');
});

test('unchanged guardian details skip the extra people update', async () => {
  const writes = [];
  const admin = { from(table) {
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
      update(patch) { writes.push({ table, patch }); return query; },
      maybeSingle: async () => ({ data: { id: 'guardian', first_name: 'Parent', last_name: 'Family' }, error: null }),
      then(resolve) { resolve({ error: null }); },
    };
    return query;
  } };
  const { ensureGuardianProfile } = loadModule('src/lib/family-profile.ts', {
    '@/lib/family-roles': { FAMILY_PRIMARY_CAREGIVER_ROLE: 'primary_caregiver' },
  });
  const guardian = await ensureGuardianProfile({ admin, householdId: 'family', userId: 'parent', firstName: 'Parent', lastName: 'Family' });
  assert.equal(guardian.id, 'guardian');
  assert.equal(writes.filter(write => write.table === 'people').length, 0);
});

function walk(element, predicate) {
  if (!element || typeof element !== 'object') return null;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = walk(child, predicate);
    if (found) return found;
  }
  return null;
}

test('home hero renders before class metadata and uses the complete play studio photo', async () => {
  let classReads = 0;
  const home = loadModule('src/components/home/HomeComingSoon.tsx', {
    react: React, 'next/image': 'img', 'next/link': 'a',
    '@/app/(public)/home.module.css': {},
    '@/lib/class-config': classConfig,
    '@/components/home/WaitlistCountCard': () => null,
    '@/components/pastel/PastelPrimitives': { PastelButton: 'a', PastelCard: 'div' },
    '@/lib/party-config': { PARTY_BOOKING_START_LABEL: 'October 31, 2026' },
    '@/lib/public-classes': loadModule('src/lib/public-classes.ts'),
    '@/lib/public-class-data': { getPublicClasses: async () => { classReads++; return [fixtureClass]; } },
    '@/lib/waitlist-count': { getWaitlistCount: async () => ({ displayCount: 460 }) },
  }, { React, process: { env: {} } });
  const tree = await home.default();
  assert.equal(classReads, 0, 'hero must not wait for a class query or authentication');
  const image = walk(tree, element => element.type === 'img');
  assert.equal(image.props.src, '/play-studio.jpg');
  assert.equal(image.props.width, 1280);
  assert.equal(image.props.height, 749);
  const boundary = walk(tree, element => element.type === React.Suspense);
  assert.ok(boundary.props.fallback);
  const schedule = await boundary.props.children.type();
  assert.equal(classReads, 1);
  assert.match(renderToStaticMarkup(schedule), /Little Hands, Big Canvases/);
});

function crowdHarness(showStatus = true, showHours = false) {
  const effects = [];
  const timers = new Map();
  const visibilityListeners = new Set();
  let nextTimer = 0;
  let release;
  let cursor = 0;
  let currentTime = Date.parse('2026-11-09T13:59:00Z');
  const values = [];
  const loadingUpdates = [];
  const requests = [];
  class Clock extends Date {
    constructor(...args) { if (args.length) super(...args); else super(currentTime); }
    static now() { return currentTime; }
  }
  const document = { hidden: false,
    addEventListener: (_name, listener) => visibilityListeners.add(listener),
    removeEventListener: (_name, listener) => visibilityListeners.delete(listener),
  };
  const component = loadModule('src/components/crowd/CrowdLevelCard.tsx', {
    react: { useState: initial => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => { values[index] = value; if (index === 1) loadingUpdates.push(value); }]; },
      useEffect: callback => { effects.push(callback); } },
    './CrowdLevelCard.module.css': {},
  }, { React, document, AbortController, Date: Clock,
    window: { setInterval: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearInterval: id => timers.delete(id) },
    fetch: async (_url, options) => { requests.push(options); return new Promise(resolve => { release = resolve; }); },
  }).default;
  const render = () => { cursor = 0; return component({ showStatus, showHours }); };
  render();
  const cleanups = effects.splice(0).map(effect => effect()).filter(Boolean);
  return { requests, document, cleanup: cleanups.length ? () => cleanups.forEach(cleanup => cleanup()) : undefined,
    loadingUpdates, render, setTime: value => { currentTime = Date.parse(value); },
    poll: () => [...timers.values()].find(timer => timer.ms === 10000).fn(),
    clockTick: () => [...timers.values()].find(timer => timer.ms === 60000).fn(),
    reveal: () => visibilityListeners.forEach(listener => listener()),
    resolve: async () => { release(Response.json({ ok: true, occupancy: 7, capacity: 80 })); await new Promise(resolve => setImmediate(resolve)); },
    get listening() { return visibilityListeners.size > 0; },
    get timerCount() { return timers.size; },
  };
}

test('hours-only card updates Eastern opening and closing times without occupancy requests', () => {
  const h = crowdHarness(false, true);
  assert.equal(h.requests.length, 0);
  assert.match(renderToStaticMarkup(h.render()), /closed now/);
  h.setTime('2026-11-09T14:00:00Z');
  h.clockTick();
  assert.match(renderToStaticMarkup(h.render()), /we are open now/);
  h.setTime('2026-11-09T23:00:00Z');
  h.clockTick();
  assert.match(renderToStaticMarkup(h.render()), /closed now/);
  h.setTime('2026-11-10T14:00:00Z');
  h.reveal();
  assert.match(renderToStaticMarkup(h.render()), /Tuesday/);
  assert.match(renderToStaticMarkup(h.render()), /we are open now/);
  assert.equal(h.requests.length, 0);
  h.cleanup();
  assert.equal(h.timerCount, 0);
  assert.equal(h.listening, false);
});

test('occupancy polling avoids overlapping and background requests and keeps readings during refresh', async () => {
  const harness = crowdHarness();
  assert.equal(harness.requests.length, 1);
  harness.poll();
  assert.equal(harness.requests.length, 1);
  await harness.resolve();
  harness.document.hidden = true;
  harness.poll();
  assert.equal(harness.requests.length, 1);
  harness.document.hidden = false;
  harness.reveal();
  assert.equal(harness.requests.length, 2);
  assert.deepEqual(harness.loadingUpdates, [false]);
  harness.cleanup();
  assert.equal(harness.requests[1].signal.aborted, true);
  assert.equal(harness.listening, false);
  await harness.resolve();
});

function partyLoadHarness({ failCalendar = false } = {}) {
  const state = [];
  const callbacks = [];
  const requests = [];
  let cursor = 0;
  let resolveAuth;
  const auth = new Promise(resolve => { resolveAuth = resolve; });
  const react = { ...React, useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  }, useEffect() {}, useMemo: read => read(), useCallback: fn => { callbacks.push(fn); return fn; }, useRef: value => ({ current: value }) };
  const config = loadModule('src/lib/party-config.ts');
  const Page = loadModule('src/app/landing/party/page.tsx', {
    react, 'next/link': 'a', 'next/image': 'img',
    '@/components/calendar/AvailabilityCalendar': 'calendar', '@/components/ui/ActionToast': () => null,
    '@/lib/party-config': config, '@/lib/party-info': loadModule('src/lib/party-info.ts'),
    '@/lib/supabase/browser': { createBrowserSupabaseClient: () => ({ auth: { getUser: () => auth } }) },
  }, { React: react, fetch: (url) => new Promise((resolve, reject) => { requests.push({ url, resolve, reject }); }) }).default;
  const render = () => { cursor = 0; return Page(); };
  const initial = render();
  const loading = callbacks[0]();
  return { state, requests, initial, render, loading, resolveAuth,
    finish: async () => {
      requests.find(r => r.url.includes('/calendar')).resolve(Response.json({ ok: !failCalendar, items: [] }, { status: failCalendar ? 503 : 200 }));
      requests.find(r => r.url.startsWith('/api/party-bookings?')).resolve(Response.json({ ok: true, items: [] }));
      await loading;
    },
  };
}

test('party calendar and bookings start together and do not wait for guardian prefill', async () => {
  const h = partyLoadHarness();
  assert.equal(h.requests.length, 2, 'calendar and bookings start before auth finishes');
  assert.ok(h.requests.some(r => r.url.includes('/calendar')));
  const initialCalendar = walk(h.initial, node => node.type === 'calendar');
  assert.equal(initialCalendar.props.slots.some(slot => slot.status === 'available'), false);
  h.resolveAuth({ data: { user: { id: 'parent' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 3, 'profile starts as soon as auth resolves');
  await h.finish();
  assert.equal(h.state[2], false, 'form stops loading while profile is still pending');
  assert.ok(walk(h.render(), node => node.type === 'calendar').props.slots.some(slot => slot.status === 'available'));
  h.requests.find(r => r.url.includes('/family/profile')).resolve(Response.json({ ok: true, guardian: { first_name: 'Parent', last_name: 'Family' } }));
  await new Promise(resolve => setImmediate(resolve));
});

test('failed party availability finishes loading without offering unknown times', async () => {
  const h = partyLoadHarness({ failCalendar: true });
  h.resolveAuth({ data: { user: null } });
  await h.finish();
  assert.equal(h.state[2], false);
  assert.match(h.state[4], /Could not refresh the party calendar/);
  assert.equal(walk(h.render(), node => node.type === 'calendar').props.slots.some(slot => slot.status === 'available'), false);
});
