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
  './MembershipManagementSummary': 'membership-summary',
  'next/link': 'a', './StaffToolNav': Nav, './StaffPortal.module.css': {},
}, { React }).default;
const links = html => [...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map(match => [match[1], match[2]]);
const expected = [
  ['/', 'Main homepage'], ['/staff/dashboard', 'My dashboard'],
  ['/staff/admin', 'Timecard &amp; admin'], ['/staff/checkin', 'Check-in &amp; occupancy management'],
  ['/staff/open-play-reservations', 'Open Play reservations'],
  ['/staff/parties', 'Party management'], ['/staff/families', 'Family management'], ['/staff/classes', 'Class management'],
  ['/landing/party', 'My parties'], ['/landing/classschedule', 'My classes'],
];
const expectedQuick = [['/staff/dashboard', 'My dashboard'], ['/staff/checkin', 'Check-in']];

test('dashboard and hamburger keep full menus; quick menu only shows dashboard and check-in', () => {
  for (const variant of ['dashboard', 'menu', 'quick']) {
    const html = renderToStaticMarkup(React.createElement(Nav, { variant, includePersonal: true, active: 'families' }));
    assert.deepEqual(links(html), variant === 'quick' ? expectedQuick : expected);
    if (variant !== 'quick') assert.match(html, /href="\/staff\/families"[^>]+aria-current="page"/);
    assert.doesNotMatch(html, /href="\/staff\/occupancy"/);
    assert.equal(html.includes('My bookings'), variant !== 'quick');
  }
});

test('personal owners and staff see personal bookings; shared PIN sessions keep operational links', () => {
  for (const role of ['staff', 'owner', 'admin']) {
    for (const isKiosk of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(Dashboard, { role, roles: [role], isKiosk }));
      const menu = expected.slice(0, 8);
      if (role !== 'staff') menu.push(['/staff/founding-memberships', 'Membership management']);
      if (!isKiosk) menu.push(...expected.slice(8));
      assert.deepEqual(links(html), menu);
      assert.equal(html.includes('membership-summary'), role !== 'staff');
      assert.equal(html.includes('My parties'), !isKiosk);
      assert.equal(html.includes('My classes'), !isKiosk);
      assert.doesNotMatch(html, /href="\/employee"|href="\/staff\/team"|href="\/staff\/campaigns"/);
      assert.doesNotMatch(html, /<details/);
      assert.equal((html.match(/Timecard &amp; admin/g) ?? []).length, 1);
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
      '@/components/membership/FoundingMembershipSummary': () => null,
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
    '@/lib/revenue-access': { canViewRevenue: () => false },
    '@/components/staff/OperatorDashboard': Dashboard,
  }, { React }).default;
  const page = await Page();
  assert.equal(page.type, Dashboard);
  assert.equal(page.props.isKiosk, true);
  assert.equal(page.props.canViewPrivateRevenue, false);
});

test('hamburger closes on navigation and includes personal bookings for a personal operator login', () => {
  let open = true;
  const react = { ...React, useState: () => [open, value => { open = value; }] };
  const Menu = loadModule('src/components/landing/LandingMoreMenu.tsx', {
    react, 'next/link': 'a', 'next/image': 'img', '@/lib/feature-flags': {},
    '@/components/staff/StaffToolNav': Nav, '@/components/staff/operator-navigation.module.css': {},
    '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ isLoading: false, canUseOwnerDashboard: true, isKiosk: false }) },
  }, { React: react }).default;
  const tree = Menu();
  const html = renderToStaticMarkup(tree);
  assert.deepEqual(links(html), expected);
  const header = React.Children.toArray(tree.props.children)[0];
  assert.doesNotMatch(renderToStaticMarkup(header), /My dashboard|Timecard &amp; admin/);
  const menu = React.Children.toArray(React.Children.toArray(tree.props.children)[1].props.children).find(node => node.type === Nav);
  menu.props.onNavigate();
  assert.equal(open, false);
});

test('quick menu handles personal routes, nested family pages, and role visibility', () => {
  assert.equal(navigation.activeOperatorLink('/staff/families/family-id'), 'families');
  assert.equal(navigation.activeOperatorLink('/landing/party'), 'my-parties');
  assert.equal(navigation.activeOperatorLink('/landing/classschedule'), 'my-classes');
  assert.equal(navigation.activeOperatorLink('/landing'), 'dashboard');
  for (const canUseOwnerDashboard of [false, true]) {
    const Quick = loadModule('src/components/staff/StaffQuickNav.tsx', {
      'next/navigation': { usePathname: () => '/staff/checkin' },
      '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ canUseOwnerDashboard, isKiosk: false }) },
      '@/lib/operator-navigation': navigation, './StaffToolNav': Nav, './operator-navigation.module.css': {},
    }, { React }).default;
    const html = renderToStaticMarkup(React.createElement(Quick));
    assert.deepEqual(links(html), canUseOwnerDashboard ? expectedQuick : []);
    if (canUseOwnerDashboard) assert.match(html, /href="\/staff\/checkin"[^>]+aria-current="page"/);
  }
});

test('old Tools and Occupancy URLs redirect into the dashboard and integrated check-in workspace', () => {
  for (const [source, destination] of [['src/app/staff/page.tsx', '/staff/dashboard'], ['src/app/staff/occupancy/page.tsx', '/staff/checkin?view=occupancy']]) {
    const Page = loadModule(source, { 'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } } }).default;
    assert.throws(() => Page(), { message: `redirect:${destination}` });
  }
});


test('instructors get My dashboard and timecards in quick and tool menus without operator controls', () => {
  for (const variant of ['tools', 'menu', 'quick']) {
    const html = renderToStaticMarkup(React.createElement(Nav, { variant, audience: 'instructor' }));
    assert.deepEqual(links(html), [['/teaching', 'My dashboard'], ['/employee', 'My timecards'], ['/', 'Main homepage']]);
    assert.doesNotMatch(html, /staff\/checkin|staff\/admin/);
  }
  const Quick = loadModule('src/components/staff/StaffQuickNav.tsx', {
    'next/navigation': { usePathname: () => '/employee' },
    '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ canUseOwnerDashboard: false, isInstructor: true }) },
    '@/lib/operator-navigation': navigation, './StaffToolNav': Nav, './operator-navigation.module.css': {},
  }, { React }).default;
  assert.match(renderToStaticMarkup(React.createElement(Quick)), /href="\/teaching"[^>]*>My dashboard/);
});

test('administration page exposes only role-appropriate tools', async () => {
  for (const role of ['staff', 'owner', 'admin']) {
    const Page = loadModule('src/app/staff/admin/page.tsx', {
      'next/link': 'a', '@/components/staff/StaffToolNav': Nav, '@/components/staff/StaffPortal.module.css': {},
      '@/lib/authz': { getCurrentUserRole: async () => ({ role, roles: [role], isKiosk: false }) },
    }, { React }).default;
    const html = renderToStaticMarkup(await Page());
    assert.match(html, /href="\/employee"/);
    assert.equal(html.includes('href="/staff/team"'), role !== 'staff');
    assert.equal(html.includes('href="/staff/campaigns"'), role !== 'staff');
  }
});


test('public page account link also returns operators and instructors to My dashboard', async () => {
  for (const role of ['owner', 'staff', 'instructor']) {
    const Header = function Header() {};
    const Page = loadModule('src/components/Nav.tsx', {
      '@/components/pastel/PastelPrimitives': { PastelHeader: Header },
      '@/lib/authz': { getCurrentUserRole: async () => ({ user: { id: 'signed-in' }, role, roles: [role] }), isStaffRole: value => ['owner', 'staff'].includes(value) },
    }, { React }).default;
    const result = await Page();
    assert.equal(result.props.accessLabel, 'My dashboard');
    assert.equal(result.props.dashboardHref, role === 'instructor' ? '/teaching' : '/staff/dashboard');
  }
});


test('Open Play, Party, and Family management link owners and admins to membership management', async () => {
  const react = { ...React, useState: initial => [initial, () => {}], useEffect() {} };
  for (const role of ['owner', 'admin', 'staff']) {
    for (const [source, active] of [
      ['src/app/staff/open-play-reservations/page.tsx', 'open-play'],
      ['src/app/staff/parties/page.tsx', 'parties'],
      ['src/app/staff/families/page.tsx', 'families'],
    ]) {
      const Page = loadModule(source, {
        react, 'next/link': 'a', 'next/navigation': { useRouter: () => ({ push() {} }) },
        '@/lib/authz': { getCurrentUserRole: async () => ({ role }) },
        '@/lib/use-owner-dashboard-access': { useOperatorAccess: () => ({ role }) },
        '@/components/staff/StaffToolNav': Nav,
        '@/components/staff/OpenPlayReservationsAdmin': () => null,
        '@/components/staff/PartyManagement': () => null,
        '@/components/staff/StaffDashboard': () => null,
      }, { React: react }).default;
      const html = renderToStaticMarkup(await Page());
      const menu = expected.slice(0, 8);
      if (role !== 'staff') menu.push(['/staff/founding-memberships', 'Membership management']);
      assert.deepEqual(links(html).slice(0, menu.length), menu, `${source}: ${role}`);
      assert.equal(html.includes('Membership management'), role !== 'staff');
      assert.match(html, new RegExp(`href="${navigation.operatorLinks.find(link => link.id === active).href}"[^>]+aria-current="page"`));
    }
  }
});
