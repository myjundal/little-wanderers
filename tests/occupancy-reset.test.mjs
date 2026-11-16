import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const occupancy = loadModule('src/lib/occupancy.ts');

test('reset explicitly selects the p_note overload instead of the ambiguous production no-argument call', async () => {
 const calls=[];
 const admin={rpc:async(name,args)=>{calls.push({name,args});return Object.hasOwn(args,'p_note')?{error:null}:{error:{code:'PGRST203',message:'Could not choose the best candidate function between reset_occupancy() and reset_occupancy(p_note => text)'}};}};
 await occupancy.callOccupancyRpc(admin,'reset_occupancy',undefined,'Daily reset from staff dashboard');
 assert.equal(calls.length,1);assert.equal(calls[0].name,'reset_occupancy');assert.equal(calls[0].args.p_note,'Daily reset from staff dashboard');
});
test('legacy installations can fall back only on signature errors; permission and write errors never try another reset', async () => {
 for(const error of [{code:'PGRST202',message:'Missing signature'},{code:'PGRST203',message:'Ambiguous signature'}]) {
  const calls=[];await occupancy.callOccupancyRpc({rpc:async(_name,args)=>{calls.push(args);return {error:calls.length===1?error:null};}},'reset_occupancy');
  assert.equal(calls.length,2);assert.equal(Object.keys(calls[1]).length,0);
 }
 for(const code of ['42501','23514','XX000']) {
  let calls=0;await assert.rejects(occupancy.callOccupancyRpc({rpc:async()=>{calls++;return {error:{code,message:'Database rejected reset'}};}},'reset_occupancy'),/Database rejected reset/);assert.equal(calls,1);
 }
});
function routeHarness({denied=false,failWrite=false}={}) {
 const calls=[];let resets=0,reads=0;
 const admin={rpc:async(name,args)=>{calls.push({name,args});if(failWrite)return {error:{code:'42501',message:'Reset denied'}};resets++;return {error:null};},from(){throw Error('Reset must not read subscriptions, visitors or payment tables');}};
 const route=loadModule('src/app/api/admin/occupancy/route.ts',{
  '@/lib/authz':{requireStaffContext:async()=>denied?{ok:false,response:Response.json({ok:false},{status:401})}:{ok:true,user:{id:'staff'},admin}},
  '@/lib/occupancy':{...occupancy,getOccupancyStatus:async()=>{reads++;return {occupancy:resets?0:38,capacity:80,progress:resets?0:38/80,crowdLevel:resets?'light':'near_capacity',crowdMeta:{label:resets?'Calm':'Almost Full'},effectiveDate:'2026-11-15'};}},
  '@/lib/push':{sendPushBatch:async()=>{throw Error('Reset must not send push notifications');}},
 });
 return {route,calls,reads:()=>reads};
}
test('authenticated Reset Today returns a refreshed zero count without editing visits, deleting events or sending push',async()=>{
 const h=routeHarness();const response=await h.route.POST({json:async()=>({action:'reset',notes:'  Daily reset from staff dashboard  '})});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.occupancy,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_note,'Daily reset from staff dashboard');assert.equal(h.reads(),2);
});
test('unauthorized, unknown and malformed actions cannot reset; database errors do not claim success',async()=>{
 const denied=routeHarness({denied:true});assert.equal((await denied.route.POST({json:()=>{throw Error('must not read body');}})).status,401);assert.equal(denied.calls.length,0);
 for(const action of ['delete',undefined,[],{}]){const h=routeHarness();assert.equal((await h.route.POST({json:async()=>({action})})).status,400);assert.equal(h.calls.length,0);assert.equal(h.reads(),0);}
 const failed=routeHarness({failWrite:true});const r=await failed.route.POST({json:async()=>({action:'reset'})});assert.equal(r.status,500);assert.equal((await r.json()).ok,false);assert.equal(failed.calls.length,1);
});
test('the production note overload resets the ledger to zero without deleting history, and later arrivals count again',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create table occupancy_events(id serial primary key,event_type text,delta integer,notes text,created_at integer);
 create function reset_occupancy() returns void language sql as $$insert into occupancy_events(event_type,delta,created_at) values('reset',0,2)$$;
 create function reset_occupancy(p_note text default null) returns void language sql as $$insert into occupancy_events(event_type,delta,notes,created_at) values('reset',0,p_note,2)$$;
 insert into occupancy_events(event_type,delta,created_at) values('checkin_increment',38,1);
 create view occupancy_status as select coalesce(sum(delta) filter(where event_type<>'reset'),0)::int as current_occupancy from occupancy_events where created_at>=coalesce((select max(created_at) from occupancy_events where event_type='reset'),0);`);
 await assert.rejects(db.query('select reset_occupancy()'),/not unique/);
 await occupancy.callOccupancyRpc({rpc:async(_name,args)=>{await db.query('select reset_occupancy(p_note := $1)',[args.p_note]);return {error:null};}},'reset_occupancy',undefined,'Daily reset');
 assert.equal((await db.query('select current_occupancy from occupancy_status')).rows[0].current_occupancy,0);
 assert.equal((await db.query('select count(*)::int n from occupancy_events')).rows[0].n,2);
 assert.equal((await db.query("select notes from occupancy_events where event_type='reset'")).rows[0].notes,'Daily reset');
 await db.exec("insert into occupancy_events(event_type,delta,created_at) values('checkin_increment',3,3)");
 assert.equal((await db.query('select current_occupancy from occupancy_status')).rows[0].current_occupancy,3);
});
