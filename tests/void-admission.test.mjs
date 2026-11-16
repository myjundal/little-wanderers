import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {PGlite} from '@electric-sql/pglite';
import {loadSquareModules,localSquareAdmin,ids} from './helpers/admission-pos-harness.mjs';
import {loadModule} from './helpers/class-preregistration-harness.mjs';
const staff=ids.user,family=ids.household,child=ids.person,visit=ids.klass,second='40000000-0000-4000-8000-000000000002',operation='50000000-0000-4000-8000-000000000001';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table roles(id uuid,role text);create table user_roles(user_id uuid,role text);
 create table households(id uuid primary key);create table people(id uuid primary key,household_id uuid);create table checkins(id uuid primary key,person_id uuid,household_id uuid,price_cents int,payment_status text,checked_in_at timestamptz default now(),square_order_id text,square_environment text,notes text);
 create table admission_pos_sales(id uuid primary key default gen_random_uuid(),environment text,location_id text,created_by_user_id uuid,checkin_ids uuid[],amount_cents int,status text default 'open',order_id text,launched_at timestamptz,created_at timestamptz default now());
 create table open_play_reservations(id uuid,household_id uuid,child_ids uuid[],payment_status text,payment_environment text,status text,slot_id uuid,square_order_id text);create table open_play_reservation_slots(id uuid,starts_at timestamptz);
 create table occupancy_status(current_occupancy int);insert into occupancy_status values(2);create table occupancy_events(id uuid,delta int);`);
 await db.query('insert into auth.users values($1)',[staff]);await db.query("insert into roles values($1,'staff')",[staff]);await db.query('insert into households values($1),($2)',[family,ids.other]);await db.query('insert into people values($1,$2),($3,$2)',[child,family,ids.otherPerson]);
 await db.query("insert into checkins(id,person_id,household_id,price_cents,payment_status,square_environment,notes)values($1,$2,$3,1600,'due','production','Original note'),($4,$5,$3,1000,'due','production',null)",[visit,child,family,second,ids.otherPerson]);
 await db.exec(fs.readFileSync('db/migrations/20261029_qr_admission_pos_family.sql','utf8'));await db.exec(fs.readFileSync('db/migrations/20261116_void_admission_payment.sql','utf8'));
 const params={p_id:operation,p_actor:staff,p_family:family,p_ids:[visit,second],p_environment:'production',p_reason:'Class cancelled',p_expected_total:2600};
 const admin=localSquareAdmin(db);const call=patch=>admin.rpc('void_admission_payment',{...params,...patch});
 const snapshots=async()=>({visits:(await db.query('select * from checkins order by id')).rows,occupancy:(await db.query('select * from occupancy_status')).rows,events:(await db.query('select * from occupancy_events')).rows});
 return{db,admin,call,params,snapshots};
}
test('void preserves check-ins, visit times and occupancy while recording $0 and the staff/reason/original fees atomically',async t=>{
 const h=await fixture(t),before=await h.snapshots(),result=await h.call();assert.equal(result.error,null);assert.equal(result.data.amount_cents,0);assert.equal(result.data.voided_cents,2600);
 const after=await h.snapshots();assert.equal(after.visits.length,2);assert(after.visits.every(row=>row.price_cents===0&&row.payment_status==='covered'));assert.deepEqual(after.occupancy,before.occupancy);assert.deepEqual(after.events,before.events);assert.deepEqual(after.visits.map(v=>v.checked_in_at),before.visits.map(v=>v.checked_in_at));assert.match(after.visits[0].notes,/Original note/);
 const audit=(await h.db.query('select * from admission_payment_voids')).rows[0];assert.equal(audit.actor_id,staff);assert.equal(audit.reason,'Class cancelled');assert.equal(audit.original_amount_cents,2600);assert.equal(audit.before_records.reduce((s,r)=>s+r.price_cents,0),2600);
 const {revenueServices}=loadSquareModules().load('src/lib/service-day-revenue.ts');const services=revenueServices({bookings:[],slots:[],visits:after.visits,parties:[],series:[],classes:[],registrations:[]});assert(services.every(s=>s.expected_cents===0&&s.attendance==='visited'&&!s.charges.length));
});
test('a retry returns the original result without duplicate audit or price changes; changed request IDs cannot reuse a void',async t=>{
 const h=await fixture(t);assert.equal((await h.call()).error,null);assert.equal((await h.call()).data.already_voided,true);assert.equal((await h.db.query('select count(*)::int as n from admission_payment_voids')).rows[0].n,1);
 assert.match((await h.call({p_reason:'Different reason'})).error.message,/request changed/);assert((await h.call({p_id:ids.other})).error);
});
test('void refuses paid, prepaid, linked receipts, other families, past days, stale totals and incomplete family selections without partial writes',async t=>{
 for(const change of ["update checkins set payment_status='paid' where price_cents=1600","update checkins set payment_status='prepaid' where price_cents=1600","update checkins set square_order_id='receipt' where price_cents=1600","update people set household_id='10000000-0000-4000-8000-000000000002' where id='30000000-0000-4000-8000-000000000001'","update checkins set checked_in_at=now()-interval '2 days' where price_cents=1600","update checkins set square_environment='sandbox' where price_cents=1600"]){
 const h=await fixture(t);await h.db.exec(change);const before=await h.snapshots();assert((await h.call()).error);assert.deepEqual(await h.snapshots(),before);assert.equal((await h.db.query('select count(*)::int as n from admission_payment_voids')).rows[0].n,0);
 }
 const h=await fixture(t);for(const patch of [{p_expected_total:1600},{p_ids:[visit]},{p_ids:[visit,visit]},{p_actor:ids.other},{p_reason:'x'}])assert((await h.call(patch)).error);
});
test('POS preparation and void use the same database lock: whichever wins prevents the other payment path',async t=>{
 for(const first of ['void','pos']){const h=await fixture(t);const prepare=()=>h.admin.rpc('prepare_admission_pos',{p_ids:[visit,second],p_user:staff,p_environment:'production',p_location:'location'});
 if(first==='void'){assert.equal((await h.call()).error,null);assert((await prepare()).error);assert.equal((await h.db.query('select count(*)::int as n from admission_pos_sales')).rows[0].n,0);}
 else {assert.equal((await prepare()).error,null);assert.match((await h.call()).error.message,/pending Square checkout/);assert((await h.snapshots()).visits.every(v=>v.payment_status==='due'));}
 }
});
test('an online reservation receipt or unfinished checkout cannot be changed to free admission',async t=>{
 const h=await fixture(t);await h.db.query('insert into open_play_reservation_slots values($1,now())',[operation]);await h.db.query("insert into open_play_reservations values($1,$2,$3,'due','production','reserved',$4,'online-checkout')",[ids.other,family,[child],operation]);
 assert.match((await h.call()).error.message,/online payment or checkout/);assert((await h.snapshots()).visits.every(v=>v.payment_status==='due'));
});
test('audit and void function deny anonymous and customer database roles',async t=>{
 const h=await fixture(t);for(const role of ['anon','authenticated']){await h.db.exec('set role '+role);await assert.rejects(h.db.query('select * from admission_payment_voids'),/permission denied/);await assert.rejects(h.db.query("select void_admission_payment(null,null,null,null,null,null,null)"),/permission denied/);await h.db.exec('reset role');}
});
test('void API authenticates staff, validates origin/input and derives actor/environment on the server',async()=>{
 let allowed=false,calls=[];const admin={rpc:async(name,args)=>{calls.push({name,args});return{data:{voided:true,amount_cents:0},error:null};}};
 const runtime=loadSquareModules({env:{SQUARE_ENVIRONMENT:'production'},mocks:{'@/lib/authz':{requireStaffContext:async()=>allowed?{ok:true,admin,user:{id:staff}}:{ok:false,response:Response.json({ok:false},{status:403})}}}});const route=runtime.load('src/app/api/admin/admission/void/route.ts');
 const body={request_id:operation,household_id:family,checkin_ids:[visit],reason:'Class cancelled',expected_total_cents:1600,p_actor:ids.other,environment:'sandbox'};
 const req=(patch={},origin='https://example.test')=>new Request('https://example.test/api/admin/admission/void',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...body,...patch})});
 assert.equal((await route.POST(req())).status,403);assert.equal(calls.length,0);allowed=true;assert.equal((await route.POST(req({},'https://foreign.test'))).status,403);assert.equal((await route.POST(req({checkin_ids:[visit,visit]}))).status,400);
 assert.equal((await route.POST(req())).status,200);assert.equal(calls[0].args.p_actor,staff);assert.equal(calls[0].args.p_environment,'production');
});
test('staff void action sends one request on double click and reports errors without claiming success',async()=>{
 const hooks=[];let cursor=0,requests=[],done=0,fail=false,release,unlock;
 const react={...React,useRef(initial){const index=cursor++;return hooks[index]??(hooks[index]={current:initial});},useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=initial;return[hooks[index],value=>{hooks[index]=value;}];}};
 const Component=loadModule('src/components/staff/VoidAdmissionPayment.tsx',{react},{React:react,crypto:{randomUUID:()=>operation},fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});if(release)await release;return Response.json(fail?{ok:false,error:'Reconcile Square first'}:{ok:true,voided:true,amount_cents:0},{status:fail?409:200});}}).default;
 const props={householdId:family,checkinIds:[visit],total:1600,disabled:false,onBusyChange(){},onVoided:async()=>{done++;}};
 const nodes=[];const walk=x=>{if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){nodes.push(x);walk(x.props?.children);}};const render=()=>{cursor=0;nodes.length=0;walk(Component(props));};
 render();nodes.find(n=>n.type==='select').props.onChange({target:{value:'Class cancelled'}});render();release=new Promise(resolve=>{unlock=resolve;});const button=nodes.find(n=>n.type==='button');button.props.onClick();button.props.onClick();assert.equal(requests.length,1);unlock();await new Promise(r=>setTimeout(r,0));release=null;assert.equal(requests[0].body.reason,'Class cancelled');assert.equal(done,1);
 fail=true;render();await nodes.find(n=>n.type==='button').props.onClick();await new Promise(r=>setTimeout(r,0));render();assert.equal(done,1);assert(nodes.some(n=>n.props?.role==='alert'&&String(n.props.children).includes('Reconcile Square')));assert.equal(requests[0].body.request_id,requests[1].body.request_id);
 const {admissionPaymentLabel}=loadSquareModules().load('src/lib/admission-payment-status.ts');assert.equal(admissionPaymentLabel({payment_status:'covered',price_cents:0,payment_voided:true}),'Void · $0');
});
