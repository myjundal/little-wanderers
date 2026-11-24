import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

function harness({ status = 'required', promptKey = 'saved-booking', fail = false } = {}) {
  const hooks = [], effects = [], requests = [], events = new Map();
  let cursor = 0, tree, modalShows = 0, focused = 0;
  const modal = { open: false, showModal() { this.open = true; modalShows++; }, close() { this.open = false; } };
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = cursor++; if (!(i in hooks) || deps.some((v, j) => !Object.is(v, hooks[i].deps[j]))) { hooks[i] = { deps }; effects.push(fn); } },
  };
  const Component = loadModule('src/components/waivers/BookingWaiverNextStep.tsx', {
    react, 'next/link': 'a', './booking-waiver-next-step.module.css': {},
  }, { React: react, window: { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) },
    fetch: async (url, options) => { requests.push({ url, options }); return Response.json(fail ? { error: 'Offline' } : { waiver: { status } }, { status: fail ? 503 : 200 }); },
  }).default;
  const nodes = () => { const found = []; const visit = n => { if (Array.isArray(n)) return n.forEach(visit); if (!React.isValidElement(n)) return; found.push(n); visit(n.props.children); }; visit(tree); return found; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : React.isValidElement(n) ? text(n.props.children) : typeof n === 'string' ? n : '';
  const render = () => {
    cursor = 0; tree = Component({ returnTo: '/landing/open-play', reservationId: 'reservation-id', promptKey });
    for (const node of nodes()) if (node.props.ref) node.props.ref.current = node.type === 'dialog' ? modal : { focus() { focused++; } };
    effects.splice(0).forEach(fn => fn());
  };
  render();
  return { requests, nodes, text: () => text(tree), render, modal, get modalShows() { return modalShows; }, get focused() { return focused; },
    settle: async () => { await new Promise(setImmediate); render(); },
    refresh: async next => { status = next; await events.get('focus')(); render(); },
  };
}

test('a newly saved booking prompts only missing or expired waivers and keeps the account and booking return path', async () => {
  for (const status of ['required', 'expired']) {
    const h = harness({ status }); await h.settle();
    assert.equal(h.modal.open, true); assert.equal(h.modalShows, 1);
    assert.match(h.text(), /reservation is saved/);
    const links = h.nodes().filter(n => n.type === 'a'); assert.equal(links.length, 2);
    for (const link of links) { const url = new URL(link.props.href, 'https://example.test'); assert.equal(url.pathname, '/landing/waiver'); assert.equal(url.searchParams.get('reservation'), 'reservation-id'); assert.equal(url.searchParams.get('return_to'), '/landing/open-play'); }
    h.nodes().find(n => n.type === 'button' && String(n.props.children).includes('before my visit')).props.onClick();
    assert.equal(h.modal.open, false); assert.equal(h.focused, 1);
    h.render(); assert.equal(h.modalShows, 1); assert.equal(h.nodes().filter(n => n.type === 'a').length, 2);
    assert(h.requests.every(r => r.url === '/api/waivers' && !r.options.method));
  }
});

test('valid existing waivers skip the prompt and signing action; returning from signing refreshes status', async () => {
  const complete = harness({ status: 'completed' }); await complete.settle();
  assert.equal(complete.modalShows, 0); assert.match(complete.text(), /Family waiver completed/);
  assert.equal(complete.nodes().filter(n => n.type === 'a').length, 0);
  const pending = harness(); await pending.settle(); await pending.refresh('completed');
  assert.equal(pending.modal.open, false); assert.match(pending.text(), /ready for check-in/);
});

test('existing reservations retain a clear next step without automatically opening a dialog', async () => {
  const existing = harness({ promptKey: '' }); await existing.settle();
  assert.equal(existing.modalShows, 0); assert.match(existing.text(), /Continue to family waiver/);
});

test('lookup failure never reports a completed waiver and keeps recovery available without a modal', async () => {
  const h = harness({ fail: true }); await h.settle();
  assert.equal(h.modalShows, 0); assert.match(h.text(), /couldn’t check your waiver/);
  assert.doesNotMatch(h.text(), /Family waiver completed/);
  assert(h.nodes().some(n => n.type === 'button' && n.props.children === 'Try again'));
  assert(h.nodes().some(n => n.type === 'a' && String(n.props.children).includes('Check / complete')));
});
