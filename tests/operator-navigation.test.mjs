import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const navigation = loadModule('src/lib/operator-navigation.ts');
const Nav = loadModule('src/components/staff/StaffToolNav.tsx', {
  'next/link': 'a', '@/lib/operator-navigation': navigation, './operator-navigation.module.css': {},
}, { React }).default;
const Dashboard = loadModule('src/components/staff/OperatorDashboard.tsx', {
  'next/link': 'a', './StaffToolNav': Nav, './StaffPortal.module.css': {},
}, { React }).default;
const links = html => [...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map(match => [match[1], match[2]]);
const expected = [
  ['/', 'Main homepage'], ['/staff/checkin', 'Check-in &amp; occupancy management'],
  ['/staff/parties', 'Party management'], ['/staff/families', 'Family management'], ['/staff/classes', 'Class management'],
  ['/landing/party', 'My parties'], ['/landing/classschedule', 'My classes'],
];

test('dashboard, hamburger, and quick menus share the same five management links followed by personal bookings', () => {
  for (const variant of ['dashboard', 'menu', 'quick']) {
    const html = renderToStaticMarkup(React.createElement(Nav, { variant, includePersonal: true, active: 'families' }));
    assert.deepEqual(links(html), expected);
    assert.match(html, /href="\/staff\/families"[^>]+aria-current="page"/);
    assert.doesNotMatch(html, /href="\/staff\/dashboard"|href="\/staff\/occupancy"/);
    assert.ok(html.indexOf('My bookings') > html.indexOf('Class management'));
  }
});

test('personal owners and staff see personal bookings; shared PIN sessions keep operational links', () => {
  for (const role of ['staff', 'owner', 'admin']) {
    for (const isKiosk of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(Dashboard, { role, roles: [role], isKiosk }));
      assert.deepEqual(links(html).slice(0, isKiosk ? 5 : 7), expected.slice(0, isKiosk ? 5 : 7));
      assert.equal(html.includes('My parties'), !isKiosk);
      assert.equal(html.includes('My classes'), !isKiosk);
      assert.equal(html.includes('href="/staff/team"'), role !== 'staff');
      assert.match(html, /<details/);
    }
  }
});

test('personal login immediately renders the shared operator dashboard before customer widgets finish loading', () => {
  const react = { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {} };
  for (const role of ['staff', 'owner']) {
    const Page = loadModule('src/app/landing/page.tsx', {
      react, 'next/link': 'a', '@/components/staff/OperatorDashboard': Dashboard,
      '@/app/teaching/page': () => null, '@/lib/supabase/browser': {}, '@/components/crowd/CrowdLevelCard': () => null,
      '@/components/landing/BookingNextSteps': () => null, '@/lib/feature-flags': {}, '@/lib/households': {},
      '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ isLoading: false, canUseOwnerDashboard: true, role, roles: [role], isKiosk: false }) },
      '@/lib/waivers': {},
    }, { React: react }).default;
    const result = Page();
    assert.equal(result.type, Dashboard);
    assert.equal(result.props.role, role);
    assert.equal(result.props.isKiosk, false);
  }
});

test('PIN dashboard uses the same dashboard component and identity', async () => {
  const Page = loadModule('src/app/staff/dashboard/page.tsx', {
    '@/lib/authz': { getCurrentUserRole: async () => ({ role: 'staff', roles: ['staff'], isKiosk: true }) },
    '@/components/staff/OperatorDashboard': Dashboard,
  }, { React }).default;
  const page = await Page();
  assert.equal(page.type, Dashboard);
  assert.equal(page.props.isKiosk, true);
});

test('hamburger closes on navigation and includes personal bookings for a personal operator login', () => {
  let open = true;
  const react = { ...React, useState: () => [open, value => { open = value; }] };
  const Menu = loadModule('src/components/landing/LandingMoreMenu.tsx', {
    react, 'next/link': 'a', 'next/image': 'img', '@/lib/feature-flags': {},
    '@/components/staff/StaffToolNav': Nav,
    '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ isLoading: false, canUseOwnerDashboard: true, isKiosk: false }) },
  }, { React: react }).default;
  const tree = Menu();
  const html = renderToStaticMarkup(tree);
  assert.deepEqual(links(html), expected);
  const menu = React.Children.toArray(React.Children.toArray(tree.props.children)[1].props.children).find(node => node.type === Nav);
  menu.props.onNavigate();
  assert.equal(open, false);
});

test('quick menu handles personal routes, nested family pages, and role visibility', () => {
  assert.equal(navigation.activeOperatorLink('/staff/families/family-id'), 'families');
  assert.equal(navigation.activeOperatorLink('/landing/party'), 'my-parties');
  assert.equal(navigation.activeOperatorLink('/landing/classschedule'), 'my-classes');
  for (const canUseOwnerDashboard of [false, true]) {
    const Quick = loadModule('src/components/staff/StaffQuickNav.tsx', {
      'next/navigation': { usePathname: () => '/staff/checkin' },
      '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ canUseOwnerDashboard, isKiosk: false }) },
      '@/lib/operator-navigation': navigation, './StaffToolNav': Nav, './operator-navigation.module.css': {},
    }, { React }).default;
    assert.deepEqual(links(renderToStaticMarkup(React.createElement(Quick))), canUseOwnerDashboard ? expected : []);
  }
});

test('old Tools and Occupancy URLs redirect into the dashboard and integrated check-in workspace', () => {
  for (const [source, destination] of [['src/app/staff/page.tsx', '/staff/dashboard'], ['src/app/staff/occupancy/page.tsx', '/staff/checkin?view=occupancy']]) {
    const Page = loadModule(source, { 'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } } }).default;
    assert.throws(() => Page(), { message: `redirect:${destination}` });
  }
});
