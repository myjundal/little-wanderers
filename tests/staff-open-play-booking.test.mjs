import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSquareModules} from './helpers/admission-pos-harness.mjs';
const family='10000000-0000-4000-8000-000000000001',child='20000000-0000-4000-8000-000000000001',slotId='30000000-0000-4000-8000-000000000001';
function harness({existing=false,slotStatus='open',capacityError=false,member=true}={}){
 const writes=[];
 const db={from(table){let row;
  const q={select(){return q;},eq(){return q;},gt(){return q;},limit(){return q;},maybeSingle(){return q;},single(){return q;},insert(value){row=value;writes.push(value);return q;},then(resolve){resolve({data:row?{id:'reservation',...row}:table==='households'?{email:'parent@example.test'}:table==='open_play_reservation_slots'?{id:slotId,status:slotStatus,starts_at:'2099-11-11T14:00:00Z',ends_at:'2099-11-11T15:00:00Z'}:existing?[{id:'existing'}]:[],error:row&&capacityError?{code:'23514'}:null});}};return q;
 }};
 const api=loadSquareModules({mocks:{'@/lib/open-play-reservations':{isUuid:v=>/^[0-9a-f-]{36}$/.test(v),SOFT_OPENING_START:'2099-11-11',SOFT_OPENING_END:'2100-01-01'},'@/lib/soft-opening-family':{readSoftOpeningFamily:async()=>({children:[{id:child}],memberships:member?[{child_ids:[child],status:'pending',start_date:null,paid_through:null}]:[]})}}}).load('src/lib/staff-open-play.ts');
 return {writes,create:patch=>api.createStaffOpenPlayReservation(db,family,'staff',{slot_id:slotId,child_ids:[child],adult_count:2,...patch})};
}
test('owner booking saves named family children, server-calculated membership admission and staff audit identity',async()=>{
 for(const member of [true,false]){const h=harness({member});const saved=await h.create();assert.equal(saved.household_id,family);assert.equal(saved.created_by_user_id,'staff');assert.equal(saved.child_count,1);assert.equal(saved.adult_count,2);assert.equal(saved.amount_cents,member?0:1600);assert.equal(saved.payment_status,member?'covered':'due');assert.equal(saved.payment_choice,member?'membership':'counter');}
});
test('forged children, duplicate ids, invalid adults, closed windows and existing future bookings cannot create a booking',async()=>{
 for(const [options,patch] of [[{},{child_ids:['40000000-0000-4000-8000-000000000001']}],[{},{child_ids:[child,child]}],[{},{adult_count:3}],[{slotStatus:'closed'},{}],[{existing:true},{}]]){const h=harness(options);await assert.rejects(h.create(patch));assert.equal(h.writes.length,0);}
});
test('database capacity races return a useful error without billing or alternate booking writes',async()=>{
 const h=harness({capacityError:true});await assert.rejects(h.create(),/full/);assert.equal(h.writes.length,1);
});
test('family booking route authenticates an owner before accessing any submitted family data',async()=>{
 const api=loadSquareModules({mocks:{'@/lib/authz':{requireOwnerContext:async()=>({ok:false,response:Response.json({ok:false},{status:403})})}}}).load('src/app/api/admin/families/[id]/open-play-reservations/route.ts');
 assert.equal((await api.POST({json:()=>{throw Error('must not read body');}},{params:Promise.resolve({id:family})})).status,403);
});
