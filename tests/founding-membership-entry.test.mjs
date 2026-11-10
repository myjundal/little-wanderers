import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const birthdate = loadModule('src/lib/birthdate.ts');
const membership = loadModule('src/lib/founding-membership.ts', { '@/lib/birthdate': birthdate });
const waitlistOffer = { phase: 'waitlist', tier: 'waitlist', can_enroll: false, base_cents: 5000, sibling_cents: 1000 };
async function entry(audience, { signedIn = false, offer = waitlistOffer, enrollment = null, phoneOnly = false, config = null } = {}) {
  const signOutCalls = []; const navigations = [];
  const hooks = []; let cursor = 0; const effects = [];
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useEffect(fn) { const i = cursor++; if (!(i in hooks)) { hooks[i] = true; effects.push(fn); } },
  };
  const Component = loadModule('src/components/membership/FoundingMembership.tsx', {
    react, 'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/script': () => null, '@/lib/founding-membership': membership, '@/lib/birthdate': birthdate,
    '@/lib/supabase/browser': { createBrowserSupabaseClient: () => ({ auth: { signOut: async options => { signOutCalls.push(options); return { error: null }; } } }) },
    './founding.module.css': {},
  }, { React: react, crypto: { randomUUID: () => 'new-child-id' }, fetch: async () => Response.json({
    offer, enrollment, config,
    account: { email: phoneOnly ? null : 'existing@example.test', phone: '+18605550123' },
    household: { email: phoneOnly ? '' : 'existing@example.test', phone: '+18605550123', city: 'West Hartford', state: 'CT' },
    people: [{ id: 'saved-adult', role: 'adult', first_name: 'Parent', last_name: 'Family', gender: 'female' },
      { id: 'saved-child', role: 'child', first_name: 'Sam', last_name: 'Family', gender: 'male', birthdate: '2023-01-01' }],
  }, { status: signedIn ? 200 : 401 }), window: { location: { assign: url => navigations.push(url) } } }).default;
  const render = () => { cursor = 0; return Component({ audience }); };
  render(); effects.splice(0).forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = () => {
    const tree = render(); const nodes = [];
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!React.isValidElement(node)) return; nodes.push(node); visit(node.props.children); };
    visit(tree);
    return { html: renderToStaticMarkup(tree), nodes, signOutCalls, navigations, rerender: snapshot };
  };
  return snapshot();
}

async function advance(view) {
  await view.nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  return view.rerender();
}

test('each unlisted entry route selects its own audience and forbids indexing', () => {
  for (const audience of ['waitlist', 'public']) {
    const slug = audience === 'waitlist' ? 'wanderlist-founding' : 'general-founding';
    const route = loadModule(`src/app/(public)/${slug}/page.tsx`, {
      '@/components/membership/FoundingMembership': () => null,
    }, { React });
    assert.equal(route.default().props.audience, audience);
    assert.equal(route.metadata.robots.index, false);
    assert.equal(route.metadata.robots.follow, false);
  }
});

test('guest pages advertise separate prices and use a single authentication continuation to the exact entry URL', async () => {
  for (const [audience, sibling] of [['waitlist', 10], ['public', 20]]) {
    const view = await entry(audience);
    assert.match(view.html, new RegExp(`\\+\\$${sibling}/mo`));
    assert.match(view.html, /Pay \$0 today/);
    assert.match(view.html, /first membership visit, including during soft opening/);
    assert.match(view.html, /Visits throughout our soft opening period/);
    assert.doesNotMatch(view.html, /announced soft opening date|A free visit during/);
    const expected = `/login?mode=continue&next=${encodeURIComponent(audience === 'waitlist' ? '/wanderlist-founding' : '/general-founding')}`;
    assert.equal(view.nodes.filter(node => node.props.href?.startsWith('/login')).length, 1);
    assert.ok(view.nodes.some(node => node.props.href === expected));
    assert.doesNotMatch(view.html, /Create a family account|Sign in to my account/);
    assert.equal(view.nodes.some(node => node.type === 'form'), false);
  }
});

test('phone-only sessions can enter the required contact email and show their authenticated phone', async () => {
  const view = await entry('public', { signedIn: true, phoneOnly: true });
  const email = view.nodes.find(node => node.props.id === 'founding-email');
  assert.notEqual(email.props.readOnly, true);
  assert.equal(email.props.required, true);
  assert.equal(email.props.value, '');
  assert.match(view.html, /Contact email/);
  assert.match(view.html, /Signed in as <strong>\+18605550123/);
});

test('general entry keeps its own title while honoring an eligible family’s better account rate and saved identities', async () => {
  let waitlist = await entry('public', { signedIn: true, offer: { ...waitlistOffer, can_enroll: true } });
  assert.equal(waitlist.nodes.filter(node => node.type === 'span' && node.props.children === 'Public founding').length, 1);
  assert.match(waitlist.html, /Your account qualifies for original Wanderlist pricing/);
  assert.match(waitlist.html, /existing@example.test/);
  assert.equal(waitlist.nodes.some(node => node.props.id === 'founding-email'), false);
  waitlist = await advance(waitlist);
  assert.equal(waitlist.nodes.find(node => node.props.id === 'first-saved-child').props.value, 'Sam');
  assert.equal(waitlist.nodes.find(node => node.props.id === 'birth-saved-child').props.value, '01/01/2023');
});

test('Wanderlist entry never changes to Public after login and cannot silently enroll an ineligible family at public pricing', async () => {
  const view = await entry('waitlist', { signedIn: true, offer: { phase: 'public', tier: 'public', can_enroll: true, base_cents: 5000, sibling_cents: 2000 }, config: { applicationId: 'test-app', locationId: 'test-location', environment: 'sandbox' } });
  assert.equal(view.nodes.filter(node => node.type === 'span' && node.props.children === 'Wanderlist founding').length, 1);
  assert.match(view.html, /\+\$10\/mo/);
  assert.match(view.html, /could not confirm eligibility with this account/);
  assert.doesNotMatch(view.html, /Public founding|\+\$20\/mo/);
  assert.equal(view.nodes.some(node => node.type === 'form'), false);
  assert.equal(view.nodes.some(node => node.props.id === 'founding-card'), false);
  assert.equal(view.nodes.some(node => node.props.src?.includes('squarecdn.com')), false);
  assert.ok(view.nodes.some(node => node.props.href === '/general-founding'));
  assert.equal(view.signOutCalls.length, 0);
  await view.nodes.find(node => node.type === 'button' && node.props.children === 'Use my Wanderlist email').props.onClick();
  assert.equal(view.signOutCalls[0].scope, 'local');
  assert.deepEqual(view.navigations, ['/login?mode=continue&next=%2Fwanderlist-founding']);
});

test('Wanderlist identity stays stable for existing public reservations without changing their saved rates', async () => {
  const view = await entry('waitlist', { signedIn: true, offer: { phase: 'public', tier: 'public', can_enroll: true, base_cents: 5000, sibling_cents: 2000 }, enrollment: {
    status: 'pending', pricing_tier: 'public', base_cents: 5000, sibling_cents: 2000,
    card_brand: 'VISA', card_last4: '1111', start_date: null, paid_through: null,
  } });
  assert.equal(view.nodes.filter(node => node.type === 'span' && node.props.children === 'Wanderlist founding').length, 1);
  assert.match(view.html, /\+\$10\/mo/);
  assert.match(view.html, /\$20\/month per sibling/);
  assert.equal(view.nodes.some(node => node.type === 'form'), false);
});

test('opening ends both advertised founding offers; existing reservations retain their saved prices', async () => {
  const regular = { phase: 'regular', tier: 'regular', can_enroll: true, base_cents: 6000, sibling_cents: 2000 };
  for (const audience of ['waitlist', 'public']) {
    assert.match((await entry(audience, { offer: regular })).html, /Regular monthly pricing/);
  }
  const saved = await entry('public', { signedIn: true, offer: regular, enrollment: {
    status: 'pending', pricing_tier: 'waitlist', base_cents: 5000, sibling_cents: 1000,
    card_brand: 'VISA', card_last4: '1111', start_date: null, paid_through: null,
  } });
  assert.match(saved.html, /\+\$10\/mo/);
  assert.match(saved.html, /not set yet/);
});


test('family setup presents one step at a time, retains edits, and loads Square only on the card step', async () => {
  const config = { applicationId: 'test-app', locationId: 'test-location', environment: 'sandbox' };
  let view = await entry('waitlist', { signedIn: true, offer: { ...waitlistOffer, can_enroll: true }, config });
  assert.ok(view.nodes.some(node => node.props.id === 'founding-first'));
  assert.equal(view.nodes.some(node => node.props.id === 'first-saved-child'), false);
  assert.equal(view.nodes.some(node => node.props.src?.includes('squarecdn.com')), false);
  view = await advance(view);
  assert.equal(view.nodes.some(node => node.props.id === 'founding-first'), false);
  assert.ok(view.nodes.some(node => node.props.id === 'first-saved-child'));
  view.nodes.find(node => node.props.id === 'first-saved-child').props.onChange({ target: { value: 'Updated name' } });
  view = view.rerender();
  view = await advance(view);
  assert.match(view.html, /Please confirm your children/);
  assert.equal(view.nodes.some(node => node.props.id === 'founding-card'), false);
  view.nodes.find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  view = view.rerender();
  view = await advance(view);
  assert.match(view.html, /Updated name/);
  assert.match(view.html, /\$50\/mo/);
  assert.ok(view.nodes.some(node => node.props.id === 'founding-card'));
  assert.ok(view.nodes.some(node => node.props.src?.includes('sandbox.web.squarecdn.com')));
  assert.ok(view.nodes.some(node => node.props.type === 'submit' && node.props.disabled));
  view.nodes.find(node => node.props.children === '← Back').props.onClick();
  view = view.rerender();
  assert.equal(view.nodes.find(node => node.props.id === 'first-saved-child').props.value, 'Updated name');
  assert.equal(view.nodes.some(node => node.props.id === 'founding-card'), false);
  view.nodes.find(node => node.props.id === 'birth-saved-child').props.onChange({ target: { value: '12/31/2099' } });
  view = view.rerender(); view = await advance(view);
  assert.match(view.html, /actual birthday/);
  assert.equal(view.nodes.some(node => node.props.id === 'founding-card'), false);
});

test('an invalid phone stays on the parent step before loading Square', async () => {
  let view = await entry('public', { signedIn: true, offer: { ...waitlistOffer, phase: 'public', tier: 'public', can_enroll: true } });
  view.nodes.find(node => node.props.id === 'founding-phone').props.onChange({ target: { value: '123' } });
  view = view.rerender(); view = await advance(view);
  assert.match(view.html, /10-digit US phone/);
  assert.ok(view.nodes.some(node => node.props.id === 'founding-first'));
  assert.equal(view.nodes.some(node => node.props.id === 'founding-card'), false);
});

test('compact header removes distractions on membership and every login entry', () => {
  for (const [path, query, compact] of [
    ['/wanderlist-founding', '', true], ['/general-founding', '', true],
    ['/login', 'mode=continue&next=/wanderlist-founding', true],
    ['/', '', false], ['/party', '', false], ['/login', '', true], ['/login', 'next=/landing/soft-opening', true],
  ]) {
    const header = loadModule('src/components/membership/FoundingHeader.tsx', {
      'next/navigation': { usePathname: () => path, useSearchParams: () => new URLSearchParams(query) },
      'next/link': ({ children, ...props }) => React.createElement('a', props, children),
      'next/image': props => React.createElement('img', { ...props, priority: undefined }),
      './founding.module.css': {},
    }, { React }).default;
    const output = header({ children: 'Existing website navigation' });
    const html = renderToStaticMarkup(output);
    assert.equal(html.includes('Need help?'), compact);
    assert.equal(html.includes('Existing website navigation'), !compact);
  }
});
