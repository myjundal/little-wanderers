import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

export function loadModule(filename, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: name => {
      if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
      return mocks[name];
    },
    Response, URL, URLSearchParams, Date, Error, ...globals,
  }, { filename });
  return exports;
}

export const classConfig = loadModule('src/lib/class-config.ts');
export const fixtureClass = {
  id: 'painting', title: 'Little Hands, Big Canvases', category: 'Art',
  start_time: '2099-11-12T22:00:00Z', end_time: '2099-11-12T22:45:00Z',
  duration_minutes: 45, instructor_name: 'Ms. Jamie', description: 'Painting together.',
  age_range: '2–4 years', caregiver_participation: 'Caregiver required',
  schedule_note: null, schedule_label: 'Thursdays at 5pm', capacity: 7,
  price_cents: 15000, booked_count: 7, seats_left: 0, waitlist_count: 2,
  is_popular: false, recommended_class_ids: [], status: 'scheduled',
};
export const fixtureChild = { id: 'child', first_name: 'Sam', last_name: 'Family', birthdate: '2023-01-01' };

export async function classPageHarness({
  guardian = { first_name: 'Parent', last_name: 'Family' },
  children = [fixtureChild],
  register = async () => Response.json({ ok: true, id: 'registration', status: 'preregistered', email: { ok: true } }),
  saveChild = async () => Response.json({ ok: true, child: fixtureChild }),
  failRefresh = false,
  paymentsEnabled = false,
  classItems = [fixtureClass],
  registrations = [],
  initialSearch = '',
  checkout = async () => Response.json({ok:true,payment_url:'https://square.link/u/test-checkout'}),
} = {}) {
  const hooks = [];
  let cursor = 0;
  let tree;
  const effects = [];
  const requests = [];
  let focused;
  let posted = false;
  let redirected;
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!hooks[index] || !deps || deps.some((value, i) => !Object.is(value, hooks[index].deps?.[i]))) {
      hooks[index] = { value: factory(), deps };
    }
    return hooks[index].value;
  };
  const toast = function ActionToast() {};
  const react = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, update => {
        hooks[index].value = typeof update === 'function' ? update(hooks[index].value) : update;
      }];
    },
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      memo(() => { effects.push(fn); }, deps);
    },
  };
  const page = loadModule('src/app/landing/classschedule/page.tsx', {
    react,
    'next/link': function Link() {},
    '@/lib/class-config': classConfig,
    '@/lib/child-age': loadModule('src/lib/child-age.ts'),
    '@/lib/supabase/browser': {},
    '@/components/ui/ActionToast': toast,
    '@/components/classes/PreRegistrationNotice': function Notice() {},
  }, {
    React: react, AbortController,
    document: { getElementById: id => ({ scrollIntoView() {}, focus() { focused = id; } }) },
    window: { location: { search: initialSearch, href: `https://test.example/landing/classschedule${initialSearch}`, assign(url) { redirected=url; } },
      history: { replaceState() {} }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/classes/checkout') return JSON.parse(options.body).mode==='current' ? Response.json({ok:true,checkout:null}) : checkout(options);
      if (url === '/api/classes/register') { posted = true; return register(options); }
      if (url === '/api/family/children') return saveChild(options);
      if (posted && failRefresh) throw new Error('Refresh offline');
      if (url.startsWith('/api/classes?')) return Response.json({ ok: true, items: classItems, payments_enabled: paymentsEnabled });
      if (url.startsWith('/api/classes/my')) return Response.json({ ok: true, items: registrations });
      if (url.startsWith('/api/family/profile')) return Response.json({ ok: true, guardian, children });
      throw new Error(`Unexpected request: ${url}`);
    },
  }).default;
  const render = () => {
    cursor = 0;
    tree = page();
    effects.splice(0).forEach(effect => effect());
  };
  const flush = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setImmediate(resolve));
      render();
    }
  };
  const all = predicate => {
    const found = [];
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      if (predicate(node)) found.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return found;
  };
  const button = () => all(node => node.type === 'button' && /^(Pre-register|Pre-registered|Saving\.\.\.)$/.test(node.props.children))[0];
  render();
  await flush();
  return {
    requests, flush, button,
    payButton: () => all(node => node.type === 'button' && typeof node.props.children === 'string' && /^(Pay \$|Registered$)/.test(node.props.children))[0],
    get redirected() { return redirected; },
    get tree() { return tree; },
    click: () => button().props.onClick(),
    field(id, value) {
      const input = all(node => node.props.id === id)[0];
      if (!input) throw new Error(`Missing field: ${id}`);
      input.props.onChange({ target: { value } });
      render();
    },
    get focused() { return focused; },
    get toast() { return all(node => node.type === toast)[0].props; },
    feedback: () => all(node => node.props.role === 'alert' || node.props.role === 'status').map(node => node.props.children).join(' '),
  };
}
