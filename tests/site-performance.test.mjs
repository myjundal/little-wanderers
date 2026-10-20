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
    const query = { select() { return query; }, gte() { return query; }, eq() { return query; }, order() { return query; },
      limit: async () => ({ data: [{ id: 'painting', title: fixtureClass.title, start_time: fixtureClass.start_time, end_time: fixtureClass.end_time, capacity: 7, price_cents: 15000 }], error: null }),
    };
    return query;
  } };
  const api = loadModule('src/lib/public-class-data.ts', {
    'server-only': {}, 'next/cache': cache, '@/lib/class-config': classConfig,
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' } } });
  const first = await api.getPublicClasses(60);
  assert.equal(first[0].duration_minutes, 45);
  assert.equal('booked_count' in first[0], false);
  await api.getPublicClasses(60);
  assert.equal(tables.length, 1);
  cache.advance(61);
  await api.getPublicClasses(60);
  assert.equal(tables.length, 2);
});

test('class cards are included in server HTML without a follow-up API request', () => {
  const { default: Classes } = loadModule('src/components/classes/PublicUpcomingClasses.tsx', {
    react: React, '@/lib/class-config': classConfig,
    '@/lib/public-classes': loadModule('src/lib/public-classes.ts'),
    '@/lib/supabase/browser': {},
  }, { React });
  const markup = renderToStaticMarkup(React.createElement(Classes, { classes: [fixtureClass] }));
  assert.match(markup, /Little Hands, Big Canvases/);
  assert.match(markup, /Pre-register/);
  assert.match(markup, /Class size: 7 kids/);
  assert.doesNotMatch(markup, /Waitlist|seats left/);
});

test('header and home count reads share one request and reuse only the public count cache', async () => {
  let reads = 0;
  let release;
  const cache = cacheFixture();
  const admin = { from() {
    const query = { select() { return query; }, lt() { return query; },
      abortSignal(signal) {
        assert.ok(signal instanceof AbortSignal);
        reads++;
        return new Promise(resolve => { release = resolve; });
      },
    };
    return query;
  } };
  const api = loadModule('src/lib/waitlist-count.ts', {
    'next/cache': cache, '@/lib/signup-policy': { WANDERLIST_CUTOFF: '2099-01-01' },
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' } }, AbortSignal });
  const header = api.getWaitlistCount();
  const home = api.getWaitlistCount();
  assert.equal(header, home);
  release({ count: 457, error: null });
  assert.equal((await header).displayCount, 450);
  assert.equal((await api.getWaitlistCount()).displayCount, 450);
  assert.equal(reads, 1);
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
