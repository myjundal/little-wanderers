import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const load = fetch => loadModule('src/lib/auth-request.ts', {}, { fetch, setTimeout, clearTimeout, AbortController, Request });
const authUrl = 'https://example.supabase.co/auth/v1/otp';

test('auth transport aborts a stalled request at its deadline', async () => {
  let signal;
  const api = load((_input, init) => new Promise((_resolve, reject) => {
    signal = init.signal;
    signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }));
  await assert.rejects(api.fetchWithAuthTimeout(authUrl, { method: 'POST' }, 5), /auth_request_timeout/);
  assert.equal(signal.aborted, true);
});

test('successful auth calls retain options and clear their abort timer', async () => {
  let signal;
  const api = load(async (input, init) => {
    assert.equal(input, authUrl);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.apikey, 'public-test-key');
    assert.equal(init.body, 'request-body');
    signal = init.signal;
    return Response.json({ ok: true });
  });
  assert.equal((await api.fetchWithAuthTimeout(authUrl, { method: 'POST', headers: { apikey: 'public-test-key' }, body: 'request-body' }, 5)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(signal.aborted, false);
});

test('auth transport respects a caller abort signal, including Request inputs', async () => {
  for (const requestObject of [false, true]) {
    const original = new AbortController();
    const api = load((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const result = requestObject
      ? api.fetchWithAuthTimeout(new Request(authUrl, { signal: original.signal }))
      : api.fetchWithAuthTimeout(authUrl, { signal: original.signal });
    original.abort(Error('caller stopped'));
    await assert.rejects(result, /caller stopped/);
  }
});

test('non-auth Supabase traffic preserves its original request and signal', async () => {
  const options = { signal: new AbortController().signal, method: 'GET' };
  const url = 'https://example.supabase.co/rest/v1/people';
  const api = load(async (input, init) => {
    assert.equal(input, url);
    assert.equal(init, options);
    return Response.json([]);
  });
  assert.equal((await api.fetchWithAuthTimeout(url, options)).status, 200);
});

test('auth operation deadline handles stuck SDK operations and preserves ordinary results/errors', async () => {
  const api = load();
  await assert.rejects(api.withAuthDeadline(() => new Promise(() => {}), 5), /auth_request_timeout/);
  assert.equal(await api.withAuthDeadline(async () => 'done', 5), 'done');
  await assert.rejects(api.withAuthDeadline(async () => { throw Error('original error'); }, 5), /original error/);
});
