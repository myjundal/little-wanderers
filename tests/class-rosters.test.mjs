import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const rosters = loadModule('src/lib/class-rosters.ts');
const child = (id, name, status = 'preregistered') => ({ id: `reg-${id}`, personId: id, name, status, householdId: `family-${id}` });
const session = (id, registrations, overrides = {}) => ({
  id, title: 'Little Hands, Big Canvases', startTime: '2026-11-12T22:00:00Z', endTime: '2026-11-12T22:45:00Z',
  scheduleLabel: 'Thursdays at 5pm', status: 'scheduled', registrations, ...overrides,
});
const week = '2026-11-08';

test('each date separates confirmed seats from interest and excludes cancelled registrations/classes', () => {
  const days = rosters.groupWeeklyClassRosters([
    session('art', [child('paid', 'Paid', 'scheduled'), child('attended', 'Attended', 'attended'), child('interest', 'Interest'), child('waiting', 'Waiting', 'waitlist'), child('legacy-waiting', 'Legacy waiting', 'waitlisted'), child('cancelled', 'Cancelled', 'cancelled'), child('unknown', 'Unknown', 'pending')]),
    session('cancelled-class', [child('other', 'Other')], { status: 'cancelled' }),
  ], week);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-11-12');
  assert.equal(days[0].sessions.length, 1);
  assert.deepEqual(Array.from(days[0].sessions[0].confirmed, reg => reg.personId), ['attended', 'paid']);
  assert.deepEqual(Array.from(days[0].sessions[0].interested, reg => reg.personId), ['interest', 'legacy-waiting', 'waiting']);
});

test('the same child can be confirmed on one date and interested on another without leaking across weeks', () => {
  const sessions = [
    session('later', [child('ava', 'Ava Kim', 'scheduled')], { startTime: '2026-11-14T22:00:00Z', endTime: '2026-11-14T22:45:00Z' }),
    session('first', [child('ava', 'Ava Kim')]),
    session('next-week', [child('ava', 'Ava Kim', 'scheduled')], { startTime: '2026-11-19T22:00:00Z', endTime: '2026-11-19T22:45:00Z' }),
  ];
  const days = rosters.groupWeeklyClassRosters(sessions, week);
  assert.deepEqual(Array.from(days, day => day.date), ['2026-11-12', '2026-11-14']);
  assert.equal(days[0].sessions[0].confirmed.length, 0);
  assert.equal(days[0].sessions[0].interested.length, 1);
  assert.equal(days[1].sessions[0].confirmed.length, 1);
  assert.equal(days[1].sessions[0].interested.length, 0);
  assert.equal(rosters.groupWeeklyClassRosters(sessions, '2026-11-15')[0].sessions[0].id, 'next-week');
});

test('empty classes stay visible, names do not merge identities, and duplicates cannot inflate either group', () => {
  const item = session('art', [child('sam-1', 'Sam Lee'), child('sam-2', 'Sam Lee'), child('sam-1', 'Sam Lee', 'scheduled')]);
  const days = rosters.groupWeeklyClassRosters([item, item, session('music', [], { title: 'Baby Music' })], week);
  const art = days[0].sessions.find(s => s.id === 'art');
  assert.equal(days[0].sessions.length, 2);
  assert.equal(art.confirmed.length, 1);
  assert.equal(art.interested.length, 1);
  assert.equal(art.confirmed[0].personId, 'sam-1');
  assert.equal(art.interested[0].personId, 'sam-2');
  assert.equal(days[0].sessions.find(s => s.id === 'music').confirmed.length, 0);
});

test('venue dates and Sunday week boundaries remain correct across midnight, DST and year changes', () => {
  assert.equal(rosters.classRosterDate('2026-11-15T04:30:00Z'), '2026-11-14');
  assert.equal(rosters.classRosterWeekStart('2026-11-14'), week);
  assert.equal(rosters.classRosterWeekStart('2026-11-15'), '2026-11-15');
  assert.equal(rosters.classRosterWeekStart('2027-01-01'), '2026-12-27');
  assert.equal(rosters.shiftRosterDate('2026-11-01', 7), '2026-11-08');
  assert.equal(rosters.shiftRosterDate('2026-03-08', -7), '2026-03-01');
  const result = rosters.groupWeeklyClassRosters([
    session('saturday', [], { startTime: '2026-11-15T04:30:00Z' }),
    session('sunday', [], { startTime: '2026-11-15T05:00:00Z' }),
    session('invalid', [], { startTime: 'bad-date' }),
  ], week);
  assert.deepEqual(Array.from(result.flatMap(day => day.sessions), s => s.id), ['saturday']);
});

test('class and child filters retain each date and its correct registration group', () => {
  const days = rosters.groupWeeklyClassRosters([
    session('first', [child('ava', 'Ava Kim'), child('milo', 'Milo Park', 'scheduled')]),
    session('second', [child('ava', 'Ava Kim', 'scheduled')], { startTime: '2026-11-13T22:00:00Z' }),
    session('music', [child('ava', 'Ava Kim')], { title: 'Baby Music' }),
  ], week);
  const result = rosters.filterWeeklyClassRosters(days, '  AVA ', 'Little Hands, Big Canvases');
  assert.equal(result.length, 2);
  assert.equal(result[0].sessions.length, 1);
  assert.equal(result[0].sessions[0].confirmed.length, 0);
  assert.equal(result[0].sessions[0].interested[0].name, 'Ava Kim');
  assert.equal(result[1].sessions[0].confirmed[0].name, 'Ava Kim');
  assert.equal(rosters.filterWeeklyClassRosters(days, 'music')[0].sessions[0].interested.length, 1);
  assert.equal(rosters.filterWeeklyClassRosters(days, 'missing').length, 0);
});

function rosterHarness(props) {
  const hooks = [];
  let cursor = 0;
  const react = { ...React, useMemo: fn => fn(), useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], update => { hooks[index] = typeof update === 'function' ? update(hooks[index]) : update; }];
  } };
  const { default: Roster } = loadModule('src/components/classes/ClassPreRegistrationRosters.tsx', {
    react,
    'next/link': props => React.createElement('a', { href: props.href }, props.children),
    '@/lib/class-rosters': { ...rosters, classRosterWeekStart: date => rosters.classRosterWeekStart(date ?? '2026-11-12') },
    './class-rosters.module.css': {},
  }, { React });
  let tree;
  const render = () => { cursor = 0; tree = Roster(props); return renderToStaticMarkup(tree); };
  const all = predicate => {
    const found = [];
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement(node)) return;
      if (predicate(node)) found.push(node);
      visit(node.props.children);
    }
    visit(tree);
    return found;
  };
  return { render, all };
}

test('rosters render collapsed count groups per date, with family links only for staff', () => {
  const sessions = [session('first', [child('ava', 'Ava Kim'), child('milo', 'Milo Park', 'scheduled')])];
  const teaching = rosterHarness({ sessions, onRefresh() {}, onSessionSelect() {} });
  const markup = teaching.render();
  assert.match(markup, /Thursday, Nov 12, 2026/);
  assert.match(markup, /<summary>Seat confirmed \(1\)<\/summary>/);
  assert.match(markup, /<summary>Interested \(1\)<\/summary>/);
  assert.equal(teaching.all(node => node.type === 'details').length, 2);
  assert.ok(teaching.all(node => node.type === 'details').every(node => !node.props.open));
  assert.match(markup, /Ava Kim/);
  assert.doesNotMatch(markup, /View family|\/staff\/families/);
  const staff = rosterHarness({ sessions, onRefresh() {}, showFamilyLinks: true });
  assert.match(staff.render(), /\/staff\/families\/family-ava/);
  assert.equal(staff.all(node => node.type === 'button' && node.props.children === 'Open session').length, 0);
});

test('week navigation, date picker, search, refresh and session action operate on the displayed week', () => {
  let refreshed = 0;
  let opened;
  const harness = rosterHarness({
    sessions: [session('first', [child('ava', 'Ava Kim')]), session('second', [child('milo', 'Milo Park', 'scheduled')], { startTime: '2026-11-19T22:00:00Z' })],
    onRefresh() { refreshed++; }, onSessionSelect(id) { opened = id; },
  });
  const click = label => harness.all(node => node.type === 'button' && node.props.children === label)[0].props.onClick();
  assert.match(harness.render(), /Ava Kim/);
  click('Next week');
  let markup = harness.render();
  assert.match(markup, /Milo Park/);
  assert.doesNotMatch(markup, /Ava Kim/);
  click('Open session');
  assert.equal(opened, 'second');
  click('Previous week');
  assert.match(harness.render(), /Ava Kim/);
  harness.all(node => node.type === 'input' && node.props.type === 'date')[0].props.onChange({ target: { value: '2026-11-19' } });
  assert.match(harness.render(), /Milo Park/);
  click('This week');
  harness.render();
  harness.all(node => node.type === 'input' && node.props.type === 'search')[0].props.onChange({ target: { value: 'Milo' } });
  assert.match(harness.render(), /No matching classes or children this week/);
  click('Refresh list');
  assert.equal(refreshed, 1);
});
