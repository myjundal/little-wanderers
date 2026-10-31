import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

test('class route admits staff, owner and admin while rejecting other roles', async () => {
  for (const role of ['staff', 'owner', 'admin', 'user', 'instructor', null]) {
    const { default: Layout } = loadModule('src/app/staff/classes/layout.tsx', {
      'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
      '@/lib/authz': {
        getCurrentUserRole: async () => ({ role }),
        isStaffRole: value => ['staff', 'owner', 'admin'].includes(value),
      },
    }, { React });
    if (['staff', 'owner', 'admin'].includes(role)) {
      assert.equal((await Layout({ children: 'roster' })).props.children, 'roster');
    } else {
      await assert.rejects(Layout({ children: 'roster' }), /redirect:\/staff/);
    }
  }
});

test('server page gives management controls and instructor assignments to owners/admins only', async () => {
  function Dashboard() {}
  function Assignments() {}
  for (const role of ['staff', 'owner', 'admin']) {
    const { default: Page } = loadModule('src/app/staff/classes/page.tsx', {
      '@/components/staff/InstructorAssignments': Assignments,
      '@/components/staff/StaffDashboard': Dashboard,
      '@/components/staff/StaffToolNav': () => null,
      '@/lib/authz': { getCurrentUserRole: async () => ({ role }) },
    }, { React });
    const page = await Page();
    const children = React.Children.toArray(page.props.children);
    assert.equal(children.find(child => child.type === Dashboard).props.canManageClasses, role !== 'staff');
    assert.equal(children.some(child => child.type === Assignments), role !== 'staff');
  }
});

test('staff see names, dates and family links without management navigation or session buttons', () => {
  const { default: Roster } = loadModule('src/components/classes/ClassPreRegistrationRosters.tsx', {
    react: React,
    'next/link': props => React.createElement('a', { href: props.href }, props.children),
    '@/lib/class-rosters': loadModule('src/lib/class-rosters.ts'),
    './class-rosters.module.css': {},
  }, { React });
  const sessions = [{ id: 'class', title: 'Art', startTime: '2026-11-12T22:00:00Z', endTime: '2026-11-12T22:45:00Z', status: 'scheduled', registrations: [{ id: 'interest', personId: 'child', name: 'Sam Family', status: 'preregistered', householdId: 'family' }] }];
  const markup = renderToStaticMarkup(React.createElement(Roster, { sessions, showFamilyLinks: true, onRefresh() {} }));
  assert.match(markup, /Sam Family/);
  assert.match(markup, /Nov 12/);
  assert.match(markup, /\/staff\/families\/family/);
  assert.doesNotMatch(markup, /aria-label="Open|Schedule &amp; attendance/);
});

async function dashboardHarness(canManageClasses) {
  const hooks = [];
  const effects = [];
  let cursor = 0;
  let tree;
  const memo = (read, deps) => {
    const i = cursor++;
    if (!hooks[i] || deps.some((dep, j) => !Object.is(dep, hooks[i].deps[j]))) {
      hooks[i] = { value: read(), deps };
    }
    return hooks[i].value;
  };
  const react = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, next => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }];
    },
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => memo(() => { effects.push(fn); }, deps),
  };
  function Roster() {}
  function Switcher() {}
  const requests = [];
  const { default: Dashboard } = loadModule('src/components/staff/StaffDashboard.tsx', {
    react,
    'next/link': () => null,
    '@/components/staff/StaffFamilyRegistration': () => null,
    '@/components/waivers/PartyGuestWaivers': () => null,
    '@/components/classes/ClassPreRegistrationRosters': { __esModule: true, default: Roster, ClassViewSwitcher: Switcher },
  }, {
    React: react,
    fetch: async url => { requests.push(url); return Response.json({ ok: true, items: [] }); },
    document: { getElementById: () => null },
  });
  const render = () => {
    cursor = 0;
    tree = Dashboard({ view: 'classes', canManageClasses });
    effects.splice(0).forEach(fn => fn());
  };
  const find = predicate => {
    const matches = [];
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      if (predicate(node)) matches.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return matches;
  };
  render();
  await new Promise(resolve => setImmediate(resolve));
  render();
  return { render, requests, roster: () => find(node => node.type === Roster)[0], switcher: () => find(node => node.type === Switcher)[0], management: () => find(node => node.props.id === 'class-management')[0] };
}

test('staff dashboard loads its roster but cannot enter owner schedule controls', async () => {
  const staff = await dashboardHarness(false);
  assert.deepEqual(staff.requests, ['/api/admin/classes']);
  assert.ok(staff.roster());
  assert.equal(staff.roster().props.onSessionSelect, undefined);
  assert.equal(staff.switcher(), undefined);
  assert.equal(staff.management(), undefined);
  const owner = await dashboardHarness(true);
  assert.equal(typeof owner.roster().props.onSessionSelect, 'function');
  owner.switcher().props.onChange('sessions');
  owner.render();
  assert.ok(owner.management());
});
