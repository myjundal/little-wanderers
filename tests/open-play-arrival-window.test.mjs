import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const policy = loadModule('src/lib/open-play-reservations.ts');
const windowFor = (start, end) => ({ starts_at: start, ends_at: end });
test('5 PM cutoff is effective November 16 Eastern, inclusive of 4–5 and stable across DST and years', () => {
  for (const [start, end, available, last] of [
    ['2026-11-15T22:00Z', '2026-11-15T23:00Z', true, false],
    ['2026-11-16T21:00Z', '2026-11-16T22:00Z', true, true],
    ['2026-11-16T22:00Z', '2026-11-16T23:00Z', false, false],
    ['2026-11-16T21:30Z', '2026-11-16T22:30Z', false, false],
    ['2026-11-16T20:00Z', '2026-11-16T21:00Z', true, false],
    ['2027-07-04T20:00Z', '2027-07-04T21:00Z', true, true],
    ['2027-07-04T21:00Z', '2027-07-04T22:00Z', false, false],
    ['2027-01-01T04:00Z', '2027-01-01T05:00Z', false, false],
  ]) {
    assert.equal(policy.isOpenPlayArrivalAvailable(windowFor(start, end)), available, start);
    assert.equal(policy.isLastOpenPlayArrival(windowFor(start, end)), last, start);
  }
});
const late = { id: 'late', ...windowFor('2026-11-16T21:00Z', '2026-11-16T22:00Z'), remaining_children: 10, capacity_children: 10, is_closed: false, is_full: false };
const early = { ...late, id: 'early', ...windowFor('2026-11-16T14:00Z', '2026-11-16T15:00Z') };
function nodes(tree) { const all=[]; function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!React.isValidElement(n)) return; all.push(n); walk(n.props.children); } walk(tree); return all; }
function reservationHarness() {
  const data = { ok: true, slots: [early, late], reservations: [], family: { guardian: null, children: [], memberships: [] } };
  const state = [data, false, '', '', '2026-11-16', 'late', 'Parent', 'Family', [{ id: 'child', name: 'Sam', birthdate: '2023-01-01', selected: true }], '1', 'counter', '', false];
  let index = 0;
  const react = { ...React, useEffect() {}, useCallback: fn => fn, useState(initial) { const i=index++; if (!(i in state)) state[i]=initial; return [state[i], next=>{state[i]=typeof next==='function'?next(state[i]):next;}]; } };
  const Component = loadModule('src/components/soft-opening/SoftOpeningReservation.tsx', {
    react, 'next/link': 'a', 'next/image': 'img', './soft-opening.module.css': {},
    '@/lib/open-play-reservations': policy, '@/lib/child-age': { parseChildAge: () => null }, '@/lib/soft-opening-pricing': { softOpeningAmount: () => 1600 },
  }, { React, Intl }).default;
  return { state, render() { index=0; return Component({ previewData: data, publicBooking: true }); } };
}
test('4–5 PM selection requires explicit 6 PM closing acknowledgment and resets it when the window changes', async () => {
  const h=reservationHarness();let tree=h.render();
  assert.match(renderToStaticMarkup(tree), /ARRIVAL WINDOW/);
  assert.match(renderToStaticMarkup(tree), /UNLIMITED STAY until closing/);
  assert.match(renderToStaticMarkup(tree), /We close at 6 PM/);
  const submit=()=>nodes(tree).find(n=>n.type==='button'&&n.props.type==='submit');
  assert.equal(submit().props.disabled, true);
  await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.match(h.state[2], /Please confirm/);
  nodes(tree).find(n=>n.type==='input'&&n.props.required&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
  tree=h.render();assert.equal(submit().props.disabled, false);
  await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.match(h.state[3], /Preview: your visit is reserved/);
  nodes(tree).find(n=>n.type==='button'&&n.key==='early').props.onClick();
  tree=h.render();assert.equal(h.state[12], false);
  assert.equal(nodes(tree).some(n=>n.type==='input'&&n.props.required&&n.props.type==='checkbox'),false);
  nodes(tree).find(n=>n.type==='button'&&n.key==='late').props.onClick();tree=h.render();assert.equal(submit().props.disabled,true);
});
test('public calendar repeats the 6 PM warning only for the selected last arrival window', () => {
  for(const id of ['early','late']) {
    const states=['2026-11-16','2026-11',id];let i=0;
    const Calendar=loadModule('src/components/soft-opening/PublicOpenPlayCalendar.tsx',{react:{...React,useState:()=>[states[i++],()=>{}]},'next/link':'a','./public-open-play.module.css':{},'@/lib/open-play-reservations':policy},{React,Intl}).default;
    const html=renderToStaticMarkup(Calendar({slots:[early,late]}));
    assert.equal(html.includes(policy.LAST_OPEN_PLAY_ARRIVAL_NOTICE),id==='late');
  }
});

test('a preserved 4–5 PM reservation on a private-party date shows change instructions without a conflicting 6 PM visit reminder', () => {
 const h=reservationHarness();
 h.state[0].reservations=[{id:'saved',status:'reserved',slot:late,child_count:1,adult_count:1,payment_choice:'counter',payment_status:'due',amount_cents:1600}];
 h.state[0].private_party_days=[{date:'2026-11-16',starts_at:'2026-11-16T21:00Z',ends_at:'2026-11-16T23:00Z'}];
 const html=renderToStaticMarkup(h.render());
 assert.match(html,/Your reserved arrival overlaps a private party/);
 assert.doesNotMatch(html,/Your arrival window is 4–5 PM. We close at 6 PM/);
});
