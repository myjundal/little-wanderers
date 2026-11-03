import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

const redirect = loadModule('src/lib/auth-redirect.ts');
async function login({ next = '/founding-membership/waitlist', existing = false } = {}) {
  const hooks = []; const effects = []; let cursor = 0; let tree; let verified = false;
  const authCalls = []; const navigations = []; const requests = [];
  const store = new Map(); const session = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  const memo = (fn, deps) => { const i = cursor++; if (!hooks[i] || deps.some((value, j) => !Object.is(value, hooks[i].deps[j]))) hooks[i] = { value: fn(), deps }; return hooks[i].value; };
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useRef: initial => memo(() => ({ current: initial }), []), useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) { memo(() => { effects.push(fn); }, deps); },
  };
  const page = loadModule('src/app/(public)/login/page.tsx', {
    react, '@/lib/auth-redirect': redirect,
    '@/lib/supabase/browser': { createBrowserSupabaseClient: () => ({ auth: {
      getUser: async () => ({ data: { user: verified ? { id: existing ? 'existing-user' : 'new-user' } : null } }),
      signInWithOtp: async input => { authCalls.push(input); return { error: null }; },
      verifyOtp: async input => { authCalls.push(input); verified = true; return { error: null }; },
    } }) },
  }, { React: react, process: { env: { NEXT_PUBLIC_SITE_URL: 'https://thelittlewanderers.com' } }, sessionStorage: session,
    window: { location: { search: `?mode=continue&next=${encodeURIComponent(next)}`, origin: 'https://preview.example.test', hostname: 'preview.example.test', replace: url => navigations.push(url) }, localStorage: session, setInterval() {}, clearInterval() {} },
    fetch: async url => { requests.push(url); throw Error('Unified login must not require a signup endpoint.'); },
  }).default;
  const render = () => { cursor = 0; tree = page(); effects.splice(0).forEach(fn => fn()); };
  const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const nodes = () => { const result = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!React.isValidElement(node)) return; result.push(node); visit(node.props.children); }; visit(tree); return result; };
  const click = async text => { const node = nodes().find(node => node.type === 'button' && node.props.children === text); assert.ok(node, `Missing button: ${text}`); await node.props.onClick(); await flush(); };
  const input = (id, value) => { nodes().find(node => node.props.id === id).props.onChange({ target: { value } }); render(); };
  render(); await flush();
  return { authCalls, navigations, requests, click, input, nodes, flush, html: () => renderToStaticMarkup(tree) };
}

test('one email continuation handles both existing and first-time users without account-status or signup steps', async () => {
  for (const existing of [false, true]) {
    const view = await login({ existing });
    assert.doesNotMatch(view.html(), /Account status|I am new|I already have an account|Early access now starts/);
    view.input('email', 'Parent@Example.test');
    await view.click('Email me a login link');
    assert.equal(view.authCalls[0].email, 'parent@example.test');
    assert.equal(view.authCalls[0].options.shouldCreateUser, true);
    const url = new URL(view.authCalls[0].options.emailRedirectTo);
    assert.equal(url.origin, 'https://preview.example.test');
    assert.equal(url.searchParams.get('next'), '/founding-membership/waitlist');
    assert.equal(url.searchParams.get('mode'), 'continue');
    assert.equal(view.requests.length, 0);
    assert.match(view.html(), /return directly to your membership/);
  }
});

test('first-time and existing phone users verify SMS and return through the authenticated membership continuation', async () => {
  for (const existing of [false, true]) {
    const view = await login({ existing, next: '/founding-membership/public' });
    await view.click('Continue with phone');
    view.input('phone', '(860) 555-0123');
    await view.click('Text me a code');
    assert.equal(view.authCalls[0].phone, '+18605550123');
    assert.equal(view.authCalls[0].options.shouldCreateUser, true);
    for (let index = 0; index < 4; index++) {
      const fields = view.nodes().filter(node => node.type === 'input' && node.props.maxLength === 1);
      fields[index].props.onChange({ target: { value: String(index + 1) } });
      await view.flush();
    }
    assert.equal(view.authCalls[1].type, 'sms');
    assert.equal(view.authCalls[1].token, '1234');
    assert.deepEqual(view.navigations, ['/auth/finish?next=%2Ffounding-membership%2Fpublic']);
    assert.equal(view.requests.length, 0);
  }
});

test('email callbacks return to membership and retain its continuation when the email code is missing or expired', async () => {
  const api = error => loadSquareModules({ mocks: {
    '@supabase/ssr': { createServerClient: () => ({ auth: {
      exchangeCodeForSession: async () => ({ error }), getUser: async () => ({ data: { user: error ? null : { id: 'verified-user' } } }),
    } }) },
    '@/lib/waitlist-claim': { getPostAuthRedirectForUser: async (_user, next) => next },
  } }).load('src/app/auth/callback/route.ts');
  const request = suffix => ({ url: `https://preview.example.test/auth/callback?mode=continue&next=%2Ffounding-membership%2Fwaitlist${suffix}`, cookies: { get() {} } });
  const success = await api(null).GET(request('&code=valid'));
  assert.equal(success.headers.get('location'), 'https://preview.example.test/founding-membership/waitlist');
  for (const suffix of ['', '&code=expired']) {
    const response = await api({ message: 'Expired code' }).GET(request(suffix));
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, '/login');
    assert.equal(destination.searchParams.get('mode'), 'continue');
    assert.equal(destination.searchParams.get('next'), '/founding-membership/waitlist');
  }
});

test('SMS finishing uses the verified account and preserves membership destination if the session is lost', async () => {
  for (const user of [null, { id: 'verified-phone-user', phone: '18605550123' }]) {
    const api = loadSquareModules({ mocks: {
      '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
      '@/lib/waitlist-claim': { getPostAuthRedirectForUser: async (actual, next) => { assert.equal(actual.id, user.id); return next; } },
    } }).load('src/app/auth/finish/route.ts');
    const url = new URL('https://preview.example.test/auth/finish?next=%2Ffounding-membership%2Fpublic');
    const response = await api.GET({ url: url.toString(), nextUrl: url });
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, user ? '/founding-membership/public' : '/login');
    if (!user) { assert.equal(destination.searchParams.get('mode'), 'continue'); assert.equal(destination.searchParams.get('next'), '/founding-membership/public'); }
  }
});
