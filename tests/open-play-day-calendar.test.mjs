import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const react={...React,useMemo:fn=>fn(),useState:init=>[typeof init==='function'?init():init,()=>{}]};
const Calendar=loadModule('src/components/calendar/AvailabilityCalendar.tsx',{react},{React}).default;
test('Open Play shades the entire booked day pink, keeps other days white and removes all slot pills and My booking legend',()=>{
 const selected=[];
 const tree=Calendar({title:'Open Play',initialMonth:'2026-11',slots:[{id:'one',start:'2026-11-11T14:00:00Z',end:'2026-11-11T15:00:00Z',status:'booked',label:'9–10am'}],reservationDays:['2026-11-11'],onDaySelect:d=>selected.push(d)});
 const html=renderToStaticMarkup(tree);
 assert.equal((html.match(/background:#fce8ee/g)||[]).length,1);assert.match(html,/2026-11-11, has reservations/);assert.match(html,/2026-11-12, no reservations/);
 assert.doesNotMatch(html,/My booking|9–10am|Available|Full/);
 const nodes=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(!React.isValidElement(n))return;nodes.push(n);walk(n.props.children);};walk(tree);
 nodes.find(n=>n.props['aria-label']==='2026-11-11, has reservations').props.onClick();assert.deepEqual(selected,['2026-11-11']);
});
test('other calendars retain their original slot rendering',()=>{
 const html=renderToStaticMarkup(Calendar({title:'Parties',slots:[],initialMonth:'2026-11'}));assert.match(html,/My booking/);
});
