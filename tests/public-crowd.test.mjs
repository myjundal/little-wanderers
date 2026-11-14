import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const occupancy = loadModule('src/lib/occupancy.ts');
const party = loadModule('src/lib/party-config.ts');
const privateParty = loadModule('src/lib/private-party-open-play.ts', { '@/lib/party-config': party });
const crowd = loadModule('src/lib/public-crowd.ts', { '@/lib/party-config': party, '@/lib/private-party-open-play': privateParty });
const unavailable = crowd.publicCrowdMessage('unavailable');

function route({ count = 0, open = true, fail = false, source = {} } = {}) {
  let reads = 0;
  const api = loadModule('src/app/api/crowd-level/route.ts', {
    '@/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/lib/occupancy': { getOccupancyStatus: async () => {
      reads++;
      if (fail) throw new Error('secret database schema or credential detail');
      return { source, occupancy: count, capacity: 80, progress: count / 80,
        crowdLevel: occupancy.normalizeCrowdLevel(null, count), lastUpdatedAt: 'private-event-timestamp' };
    } },
    '@/lib/public-crowd': { ...crowd, isPublicOpenPlayOpen: async () => open },
    '@/lib/logger': { logger: { warn() {} } },
  });
  return { ...api, reads: () => reads };
}

test('all internal boundaries use absolute guest counts and both low levels share a public message', () => {
  for (const [count, level, publicStatus] of [[0, 'light', 'welcome'], [8, 'light', 'welcome'], [9, 'moderate', 'welcome'],
    [25, 'moderate', 'welcome'], [26, 'busy', 'busy'], [27, 'busy', 'busy'], [35, 'busy', 'busy'], [36, 'near_capacity', 'very_busy'], [80, 'near_capacity', 'very_busy']]) {
    assert.equal(occupancy.normalizeCrowdLevel(null, count), level);
    assert.equal(crowd.publicCrowdStatus(level), publicStatus);
  }
  assert.equal(occupancy.getOccupancyCapacity(), 80);
});

test('anonymous API returns only approved messages without counts, percentages, timestamps or low-level distinctions', async () => {
  for (const count of [0, 8, 9, 25, 26, 27, 35, 36, 80]) {
    const response = await route({ count }).GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload).sort(), ['description', 'label', 'ok', 'status']);
    assert.deepEqual(payload, JSON.parse(JSON.stringify(crowd.publicCrowdMessage(crowd.publicCrowdStatus(occupancy.normalizeCrowdLevel(null, count))))));
  }
  assert.deepEqual(await (await route({ count: 0 }).GET()).json(), await (await route({ count: 25 }).GET()).json());
});

test('closed hours skip the crowd read and missing or failed reads never claim room is available', async () => {
  const closed = route({ open: false, fail: true });
  assert.equal((await (await closed.GET()).json()).status, 'closed');
  assert.equal(closed.reads(), 0);
  for (const input of [{ fail: true }, { source: null }]) {
    const response = await route(input).GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(unavailable)));
  }
});

function scheduleAdmin(slots, parties = []) {
  const filters = [];
  return { filters, from(table) {
    let rows = table === 'party_bookings' ? parties : slots;
    const query = { select() { return query; }, eq(field, value) { if (field === 'is_soft_opening') rows = rows.filter(r => r[field] === value); return query; },
      neq(field, value) { rows = rows.filter(r => r[field] !== value); return query; },
      gte(field, value) { filters.push([field, 'gte', value]); rows = rows.filter(r => r[field] >= value); return query; },
      lt(field, value) { filters.push([field, 'lt', value]); rows = rows.filter(r => r[field] < value); return query; },
      order() { return query; }, limit: async () => ({ data: rows, error: null }) };
    return query;
  } };
}
const slot = (start, end, status = 'open') => ({ id: start, starts_at: start, ends_at: end, status, is_soft_opening: true });

test('studio hours follow current reservation windows, with exact opening/closing boundaries and no hidden hours', async () => {
  const slots = [slot('2026-11-14T14:00:00.000Z', '2026-11-14T20:00:00.000Z'), slot('2026-11-14T20:00:00.000Z', '2026-11-14T23:00:00.000Z', 'hidden')];
  for (const [time, open] of [['2026-11-14T13:59:00Z', false], ['2026-11-14T14:00:00Z', true], ['2026-11-14T19:59:59Z', true], ['2026-11-14T20:00:00Z', false]]) {
    assert.equal(await crowd.isPublicOpenPlayOpen(scheduleAdmin(slots), new Date(time)), open, time);
  }
  assert.equal(await crowd.isPublicOpenPlayOpen(scheduleAdmin([]), new Date('2026-11-14T16:00:00Z')), false);
});

test('private-party closures take priority and date filters follow Eastern time rather than UTC', async () => {
  const slots = [slot('2026-11-16T21:00:00.000Z', '2026-11-16T23:00:00.000Z')];
  const parties = [{ id: 'party', start_time: '2026-11-16T20:00:00.000Z', status: 'confirmed' }];
  assert.equal(await crowd.isPublicOpenPlayOpen(scheduleAdmin(slots), new Date('2026-11-16T21:30:00Z')), true);
  assert.equal(await crowd.isPublicOpenPlayOpen(scheduleAdmin(slots, parties), new Date('2026-11-16T21:30:00Z')), false);
  const admin = scheduleAdmin([]);
  await crowd.isPublicOpenPlayOpen(admin, new Date('2026-11-17T00:30:00Z'));
  assert.ok(admin.filters.some(([field, op, value]) => field === 'starts_at' && op === 'gte' && value === '2026-11-16T05:00:00.000Z'));
});

test('compact customer card renders each message and explanatory disclosure without numerical metrics', () => {
  for (const status of ['welcome', 'busy', 'very_busy', 'closed']) {
    let index = 0;
    const values = [crowd.publicCrowdMessage(status), false, null, new Date()];
    const Card = loadModule('src/components/crowd/CrowdLevelCard.tsx', {
      react: { useState: () => [values[index++], () => {}], useEffect() {} }, './CrowdLevelCard.module.css': {},
    }, { React }).default;
    const html = renderToStaticMarkup(React.createElement(Card, { compact: true, showHours: false }));
    assert.match(html, /Open Play · Crowd Level/);
    assert.ok(html.includes(crowd.publicCrowdMessage(status).label));
    assert.match(html, /<details/);
    assert.doesNotMatch(html, /Current estimated occupancy|progressbar|Calm|Comfortable|\/ 80/);
  }
});

test('privacy migration removes direct anonymous and signed-in view access while preserving the server read', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create view public.occupancy_status as select 27 as current_occupancy;
    grant select on public.occupancy_status to public, anon, authenticated;`);
  await db.exec(fs.readFileSync('db/migrations/20261114_private_occupancy_status.sql', 'utf8'));
  const result = await db.query(`select
    has_table_privilege('anon','public.occupancy_status','select') as anon,
    has_table_privilege('authenticated','public.occupancy_status','select') as authenticated,
    has_table_privilege('service_role','public.occupancy_status','select') as server`);
  assert.deepEqual(result.rows, [{ anon: false, authenticated: false, server: true }]);
});
