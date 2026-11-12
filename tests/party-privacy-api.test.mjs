import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const id='2af2cb2b-db0b-4d28-bfa2-fb23d50c00bc';
const initial={id,start_time:'2099-11-16T20:00:00Z',end_time:'2099-11-16T23:00:00Z',is_private:false,status:'confirmed'};
function harness({party={...initial},allowed=true,concurrent=false,failConflicts=false,conflicts=[]}={}) {
 const writes=[],filters=[];let reads=0;
 const admin={from(table){assert.equal(table,'party_bookings');let patch;
  const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},update(value){patch=value;return q;},async maybeSingle(){reads++;if(patch){if(concurrent)return {data:null,error:null};writes.push(patch);return {data:{...party,...patch},error:null};}return {data:party,error:null};}};return q;}};
 const route=loadModule('src/app/api/admin/party-bookings/[id]/privacy/route.ts',{
  '@/lib/authz':{requireOwnerContext:async()=>allowed?{ok:true,admin}:{ok:false,response:Response.json({ok:false},{status:403})}},
  '@/lib/open-play-reservations':{isUuid:value=>value===id},
  '@/lib/private-party-open-play':{readPrivatePartyConflicts:async()=>{if(failConflicts)throw Error('offline');return conflicts;}},
 });
 const body={is_private:true,expected_is_private:false,expected_start_time:initial.start_time};
 return {writes,filters,get reads(){return reads;},patch:(payload=body,partyId=id)=>route.PATCH(new Request('https://example.test/api',{method:'PATCH',body:typeof payload==='string'?payload:JSON.stringify(payload)}),{params:Promise.resolve({id:partyId})}),get:()=>route.GET(new Request('https://example.test/api'),{params:Promise.resolve({id})})};
}

test('only owner/admin context can save; malformed or stale settings never write',async()=>{
 const denied=harness({allowed:false});assert.equal((await denied.patch()).status,403);assert.equal((await denied.get()).status,403);assert.equal(denied.reads,0);
 for(const payload of [null,{},'{',{is_private:'true',expected_is_private:false,expected_start_time:initial.start_time}]){const h=harness();assert.equal((await h.patch(payload)).status,400);assert.equal(h.writes.length,0);}
 assert.equal((await harness().patch(undefined,'invalid')).status,400);
 for(const party of [{...initial,is_private:true},{...initial,start_time:'2099-11-17T20:00:00Z'},{...initial,status:'cancelled'},{...initial,end_time:'2020-01-01T00:00:00Z'}]){const h=harness({party});assert.equal((await h.patch()).status,409);assert.equal(h.writes.length,0);}
 assert.equal((await harness({party:null}).patch()).status,404);
 assert.equal((await harness({concurrent:true}).patch()).status,409);
});

test('save records a boolean flag and reports overlapping families without changing reservations or slot statuses',async()=>{
 const conflicts=[{id:'reservation',household_id:'family',household_name:'Family',child_count:2,adult_count:1}];
 const h=harness({conflicts});const response=await h.patch();assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.item.is_private,true);assert.deepEqual(result.conflicts,conflicts);assert.equal(result.conflicts_available,true);
 assert.deepEqual(Object.keys(h.writes[0]).sort(),['is_private','updated_at']);
 assert.ok(h.filters.some(([key,value])=>key==='is_private'&&value===false));assert.ok(h.filters.some(([key,value])=>key==='start_time'&&value===initial.start_time));
 const unreadable=harness({failConflicts:true});const saved=await (await unreadable.patch()).json();assert.equal(saved.ok,true);assert.equal(saved.item.is_private,true);assert.equal(saved.conflicts_available,false);
 const existing=harness({party:{...initial,is_private:true},conflicts});assert.deepEqual((await (await existing.get()).json()).conflicts,conflicts);
});
