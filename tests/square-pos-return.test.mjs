import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const ui = loadModule('src/lib/admission-pos-ui.ts');
const sale = '50000000-0000-4000-8000-000000000001';
const family = '10000000-0000-4000-8000-000000000001';

test('pending launch restoration rejects malformed, expired and unbounded local state', () => {
  const valid = { id: sale, family_id: family, started_at: 1000 };
  assert.equal(ui.readPendingAdmissionPos(JSON.stringify(valid), 2000).id, sale);
  for (const value of [null, 'broken', 'x'.repeat(501), JSON.stringify({ ...valid, id: '//elsewhere' }), JSON.stringify({ ...valid, family_id: 'not-a-family' }), JSON.stringify({ ...valid, started_at: 3000 })]) {
    assert.equal(ui.readPendingAdmissionPos(value, 2000), null);
  }
  assert.equal(ui.readPendingAdmissionPos(JSON.stringify(valid), 86402000), null);
});

function bridgeHarness({ staff = true, status = 'ok', receipt = 'paid', state = sale } = {}) {
  const hooks = [], effects = [], requests = [], navigations = [];
  let cursor = 0, tree;
  const react = { ...React,
    useState(initial) { const n = cursor++; if (!(n in hooks)) hooks[n] = initial; return [hooks[n], value => { hooks[n] = typeof value === 'function' ? value(hooks[n]) : value; }]; },
    useEffect(effect, deps) { const n = cursor++; if (!hooks[n] || deps.some((value, i) => value !== hooks[n][i])) { hooks[n] = deps; effects.push(effect); } },
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) });
    return Response.json(url === '/api/auth/staff' ? { ok: true, is_staff: staff } : { ok: true, status: receipt, household_id: family });
  };
  const Page = loadModule('src/app/square-pos-return/page.tsx', { react, '@/lib/admission-pos-ui': ui }, {
    React, fetch, AbortController,
    window: { location: { origin: 'https://example.test', search: '?data=' + encodeURIComponent(JSON.stringify({ status, state, transaction_id: 'receipt' })), replace(url) { navigations.push(url); } } },
  }).default;
  const text = node => Array.isArray(node) ? node.map(text).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children) : String(node);
  return { requests, navigations, text: () => text(tree), async flush() { for (let i = 0; i < 6; i++) { cursor = 0; tree = Page(); for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)); } } };
}

test('Safari callback verifies the receipt under its staff session and returns to the selected staff desk', async () => {
  const h = bridgeHarness(); await h.flush();
  assert.deepEqual(h.requests.find(row => row.body).body, { mode: 'verify', state: sale, transaction_id: 'receipt' });
  assert.equal(h.navigations[0], `/staff/checkin?family=${family}&square_pos_return=verified`);
  assert.ok(!h.navigations.some(url => url.includes('/login')));
});

test('a Home Screen-only session gets app-return guidance without a customer-login redirect or payment mutation', async () => {
  const h = bridgeHarness({ staff: false }); await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/auth/staff');
  assert.equal(h.navigations.length, 0);
  assert.ok(h.text().includes('Home Screen icon'));
  assert.ok(!h.text().includes('Payment verified'));
});

test('a signed Home Screen return saves its verified receipt without sharing staff login or family details', async () => {
  const state = `${sale}.1900000000.signature`;
  const h = bridgeHarness({ staff: false, state }); await h.flush();
  assert.equal(h.requests[1].url, '/api/square/pos-return');
  assert.deepEqual(h.requests[1].body, { state, transaction_id: 'receipt' });
  assert.ok(h.text().includes('Square payment confirmed and saved'));
  assert.equal(h.navigations.length, 0);
  assert.ok(!h.requests.some(request => request.url.startsWith('/api/admin/')));
});

test('pending verification remains reviewable and cancellation never marks a receipt paid', async () => {
  const h = bridgeHarness({ receipt: 'pending' }); await h.flush();
  assert.equal(h.navigations.length, 0);
  assert.ok(h.text().includes('do not charge again'));
  const cancelled = bridgeHarness({ status: 'error' }); await cancelled.flush();
  assert.equal(cancelled.requests.length, 1);
  assert.equal(cancelled.navigations[0], '/staff/checkin?square_pos_return=interrupted');
});

test('Square callbacks are rewritten before protected layouts while ordinary staff pages refresh authentication', async () => {
  let authCalls = 0;
  const api = loadModule('src/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => { authCalls++; } } }) },
    'next/server': { NextResponse: {
      rewrite: url => ({ rewrite: String(url), headers: new Headers() }),
      next: () => ({ headers: new Headers(), cookies: { set() {} } }),
    } },
  }, { Headers, process: { env: {} } });
  const request = path => {
    const url = new URL('https://example.test' + path); url.clone = () => new URL(url);
    return { nextUrl: url, headers: new Headers(), cookies: { getAll: () => [] } };
  };
  const result = await api.middleware(request('/staff/checkin?data=receipt'));
  assert.equal(new URL(result.rewrite).pathname, '/square-pos-return');
  assert.equal(new URL(result.rewrite).searchParams.get('data'), 'receipt');
  assert.equal(authCalls, 0);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  await api.middleware(request('/staff/checkin'));
  assert.equal(authCalls, 1);
  assert.ok(api.config.matcher.includes('/staff/:path*'));
});
