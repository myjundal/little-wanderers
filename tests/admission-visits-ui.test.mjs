import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const logic = loadModule('src/lib/admission-stays.ts');
const base = { household_id: 'family', household_name: 'Gardner', checked_in_at: '2026-11-11T15:00:00Z', checked_out_at: null,
  price_cents: 1600, payment_status: 'due', name: 'Alondra' };
const react = { ...React, useState: value => [typeof value === 'function' ? value() : value, () => {}], useEffect() {} };
const Component = loadModule('src/components/staff/AdmissionVisits.tsx', { react, '@/lib/admission-stays': logic, './admission-visits.module.css': { default: {} } }, { React }).default;
function inspect(tree) {
  const nodes = [];
  const text = node => Array.isArray(node) ? node.map(text).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children) : String(node);
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children); };
  walk(tree);
  return { nodes, text, fullText: text(tree) };
}

test('active families are separate from departed families and checkout selects only guests still here', () => {
  let selected;
  const view = inspect(Component({ visits: [{ ...base, id: 'one' }, { ...base, id: 'two', name: 'Child', checked_out_at: '2026-11-11T16:30:00Z' },
    { ...base, id: 'three', household_id: 'other', household_name: 'Departed family', name: 'Other', checked_out_at: '2026-11-11T17:00:00Z' }],
    ready: true, locked: false, checkingOut: '', onCheckout: (...args) => { selected = args; }, onOpenFamily() {}, onRefresh() {} }));
  assert.ok(view.fullText.includes('1 family · 1 guests here now'));
  assert.ok(view.fullText.includes('Checked out today · 1 family'));
  assert.ok(view.fullText.includes('2 hrs'));
  const checkout = view.nodes.find(node => node.type === 'button' && view.text(node).includes('Check out family'));
  checkout.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), ['family', ['one']]);
  assert.equal(view.nodes.filter(node => node.type === 'button' && view.text(node).includes('Check out family')).length, 1);
  assert.ok(view.fullText.includes('Admission payment still due'));
});

test('checkout is disabled until current arrival and departure status is available', () => {
  for (const settings of [{ ready: false, locked: false }, { ready: true, locked: true }]) {
    const view = inspect(Component({ ...settings, visits: [{ ...base, id: 'one' }], checkingOut: '', onCheckout() {}, onOpenFamily() {}, onRefresh() {} }));
    const checkout = view.nodes.find(node => node.type === 'button' && view.text(node).includes('Check out family'));
    assert.equal(checkout.props.disabled, true);
  }
});
