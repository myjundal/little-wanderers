import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
const {arrivalGroups,childAgeOn}=loadSquareModules().load('src/lib/admission-arrivals.ts');
const day='2026-11-12',start='2026-11-12T14:00:00Z',end='2026-11-12T15:00:00Z';
const person=(id,birthdate,role='child')=>({id,first_name:id,last_name:null,birthdate,role});
const family=(id,children,options={})=>({id,name:id,email:null,phone:null,waiver_status:'completed',people:[...children,person(id+'-parent',null,'adult')],reservations:[{id:id+'-reservation',child_ids:children.map(x=>x.id),child_count:children.length,adult_count:1,slot:{starts_at:start,ends_at:end,label:'Open Play'}}],...options});
const visit=(id,child,time='2026-11-12T14:01:00Z')=>({id:id+'-'+child,household_id:id,person_id:child,checked_in_at:time,payment_status:'covered',price_cents:0});
test('age buckets use completed years on the visit date and preserve missing ages',()=>{
 assert.equal(childAgeOn('2026-01-01',day),0);assert.equal(childAgeOn('2024-11-13',day),1);assert.equal(childAgeOn('2024-11-12',day),2);
 for(const value of [null,'2026-11-13','2024-02-31','unknown'])assert.equal(childAgeOn(value,day),null);
});
test('time windows sort chronologically and count only reserved children, including infants and missing dates',()=>{
 const f=family('first',[person('baby','2026-05-01'),person('sibling','2024-11-13'),person('not-attending','2022-01-01')]);
 f.reservations[0].child_ids=['baby','sibling'];f.reservations[0].child_count=3; // one legacy unnamed child
 const later=family('later',[person('older','2023-01-01')]);later.reservations[0].slot={...later.reservations[0].slot,starts_at:'2026-11-12T17:00:00Z',ends_at:'2026-11-12T18:00:00Z'};
 const {windows}=arrivalGroups([later,f],[],day);
 assert.equal(windows[0].starts_at,start);assert.equal(windows[0].children,3);
 assert.deepEqual(JSON.parse(JSON.stringify(windows[0].ages)),[{age:0,count:1},{age:1,count:1},{age:null,count:1}]);
 assert.equal(windows[1].children,1);
});
test('partial arrivals and adult-only arrivals stay in front; a newly completed family moves to the very end',()=>{
 const first=family('new',[person('a','2025-01-01'),person('b','2023-01-01')]),older=family('already',[person('c','2024-01-01')]),waiting=family('waiting',[person('d','2024-01-01')]);
 const visits=[visit('already','c'),visit('new','a'),visit('new','new-parent')];
 let cards=arrivalGroups([first,older,waiting],visits,day).windows[0].cards;
 assert.deepEqual(Array.from(cards,c=>c.family.id),['new','waiting','already']);assert.equal(cards[0].checkedChildren,1);assert.equal(cards[0].completed,false);
 cards=arrivalGroups([first,older,waiting],[...visits,visit('new','b','2026-11-12T14:30:00Z')],day).windows[0].cards;
 assert.deepEqual(Array.from(cards,c=>c.family.id),['waiting','already','new']);assert.equal(cards.at(-1).completed,true);
 const adultOnly=arrivalGroups([waiting],[visit('waiting','waiting-parent')],day).windows[0].cards[0];assert.equal(adultOnly.completed,false);
});
test('another day or family does not complete a card; departed families remain completed and walk-ins remain visible',()=>{
 const f=family('reserved',[person('a','2023-01-01')]),walkin=family('walkin',[person('w','2024-01-01')],{reservations:[]});
 let board=arrivalGroups([f,walkin],[visit('reserved','a','2026-11-12T02:00:00Z'),visit('other','a')],day);
 assert.equal(board.windows[0].cards[0].completed,false);assert.equal(board.walkins.length,1);
 board=arrivalGroups([f],[{...visit('reserved','a'),checked_out_at:'2026-11-12T16:00:00Z'}],day);assert.equal(board.windows[0].cards[0].completed,true);
});
