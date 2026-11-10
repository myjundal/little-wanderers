import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

const redirect = loadModule('src/lib/auth-redirect.ts');
const authRequest = loadModule('src/lib/auth-request.ts', {}, { setTimeout, clearTimeout, AbortController });
async function login({ next = '/wanderlist-founding', existing = false, mode = 'continue', sendOtp, verifyCode, userLookup, timeoutMs = 15000 } = {}) {
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
    react, '@/lib/auth-redirect': redirect, './login.module.css': {},
    '@/lib/auth-request': { withAuthDeadline: run => authRequest.withAuthDeadline(run, timeoutMs) },
    '@/lib/supabase/browser': { createBrowserSupabaseClient: () => ({ auth: {
      getUser: async () => userLookup ? userLookup(verified) : ({ data: { user: verified ? { id: existing ? 'existing-user' : 'new-user' } : null } }),
      signInWithOtp: async input => { authCalls.push(input); return sendOtp ? sendOtp(input) : { error: null }; },
      verifyOtp: async input => { authCalls.push(input); const result = verifyCode ? await verifyCode(input) : { error: null }; verified = !result.error; return result; },
    } }) },
  }, { React: react, process: { env: { NEXT_PUBLIC_SITE_URL: 'https://thelittlewanderers.com' } }, sessionStorage: session,
    window: { location: { search: `?mode=${mode}&next=${encodeURIComponent(next)}`, origin: 'https://preview.example.test', hostname: 'preview.example.test', replace: url => navigations.push(url) }, localStorage: session, setInterval() {}, clearInterval() {} },
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
    assert.equal(url.searchParams.get('next'), '/wanderlist-founding');
    assert.equal(url.searchParams.get('mode'), 'continue');
    assert.equal(view.requests.length, 0);
    assert.match(view.html(), /return directly to your membership/);
  }
});

test('first-time and existing phone users verify SMS and return through the authenticated membership continuation', async () => {
  for (const existing of [false, true]) {
    const view = await login({ existing, next: '/general-founding' });
    await view.click('Use a linked phone number instead');
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
    assert.deepEqual(view.navigations, ['/auth/finish?next=%2Fgeneral-founding']);
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
  const request = suffix => ({ url: `https://preview.example.test/auth/callback?mode=continue&next=%2Fwanderlist-founding${suffix}`, cookies: { get() {} } });
  const success = await api(null).GET(request('&code=valid'));
  assert.equal(success.headers.get('location'), 'https://preview.example.test/wanderlist-founding');
  for (const suffix of ['', '&code=expired']) {
    const response = await api({ message: 'Expired code' }).GET(request(suffix));
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, '/login');
    assert.equal(destination.searchParams.get('mode'), 'continue');
    assert.equal(destination.searchParams.get('next'), '/wanderlist-founding');
  }
});

test('SMS finishing uses the verified account and preserves membership destination if the session is lost', async () => {
  for (const user of [null, { id: 'verified-phone-user', phone: '18605550123' }]) {
    const api = loadSquareModules({ mocks: {
      '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
      '@/lib/waitlist-claim': { getPostAuthRedirectForUser: async (actual, next) => { assert.equal(actual.id, user.id); return next; } },
    } }).load('src/app/auth/finish/route.ts');
    const url = new URL('https://preview.example.test/auth/finish?next=%2Fgeneral-founding');
    const response = await api.GET({ url: url.toString(), nextUrl: url });
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, user ? '/general-founding' : '/login');
    if (!user) { assert.equal(destination.searchParams.get('mode'), 'continue'); assert.equal(destination.searchParams.get('next'), '/general-founding'); }
  }
});


test('Wanderlist login defaults to email and explains linked-phone eligibility before SMS', async () => {
  const view = await login();
  assert.match(view.html(), /email you joined the Wanderlist with/);
  assert.ok(view.nodes().some(node => node.props.id === 'email'));
  assert.equal(view.nodes().some(node => node.props.id === 'phone'), false);
  await view.click('Use a linked phone number instead');
  assert.match(view.html(), /already verified on your Wanderlist account/);
  await view.click('Use email instead');
  assert.ok(view.nodes().some(node => node.props.id === 'email'));
  assert.equal(view.authCalls.length, 0);
});


test('ordinary signup, existing account, and reservation entry all use one email continuation', async () => {
 for (const mode of ['new','existing','continue']) {
  const view=await login({mode,next:'/landing/soft-opening'});
  assert.doesNotMatch(view.html(), /Account status|I am new|I already have an account|October 28|early access link/);
  assert.match(view.html(), /sign in or create your free family account/);
  view.input('email','Parent@Example.test');
  await view.click('Email me a login link');
  assert.equal(view.authCalls.length,1);
  assert.equal(view.authCalls[0].options.shouldCreateUser,true);
  const callback=new URL(view.authCalls[0].options.emailRedirectTo);
  assert.equal(callback.searchParams.get('next'),'/landing/soft-opening');
  assert.equal(callback.searchParams.get('mode'),'continue');
  assert.equal(view.requests.length,0);
  await view.click('Change email');
  await view.click('Email me a login link');
  assert.equal(view.authCalls.length,1,'Repeated sends use the existing email cooldown');
 }
});


test('a stalled SMS send exits Sending, releases the form, and does not claim a code was sent', async () => {
  let finishSend;
  const view = await login({ next: '/landing/soft-opening', timeoutMs: 30, sendOtp: () => new Promise(resolve => { finishSend = resolve; }) });
  await view.click('Use a linked phone number instead');
  view.input('phone', '(860) 555-0123');
  const sending = view.click('Text me a code');
  await view.flush();
  assert.match(view.html(), /Sending/);
  assert.equal(view.nodes().find(n => n.type === 'button' && n.props.children === 'Use email instead').props.disabled, true);
  await sending;
  assert.match(view.html(), /sign-in service is not responding/);
  assert.doesNotMatch(view.html(), /Sending|We sent a 4-digit code/);
  assert.equal(view.nodes().find(n => n.type === 'button' && n.props.children === 'Text me a code').props.disabled, false);
  finishSend({ error: null });
  await view.flush();
  assert.doesNotMatch(view.html(), /Enter the 4-digit code|We sent a 4-digit code/);
  assert.equal(view.navigations.length, 0);
});

test('network failures recover both phone and email forms with a useful error', async () => {
  for (const method of ['phone', 'email']) {
    const view = await login({ next: '/landing/soft-opening', sendOtp: async () => { throw Error('Failed to fetch'); } });
    if (method === 'phone') await view.click('Use a linked phone number instead');
    view.input(method, method === 'phone' ? '(860) 555-0123' : 'parent@example.test');
    await view.click(method === 'phone' ? 'Text me a code' : 'Email me a login link');
    assert.match(view.html(), /sign-in service is not responding/);
    assert.doesNotMatch(view.html(), /Sending|Failed to fetch/);
    assert.equal(view.navigations.length, 0);
  }
});

async function enterSmsCode(view) {
  await view.click('Use a linked phone number instead');
  view.input('phone', '(860) 555-0123');
  await view.click('Text me a code');
  for (let index = 0; index < 4; index++) {
    const field = view.nodes().filter(n => n.type === 'input' && n.props.maxLength === 1)[index];
    field.props.onChange({ target: { value: String(index + 1) } });
    await view.flush();
  }
}

test('a rejected code is not automatically submitted repeatedly; editing it allows a new attempt', async () => {
  const view = await login({ verifyCode: async () => ({ error: { message: 'Invalid OTP' } }) });
  await enterSmsCode(view);
  for (let i = 0; i < 8; i++) await view.flush();
  assert.equal(view.authCalls.filter(call => call.type === 'sms').length, 1);
  assert.match(view.html(), /code was not accepted/);
  assert.doesNotMatch(view.html(), /Checking/);
  const first = view.nodes().find(n => n.type === 'input' && n.props.maxLength === 1);
  first.props.onChange({ target: { value: '5' } });
  await view.flush();
  assert.equal(view.authCalls.filter(call => call.type === 'sms').length, 2);
  assert.equal(view.navigations.length, 0);
});

test('a stalled verification or final user lookup releases Checking without duplicate requests or redirects', async () => {
  for (const stage of ['verify', 'user']) {
    const view = await login({ timeoutMs: 5,
      verifyCode: stage === 'verify' ? () => new Promise(() => {}) : undefined,
      userLookup: stage === 'user' ? isVerified => isVerified ? new Promise(() => {}) : ({ data: { user: null } }) : undefined,
    });
    await enterSmsCode(view);
    await new Promise(resolve => setTimeout(resolve, 20));
    await view.flush();
    assert.match(view.html(), /sign-in service is not responding/);
    assert.doesNotMatch(view.html(), /Checking/);
    assert.equal(view.authCalls.filter(call => call.type === 'sms').length, 1);
    assert.equal(view.navigations.length, 0);
  }
});
