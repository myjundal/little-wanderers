import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const privacy=loadModule('src/lib/private-party-open-play.ts',{'@/lib/party-config':loadModule('src/lib/party-config.ts')});
const constants=loadModule('src/lib/open-play-reservations.ts');
const slot={id:'available',starts_at:'2026-11-14T14:00:00Z',ends_at:'2026-11-14T15:00:00Z',status:'open',capacity_children:7,capacity_total:12,notes:'PRIVATE',created_by_user_id:'PRIVATE'};
test('public availability exposes only calendar fields, honors closure and total capacity, and pages reservations',async()=>{
 const ranges=[];const admin={from(){const q={select(){return q;},eq(){return q;},neq(){return q;},gte(key,value){assert.equal(value,constants.PUBLIC_OPEN_PLAY_START);return q;},lt(){return q;},gt(){return q;},in(){return q;},order(){return q;},range(start,end){ranges.push([start,end]);return Promise.resolve({data:start===0?Array.from({length:500},()=>({slot_id:'full',child_count:0,adult_count:1,email:'PRIVATE'})):[{slot_id:'available',child_count:2,adult_count:2}],error:null});},then(resolve){resolve({data:[slot,{...slot,id:'closed',status:'closed'},{...slot,id:'full'}],error:null});}};return q;}};
 const {loadPublicOpenPlaySlots}=loadModule('src/lib/public-open-play.ts',{'@/lib/open-play-reservations':constants,'@/lib/private-party-open-play':{...privacy,readPrivatePartyDays:async()=>[]}});
 const slots=await loadPublicOpenPlaySlots(admin);
 assert.deepEqual(Object.keys(slots[0]).sort(),['id','starts_at','ends_at','remaining_children','capacity_children','is_closed','is_full','is_private_party_blocked','closing_at'].sort());
 assert.equal(slots[0].remaining_children,5);assert.equal(slots[0].capacity_children,7);assert.equal(slots[1].is_closed,true);assert.equal(slots[2].is_full,true);
 assert.equal(JSON.stringify(slots).includes('PRIVATE'),false);assert.deepEqual(ranges,[[0,499],[500,999]]);
});
test('guests see dates and arrival times before any login link or family form',()=>{
 const Calendar=loadModule('src/components/soft-opening/PublicOpenPlayCalendar.tsx',{react:React,'next/link':'a','./public-open-play.module.css':{}},{React,Intl}).default;
 const html=renderToStaticMarkup(React.createElement(Calendar,{slots:[{...slot,remaining_children:5,is_closed:false,is_full:false}]}));
 assert.match(html,/November 2026/);assert.match(html,/9 AM/);assert.match(html,/\(5\/7\) spots left/);assert.match(html,/unlimited play until closing/);assert.match(html,/Reservations are recommended/);
 assert.doesNotMatch(html,/href="\/login|Parent.*first name/);
});
test('calendar keeps a selected time through sign-in without making a reservation',()=>{
 const states=['2026-11-14','2026-11','available'];let index=0;
 const react={...React,useState:()=>[states[index++],()=>{}]};
 const Calendar=loadModule('src/components/soft-opening/PublicOpenPlayCalendar.tsx',{react,'next/link':'a','./public-open-play.module.css':{}},{React,Intl}).default;
 const html=renderToStaticMarkup(Calendar({slots:[{...slot,remaining_children:5,is_closed:false,is_full:false}]}));
 assert.match(html,/href="\/login\?next=%2Flanding%2Fopen-play%3Fslot%3Davailable"/);
 assert.match(html,/Your spot is confirmed after you finish reserving/);
});


test('public guests see the private closing time and blocked arrival windows without any party identity',async()=>{
 const windows=[{...slot,id:'before',starts_at:'2026-11-16T20:00:00Z',ends_at:'2026-11-16T21:00:00Z'}, {...slot,id:'during',starts_at:'2026-11-16T21:00:00Z',ends_at:'2026-11-16T22:00:00Z'}];
 const admin={from(table){const q={select(){return q},eq(){return q},neq(){return q},gte(){return q},lt(){return q},gt(){return q},order(){return q},range(){return Promise.resolve({data:[],error:null})},then(resolve){return resolve({data:table==='open_play_reservation_slots'?windows:[],error:null})}};return q}};
 const privateDays=[privacy.privatePartyWindow('2026-11-16T20:00:00Z')];
 const {loadPublicOpenPlaySlots}=loadModule('src/lib/public-open-play.ts',{'@/lib/open-play-reservations':constants,'@/lib/private-party-open-play':{...privacy,readPrivatePartyDays:async()=>privateDays}});
 const slots=await loadPublicOpenPlaySlots(admin);
 assert.equal(slots[0].is_closed,false);assert.equal(slots[1].is_closed,true);assert.equal(slots[1].is_private_party_blocked,true);assert.equal(slots[0].closing_at,'2026-11-16T21:00:00.000Z');
 const Calendar=loadModule('src/components/soft-opening/PublicOpenPlayCalendar.tsx',{react:React,'next/link':'a','./public-open-play.module.css':{}},{React,Intl}).default;
 const html=renderToStaticMarkup(React.createElement(Calendar,{slots}));assert.match(html,/Open Play ends at 4 PM/);assert.match(html,/Private party/);assert.match(html,/disabled=""/);assert.doesNotMatch(JSON.stringify(slots),/PRIVATE|household|party_id/);
 const unavailable=loadModule('src/lib/public-open-play.ts',{'@/lib/open-play-reservations':constants,'@/lib/private-party-open-play':{...privacy,readPrivatePartyDays:async()=>{throw Error('Unable to verify')}}});
 await assert.rejects(unavailable.loadPublicOpenPlaySlots(admin),/Unable to verify/);
});
