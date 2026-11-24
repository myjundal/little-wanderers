import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const content = loadModule('src/lib/waiver-content.ts');
const css = '@/app/landing/waiver/waiver.module.css';
const Agreements = loadModule('src/components/waivers/WaiverAgreements.tsx', { '@/lib/waiver-content': content, [css]: {} }, { React }).default;

function harness({ search = '' } = {}) {
  let cursor = 0, tree;
  const hooks = [], effects = [], requests = [];
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { value: initial }; return [hooks[index].value, value => { hooks[index].value = value; }]; },
    useEffect(fn) { const index = cursor++; if (!(index in hooks)) { hooks[index] = {}; effects.push(fn); } },
  };
  const Page = loadModule('src/app/landing/waiver/page.tsx', {
    react, 'next/link': 'a', '@/components/waivers/WaiverAgreements': Agreements,
    '@/lib/waiver-content': content, './waiver.module.css': {},
  }, { React: react, window: { location: { search }, scrollTo() {} },
    fetch: async (_url, options) => {
      if (options?.method === 'POST') { requests.push(JSON.parse(options.body)); return Response.json({ waiver: { status: 'completed', expiresAt: '2027-01-01' } }); }
      return Response.json({ children: [{ id: 'child', first_name: 'Child' }], family_revision: 'revision', can_sign: true, waiver: { status: 'required' } });
    },
  }).default;
  const render = () => { cursor = 0; tree = Page(); effects.splice(0).forEach(fn => fn()); };
  const all = () => { const nodes = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!React.isValidElement(node)) return; nodes.push(node); visit(typeof node.type === 'function' ? node.type(node.props) : node.props.children); }; visit(tree); return nodes; };
  render();
  return { render, all, requests, submit: () => all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) };
}

test('single acknowledgement maps true and false to every existing consent field', () => {
  for (const checked of [false, true]) {
    const consent = content.getWaiverConsent(checked);
    assert.equal(consent.is_guardian, checked);
    assert.equal(consent.electronic_consent, checked);
    assert.equal(Object.keys(consent.agreements).length, 7);
    assert.ok(Object.values(consent.agreements).every(value => value === checked));
  }
});

test('signed-in waiver has one required checkbox, keeps photos separate, and requires a fresh acknowledgement on renewal', async () => {
  const h = harness(); await new Promise(resolve => setImmediate(resolve)); h.render();
  const inputs = () => h.all().filter(node => node.type === 'input');
  const consent = () => inputs().find(node => node.props.type === 'checkbox');
  assert.equal(inputs().filter(node => node.props.type === 'checkbox').length, 1);
  assert.equal(consent().props.checked, false);
  inputs().find(node => node.props.id === 'signature').props.onChange({ target: { value: 'Parent Test' } }); h.render();
  await h.submit(); h.render(); assert.equal(h.requests.length, 0);
  consent().props.onChange({ target: { checked: true } }); h.render();
  await h.submit(); h.render(); assert.equal(h.requests.length, 0);
  inputs().filter(node => node.props.type === 'radio')[1].props.onChange(); h.render();
  await h.submit(); h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].is_guardian, true);
  assert.equal(h.requests[0].electronic_consent, true);
  assert.equal(h.requests[0].photo_consent, false);
  assert.ok(Object.values(h.requests[0].agreements).every(Boolean));
  h.all().find(node => node.type === 'button').props.onClick(); h.render();
  assert.equal(consent().props.checked, false);
  assert.equal(inputs().find(node => node.props.id === 'signature').props.value, '');
});


test('booking waiver returns to the original reservation screen and ignores untrusted return URLs', async () => {
  for (const [search, expected] of [
    ['?reservation=saved&return_to=%2Flanding%2Fopen-play', '/landing/open-play'],
    ['?reservation=saved&return_to=%2Flanding%2Fsoft-opening', '/landing/soft-opening'],
    ['?return_to=%2Flanding%2Fclassschedule', '/landing/classschedule'],
    ['?reservation=saved', '/landing/open-play'],
    ['?reservation=saved&return_to=https%3A%2F%2Fexample.test', '/landing/open-play'],
    ['?return_to=%2Fstaff%2Fdashboard', '/landing'],
  ]) {
    const h = harness({ search }); await new Promise(setImmediate); h.render();
    const links = h.all().filter(node => node.type === 'a');
    assert.equal(links[0].props.href, expected);
    assert.ok(links.every(link => !link.props.href.startsWith('https:')));
  }
});
