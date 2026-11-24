import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import React from 'react';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

function harness({ failFirst = false, storage = new Map() } = {}) {
  const hooks = [], effects = [], requests = [];
  let cursor = 0, tree;
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = cursor++; if (!(i in hooks) || deps.some((value, index) => !Object.is(value, hooks[i].deps[index]))) { hooks[i] = { deps }; effects.push(fn); } },
  };
  const birthdate = loadModule('src/lib/birthdate.ts');
  const content = loadModule('src/lib/waiver-content.ts');
  const formHelper = loadModule('src/lib/guest-waiver-form.ts', { zod: { z }, '@/lib/birthdate': birthdate, '@/lib/waiver-content': content });
  const Form = loadModule('src/components/waivers/GuestWaiverForm.tsx', {
    react, 'next/link': 'a', '@/lib/birthdate': birthdate, '@/lib/guest-waiver-form': formHelper,
    '@/lib/waiver-content': loadModule('src/lib/waiver-content.ts'), '@/app/landing/waiver/waiver.module.css': {},
  }, { React: react, crypto,
    window: { location: { search: '?party=2af2cb2b-db0b-4d28-bfa2-fb23d50c00bc' }, scrollTo() {}, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); requests.push({ url, body });
      if (failFirst && requests.filter(item => item.body.mode === 'submit').length === 1 && body.mode === 'submit') return Response.json({ ok: false, error: 'Connection lost. Please retry.' }, { status: 503 });
      return Response.json({ ok: true, completed: body.mode !== 'submission_status', expires_at: '2027-01-30T12:00:00Z' });
    },
  }).default;
  const render = () => { cursor = 0; tree = Form(); effects.splice(0).forEach(fn => fn()); };
  const all = () => { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!React.isValidElement(node)) return; found.push(node); visit(node.props.children); }; visit(tree); return found; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  const field = (label, value) => {
    const node = all().find(node => node.type === 'label' && text(node).startsWith(label));
    const input = React.Children.toArray(node.props.children).find(child => child.type === 'input');
    input.props.onChange({ target: { value } }); render();
  };
  const fill = () => {
    for (const [label, value] of [['Parent or legal guardian', 'parent@example.test'], ['Guardian first name', 'Parent'], ['Guardian last name', 'Example'], ['Phone number', '+18605551234'], ['Child first name', 'Sam'], ['Child last name', 'Example'], ['Birthday', '01/01/2023'], ['Your full legal name', 'Parent Example']]) field(label, value);
    const checkboxCount = all().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.required).length;
    for (let i = 0; i < checkboxCount; i++) { all().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.required)[i].props.onChange({ target: { checked: true } }); render(); }
    all().filter(node => node.type === 'input' && node.props.type === 'radio')[1].props.onChange(); render();
  };
  render(); render();
  return { render, requests, all, storage, field, text: () => text(tree), fill,
    remember: checked => { all().find(node => node.type === 'input' && node.props.type === 'checkbox' && !node.props.required).props.onChange({ target: { checked } }); render(); },
    submit: () => all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    clear: () => all().find(node => node.type === 'button' && text(node).includes('Done · clear')).props.onClick(),
  };
}

test('guest sees the complete family and signature form immediately, with no verification step', () => {
  const h = harness();
  assert.match(h.text(), /Guardian first name/); assert.match(h.text(), /Child first name/); assert.match(h.text(), /Electronic signature/);
  assert.match(h.text(), /No account or membership is needed/);
  assert.match(h.text(), /use the same email as your reservation/);
  assert.doesNotMatch(h.text(), /Open your family’s waiver|using the same account as your reservation/);
  assert.doesNotMatch(h.text(), /Email my waiver code|Six-digit|Verify email|Email verified/);
  assert.equal(h.requests.length, 0);
});

test('one submit sends contact details and explicit consent directly without a code; clearing removes personal details', async () => {
  const h = harness(); h.fill();
  await Promise.all([h.submit(), h.submit()]); h.render();
  assert.equal(h.requests.length, 1);
  const body = h.requests[0].body;
  assert.equal(body.mode, 'submit'); assert.equal(body.email, 'parent@example.test'); assert.equal(body.party_id, '2af2cb2b-db0b-4d28-bfa2-fb23d50c00bc');
  assert.equal(body.photo_consent, false); assert.equal(body.signature, 'Parent Example'); assert.equal(body.children[0].birthdate, '01/01/2023');
  assert.ok(Object.values(body.agreements).every(Boolean)); assert.equal(Object.keys(body.agreements).length, 7);
  assert.match(h.text(), /Waiver saved/);
  await h.clear(); await new Promise(resolve => setImmediate(resolve)); h.render();
  assert.doesNotMatch(h.text(), /Waiver saved/);
  assert.ok(h.all().filter(node => node.type === 'input' && !node.props.type?.includes('radio') && node.props.type !== 'checkbox').every(node => node.props.value === ''));
  assert.equal(h.requests[1].body.mode, 'end_session');
});

test('a failed submission preserves input and retries with the same idempotency key', async () => {
  const h = harness({ failFirst: true }); h.fill(); await h.submit(); h.render();
  assert.match(h.text(), /Connection lost/);
  assert.ok(h.all().some(node => node.type === 'input' && node.props.value === 'parent@example.test'));
  await h.submit(); h.render();
  assert.equal(h.requests[0].body.submission_id, h.requests[1].body.submission_id);
  assert.match(h.text(), /Waiver saved/);
});


test('invalid details and missed consent identify exact fields without sending a submission', async () => {
  const h = harness();
  await h.submit(); h.render();
  assert.equal(h.requests.length, 0);
  assert.match(h.text(), /Your waiver has not been submitted/);
  assert.ok(h.all().some(node => node.type === 'a' && node.props.href === '#child-0-birthday'));
  assert.ok(h.all().some(node => node.type === 'input' && node.props.id === 'email' && node.props['aria-invalid']));
  h.fill(); h.field('Birthday', '02/30/2023');
  await h.submit(); h.render();
  assert.equal(h.requests.length, 0);
  assert.match(h.text(), /birthday as MM\/DD/);
  h.field('Birthday', '02/28/2023');
  await h.submit(); h.render();
  assert.equal(h.requests.filter(item => item.body.mode === 'submit').length, 1);
});

test('personal device opt-in restores only family details and never restores signature or consent', async () => {
  const h = harness(); h.fill();
  const key = 'lw_guest_waiver_draft:2af2cb2b-db0b-4d28-bfa2-fb23d50c00bc';
  assert.equal(h.storage.has(key), false);
  h.remember(true);
  const saved = JSON.parse(h.storage.get(key));
  assert.equal(saved.family.email, 'parent@example.test');
  assert.equal(saved.family.children[0].first_name, 'Sam');
  for (const sensitive of ['signature', 'agreements', 'guardian', 'electronic', 'photo']) assert.equal(sensitive in saved.family, false);
  const restored = harness({ storage: h.storage });
  await new Promise(resolve => setImmediate(resolve)); restored.render();
  assert.match(restored.text(), /unfinished family details were restored/);
  assert.equal(restored.all().find(node => node.type === 'input' && node.props.id === 'email').props.value, 'parent@example.test');
  assert.equal(restored.all().find(node => node.type === 'input' && node.props.id === 'signature').props.value, '');
  assert.ok(restored.all().filter(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.required).every(node => !node.props.checked));
  restored.remember(false);
  assert.equal(h.storage.has(key), false);
});

test('successful signing removes the saved family draft', async () => {
  const h = harness(); h.fill(); h.remember(true);
  assert.ok([...h.storage.keys()].some(key => key.startsWith('lw_guest_waiver_draft:')));
  await h.submit(); h.render();
  assert.ok(![...h.storage.keys()].some(key => key.startsWith('lw_guest_waiver_draft:')));
});
