import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const birthdate = loadModule('src/lib/birthdate.ts');
const membership = loadModule('src/lib/founding-membership.ts', { '@/lib/birthdate': birthdate });
const waitlistOffer = { phase: 'waitlist', tier: 'waitlist', can_enroll: false, base_cents: 5000, sibling_cents: 1000 };
async function entry(audience, { signedIn = false, offer = waitlistOffer, enrollment = null } = {}) {
  const hooks = []; let cursor = 0; const effects = [];
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useEffect(fn) { const i = cursor++; if (!(i in hooks)) { hooks[i] = true; effects.push(fn); } },
  };
  const Component = loadModule('src/components/membership/FoundingMembership.tsx', {
    react, 'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/script': () => null, '@/lib/founding-membership': membership, '@/lib/birthdate': birthdate,
    './founding.module.css': {},
  }, { React: react, crypto: { randomUUID: () => 'new-child-id' }, fetch: async () => Response.json({
    offer, enrollment, config: null,
    household: { email: 'existing@example.test', phone: '+18605550123', city: 'West Hartford', state: 'CT' },
    people: [{ id: 'saved-adult', role: 'adult', first_name: 'Parent', last_name: 'Family', gender: 'female' },
      { id: 'saved-child', role: 'child', first_name: 'Sam', last_name: 'Family', gender: 'male', birthdate: '2023-01-01' }],
  }, { status: signedIn ? 200 : 401 }) }).default;
  const render = () => { cursor = 0; return Component({ audience }); };
  render(); effects.splice(0).forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  const tree = render();
  const nodes = [];
  const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!React.isValidElement(node)) return; nodes.push(node); visit(node.props.children); };
  visit(tree);
  return { html: renderToStaticMarkup(tree), nodes };
}

test('each unlisted entry route selects its own audience and forbids indexing', () => {
  for (const audience of ['waitlist', 'public']) {
    const route = loadModule(`src/app/(public)/founding-membership/${audience}/page.tsx`, {
      '@/components/membership/FoundingMembership': () => null,
    }, { React });
    assert.equal(route.default().props.audience, audience);
    assert.equal(route.metadata.robots.index, false);
    assert.equal(route.metadata.robots.follow, false);
  }
});

test('guest pages advertise separate prices and return both sign-in and signup to the exact entry URL', async () => {
  for (const [audience, sibling] of [['waitlist', 10], ['public', 20]]) {
    const view = await entry(audience);
    assert.match(view.html, new RegExp(`\\+\\$${sibling}/mo`));
    assert.match(view.html, /Pay \$0 today/);
    for (const mode of ['existing', 'new']) {
      const expected = `/login?mode=${mode}&next=${encodeURIComponent(`/founding-membership/${audience}`)}`;
      assert.ok(view.nodes.some(node => node.props.href === expected));
    }
    assert.equal(view.nodes.some(node => node.type === 'form'), false);
  }
});

test('signed-in families keep saved profile and child identities; account eligibility overrides either entry URL', async () => {
  const waitlist = await entry('public', { signedIn: true, offer: { ...waitlistOffer, can_enroll: true } });
  assert.match(waitlist.html, /Your account qualifies for original Wanderlist pricing/);
  assert.equal(waitlist.nodes.find(node => node.props.id === 'founding-email').props.value, 'existing@example.test');
  assert.equal(waitlist.nodes.find(node => node.props.id === 'founding-email').props.readOnly, true);
  assert.equal(waitlist.nodes.find(node => node.props.id === 'first-saved-child').props.value, 'Sam');
  assert.equal(waitlist.nodes.find(node => node.props.id === 'birth-saved-child').props.value, '01/01/2023');
  const general = await entry('waitlist', { signedIn: true, offer: { phase: 'public', tier: 'public', can_enroll: true, base_cents: 5000, sibling_cents: 2000 } });
  assert.match(general.html, /Your account qualifies for public founding pricing/);
  assert.match(general.html, /\+\$20\/mo/);
  assert.equal(general.nodes.find(node => node.props.type === 'submit').props.disabled, true);
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
