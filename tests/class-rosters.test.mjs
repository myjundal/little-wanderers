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

test('one child across different dates appears once per class with every selected date', () => {
  const result = rosters.groupClassRosters([
    session('second', [child('ava', 'Ava Kim', 'waitlist')], { startTime: '2026-11-19T22:00:00Z', endTime: '2026-11-19T22:45:00Z' }),
    session('first', [child('ava', 'Ava Kim'), child('milo', 'Milo Park')]),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].children.length, 2);
  assert.equal(result[0].sessionCount, 2);
  assert.deepEqual(Array.from(result[0].children[0].dates, date => date.sessionId), ['first', 'second']);
});

test('children with identical names stay separate and each class has its own list', () => {
  const result = rosters.groupClassRosters([
    session('art', [child('sam-1', 'Sam Lee'), child('sam-2', 'Sam Lee')]),
    session('music', [child('sam-1', 'Sam Lee')], { title: 'Baby Music' }),
  ]);
  assert.equal(result.find(group => group.title === 'Little Hands, Big Canvases').children.length, 2);
  assert.equal(result.find(group => group.title === 'Baby Music').children.length, 1);
});

test('interest and legacy registrations are included and cancelled records are excluded', () => {
  const result = rosters.groupClassRosters([
    session('active', [child('interest', 'Interest'), child('scheduled', 'Scheduled', 'scheduled'), child('waiting', 'Waiting', 'waitlist'), child('cancelled', 'Cancelled', 'cancelled')]),
    session('cancelled-class', [child('other', 'Other')], { status: 'cancelled' }),
  ]);
  assert.deepEqual(Array.from(result[0].children, item => item.personId), ['interest', 'scheduled', 'waiting']);
  assert.equal(result[0].sessionCount, 1);
});

test('all dates is the default and upcoming scope includes a class currently in progress', () => {
  const now = new Date('2026-11-12T22:15:00Z').getTime();
  const sessions = [
    session('past', [child('past', 'Past')], { startTime: '2026-11-05T22:00:00Z', endTime: '2026-11-05T22:45:00Z' }),
    session('in-progress', [child('current', 'Current')]),
  ];
  assert.equal(rosters.groupClassRosters(sessions)[0].children.length, 2);
  const upcoming = rosters.groupClassRosters(sessions, 'upcoming', now);
  assert.equal(upcoming[0].children.length, 1);
  assert.equal(upcoming[0].children[0].personId, 'current');
});

test('a class without sign-ups remains visible, and duplicate payloads do not inflate counts', () => {
  const item = session('art', [child('ava', 'Ava')]);
  const result = rosters.groupClassRosters([item, item, session('music', [], { title: 'Baby Music' })]);
  assert.equal(result.find(group => group.title === 'Baby Music').children.length, 0);
  const art = result.find(group => group.title === item.title);
  assert.equal(art.sessionCount, 1);
  assert.equal(art.children.length, 1);
  assert.equal(art.children[0].dates.length, 1);
});

test('search matches class or child names without losing the child’s dates', () => {
  const result = rosters.groupClassRosters([
    session('first', [child('ava', 'Ava Kim'), child('milo', 'Milo Park')]),
    session('second', [child('ava', 'Ava Kim')]),
    session('music', [child('ava', 'Ava Kim')], { title: 'Baby Music' }),
  ]);
  assert.equal(rosters.filterClassRosters(result, '  AVA  ').length, 2);
  const art = rosters.filterClassRosters(result, 'ava', 'Little Hands, Big Canvases');
  assert.equal(art.length, 1);
  assert.equal(art[0].children.length, 1);
  assert.equal(art[0].children[0].dates.length, 2);
  assert.equal(rosters.filterClassRosters(result, 'music')[0].children.length, 1);
  assert.equal(rosters.filterClassRosters(result, 'missing').length, 0);
});

test('the shared roster renders names immediately and family links are limited to the operator view', () => {
  const { default: Roster } = loadModule('src/components/classes/ClassPreRegistrationRosters.tsx', {
    react: React,
    'next/link': props => React.createElement('a', { href: props.href }, props.children),
    '@/lib/class-rosters': rosters,
    './class-rosters.module.css': {},
  }, { React });
  const sessions = [session('first', [child('ava', 'Ava Kim', 'waitlist')]), session('second', [child('ava', 'Ava Kim')])];
  const props = { sessions, onRefresh() {}, onSessionSelect() {} };
  const teaching = renderToStaticMarkup(React.createElement(Roster, props));
  assert.equal((teaching.match(/<strong>Ava Kim<\/strong>/g) ?? []).length, 1);
  assert.match(teaching, /2 selected dates/);
  assert.doesNotMatch(teaching, /View family|\/staff\/families|Waitlist/);
  const staff = renderToStaticMarkup(React.createElement(Roster, { ...props, showFamilyLinks: true }));
  assert.match(staff, /\/staff\/families\/family-ava/);
});
