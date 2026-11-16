import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadSquareModules,localSquareAdmin} from './helpers/admission-pos-harness.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=uuid(1),target=uuid(2),source=uuid(3),other=uuid(4),child=uuid(5),sibling=uuid(6),oldChild=uuid(7),oldSibling=uuid(8),visit=uuid(9),siblingVisit=uuid(10),waiver=uuid(11),adult=uuid(12);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync('tests/fixtures/staff-admission-help.sql','utf8'));
 await db.exec(fs.readFileSync('db/migrations/20261114_staff_admission_help.sql','utf8'));
 await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into roles values($1,'staff')",[actor]);
 await db.query("insert into households(id,name) values($1,'Target'),($2,'Guest'),($3,'Other')",[target,source,other]);
 await db.query("insert into people values($1,$2,'child','Addison',null,null),($3,$2,'child','Elliot',null,'2024-08-30'),($4,$5,'child','Addie','Example','2022-10-20'),($6,$5,'child','Elliot','Example','2024-08-30'),($7,$2,'adult','Parent','Example',null)",[child,target,sibling,oldChild,source,oldSibling,adult]);
 const snapshot={children:[{id:oldChild,first_name:'Addie',last_name:'Example',birthdate:'2022-10-20'},{id:oldSibling,first_name:'Elliot',last_name:'Example',birthdate:'2024-08-30'}],paragraphs:['Original legal text'],email_verified:false};
 await db.query("insert into waivers values($1,$2,'guest_website',null,'test-v1',now(),now()+interval '90 days','Parent Example',$3,$4)",[waiver,source,[oldChild,oldSibling],JSON.stringify(snapshot)]);
 await db.query('insert into party_guest_waivers values($1,$2)',[waiver,source]);
 return {db,admin:localSquareAdmin(db),snapshot};
}
const mapping=[{source_id:oldChild,target_id:child},{source_id:oldSibling,target_id:sibling}];
const linkWaiver=(db,map=mapping,confirmed=true,who=actor)=>db.query('select staff_link_admission_waiver($1,$2,$3,$4,$5,$6,$7) as result',[who,target,waiver,JSON.stringify(map),'Guardian confirmed nickname and each child.','test-v1',confirmed]);
async function unpaid(db){
 await db.query("insert into checkins(id,person_id,household_id,price_cents,payment_status) values($1,$2,$3,1600,'due'),($4,$5,$3,1000,'due')",[visit,child,target,siblingVisit,sibling]);
 await db.exec("insert into square_payment_receipts values('sandbox','payment-one','order-one',2600,0,'COMPLETED',now())");
}
const proof={admission_cents:2600,paid_cents:2600,total_cents:2600,tax_cents:0,tip_cents:0};
const linkReceipt=(db,ids=[visit,siblingVisit],family=target,order='order-one',evidence=proof)=>db.query('select staff_link_admission_receipt($1,$2,$3,$4,$5,$6,$7) as result',[actor,family,day,ids,'sandbox',order,JSON.stringify(evidence)]);

test('receipt link updates the exact full unpaid family, keeps visit times, audits the actor and resolves its payment review note',async t=>{
 const {db}=await fixture(t);await unpaid(db);
 await db.query("insert into staff_admission_cases(household_id,visit_date,category,note,created_by) values($1,$2,'payment','Receipt needs connecting',$3)",[target,day,actor]);
 const before=(await db.query('select id,checked_in_at,price_cents from checkins order by id')).rows;
 assert.equal((await linkReceipt(db)).rows[0].result.status,'paid');
 const after=(await db.query('select * from checkins order by id')).rows;
 assert.deepEqual(after.map(({id,checked_in_at,price_cents})=>({id,checked_in_at,price_cents})),before);
 assert.ok(after.every(v=>v.payment_status==='paid'&&v.square_order_id==='order-one'&&v.square_environment==='sandbox'));
 const audit=(await db.query('select * from staff_admission_actions')).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,actor);
 assert.equal((await db.query('select status from staff_admission_cases')).rows[0].status,'resolved');
 assert.equal((await linkReceipt(db)).rows[0].result.already_linked,true);
 await assert.rejects(linkReceipt(db,[visit],other),/already linked/);
});
test('receipt link rejects partial families, missing receipts, refunds, pending POS launches and receipts belonging to another booking',async t=>{
 const {db}=await fixture(t);await unpaid(db);
 await assert.rejects(linkReceipt(db,[visit]),/Admission changed/);
 await assert.rejects(linkReceipt(db,null),/Choose/);
 await assert.rejects(linkReceipt(db,[visit,siblingVisit],target,'order-one',{}),/Invalid receipt/);
 await db.exec("update square_payment_receipts set refunded_cents=100");await assert.rejects(linkReceipt(db),/unrefunded/);
 await db.exec("update square_payment_receipts set refunded_cents=0,status='APPROVED'");await assert.rejects(linkReceipt(db),/unrefunded/);
 await db.exec("update square_payment_receipts set status='COMPLETED'");
 await db.query("insert into admission_pos_sales values($1,$2,'open',null,'sandbox')",[uuid(20),[visit,siblingVisit]]);await assert.rejects(linkReceipt(db),/pending Square/);
 await db.exec('delete from admission_pos_sales');
 await db.query("insert into open_play_reservations values($1,$2,'order-one','sandbox')",[uuid(21),other]);await assert.rejects(linkReceipt(db),/another booking/);
 assert.equal((await db.query('select count(*)::int as count from staff_admission_actions')).rows[0].count,0);
 assert.ok((await db.query('select payment_status from checkins')).rows.every(v=>v.payment_status==='due'));
});
test('a previously staff-confirmed direct payment can gain its real receipt without changing its amount or charging again',async t=>{
 const {db}=await fixture(t);await unpaid(db);
 await db.exec("update checkins set payment_status='paid',notes='Owner confirmed direct Square payment; receipt not yet linked.'");
 await linkReceipt(db);
 assert.ok((await db.query('select * from checkins')).rows.every(v=>v.square_order_id==='order-one'&&v.payment_status==='paid'&&v.notes.startsWith('Owner confirmed')));
 await db.query("insert into checkins(id,person_id,household_id,price_cents,payment_status) values($1,$2,$3,1000,'due')",[uuid(42),uuid(43),target]);
 await assert.rejects(linkReceipt(db,[uuid(42)]),/already linked/);
});
test('waiver links an explicitly confirmed nickname, completes missing birthdays, preserves the legal snapshot and party reference',async t=>{
 const {db,snapshot}=await fixture(t);
 await db.query("insert into checkins(id,person_id,household_id,price_cents,payment_status) values($1,$2,$3,0,'covered')",[uuid(30),adult,target]);
 const before=(await db.query('select * from checkins')).rows;
 await assert.rejects(linkWaiver(db,mapping,false),/Confirm/);
 assert.equal((await linkWaiver(db)).rows[0].result.status,'linked');
 const linked=(await db.query('select * from waivers')).rows[0];
 assert.equal(linked.household_id,target);assert.deepEqual(linked.covered_person_ids,[child,sibling]);
 const {family_reconciliation,...original}=linked.agreement_snapshot;assert.deepEqual(original,snapshot);
 assert.equal(family_reconciliation.actor_id,actor);assert.equal(family_reconciliation.guardian_confirmed,true);
 assert.equal((await db.query('select birthdate::text from people where id=$1',[child])).rows[0].birthdate,'2022-10-20');
 assert.equal((await db.query('select household_id from party_guest_waivers')).rows[0].household_id,target);
 assert.deepEqual((await db.query('select * from checkins')).rows,before);
 assert.equal((await linkWaiver(db)).rows[0].result.already_linked,true);
});
test('waiver conflicts retain canonical birthdays and incomplete/duplicate child mappings or sources with account history are rejected atomically',async t=>{
 const {db}=await fixture(t);
 await assert.rejects(linkWaiver(db,mapping.slice(0,1)),/Match every/);
 await assert.rejects(linkWaiver(db,[mapping[0],mapping[0]]),/Match every/);
 await assert.rejects(linkWaiver(db,null),/Match each/);
 await db.query('insert into household_members values($1,$2)',[source,actor]);await assert.rejects(linkWaiver(db),/account or visit/);
 assert.equal((await db.query('select household_id from waivers')).rows[0].household_id,source);
 await db.exec('delete from household_members');
 await db.query("update people set birthdate='2021-04-01' where id=$1",[child]);await linkWaiver(db);
 assert.equal((await db.query('select birthdate::text from people where id=$1',[child])).rows[0].birthdate,'2021-04-01');
});
test('browser roles cannot call linking RPCs or read private audit and review tables',async t=>{
 const {db}=await fixture(t);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from staff_admission_cases'),/permission denied/);
 await assert.rejects(db.query('select * from staff_admission_actions'),/permission denied/);
 await assert.rejects(linkWaiver(db),/permission denied/);
 await db.exec('reset role');
 await assert.rejects(linkWaiver(db,mapping,true,uuid(99)),/Staff access/);
});

const provider=(overrides={})=>async url=>{
 const order={id:'order-one',location_id:'test-location',state:'COMPLETED',total_money:{amount:1900,currency:'USD'},total_tip_money:{amount:0,currency:'USD'},total_tax_money:{amount:0,currency:'USD'},line_items:[{name:'General Admission',total_money:{amount:1600,currency:'USD'}},{name:'Coffee',total_money:{amount:300,currency:'USD'}}],tenders:[{payment_id:'payment-one'}],...overrides.order};
 const payment={id:'payment-one',order_id:'order-one',location_id:'test-location',status:'COMPLETED',source_type:'CARD',amount_money:{amount:1900,currency:'USD'},created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...overrides.payment};
 return Response.json(String(url).includes('/orders/')?{order}:{payment});
};
test('provider verification accepts itemized admission plus coffee but rejects amount/date/refund/store mismatches',async()=>{
 let helpers=loadSquareModules({fetch:provider()}).load('src/lib/staff-admission-help.ts');
 assert.equal((await helpers.helpReceipt('order-one',1600,day)).proof.admission_cents,1600);
 await assert.rejects(helpers.helpReceipt('order-one',2600,day),/admission amount/);
 for(const payment of [{status:'APPROVED'},{refunded_money:{amount:100,currency:'USD'}},{location_id:'other-location'},{created_at:'2000-01-01T10:00:00Z'}]){
  helpers=loadSquareModules({fetch:provider({payment})}).load('src/lib/staff-admission-help.ts');await assert.rejects(helpers.helpReceipt('order-one',1600,day),/refunded, pending|different/);
 }
});
test('HTTP help endpoint rejects non-staff, cross-origin requests and unconfirmed operations before querying receipts',async()=>{
 const denied=loadSquareModules({mocks:{'@/lib/authz':{requireStaffContext:async()=>({ok:false,response:Response.json({ok:false},{status:401})})}}}).load('src/app/api/admin/admission/help/route.ts');
 assert.equal((await denied.GET()).status,401);assert.equal((await denied.POST(new Request('https://example.test/api',{method:'POST'}))).status,401);
 const queries=[];const admin={from(table){queries.push(table);return {select(){return this;},eq(){return this;},single:async()=>({data:{id:target},error:null})};}};
 const route=loadSquareModules({mocks:{'@/lib/authz':{requireStaffContext:async()=>({ok:true,user:{id:actor},admin})}}}).load('src/app/api/admin/admission/help/route.ts');
 const req=(body,origin='https://example.test')=>new Request('https://example.test/api',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await route.POST(req({},'https://evil.test'))).status,403);assert.equal(queries.length,0);
 assert.equal((await route.POST(req({mode:'link_receipt',household_id:target,date:day,order_id:'order-one',confirmed:false}))).status,409);
 assert.equal((await route.POST(req({mode:'link_waiver',household_id:target,date:day,waiver_id:waiver,guardian_confirmed:false}))).status,409);
});

test('review notes use the authenticated staff identity, survive retries and closing a note changes no financial record',async t=>{
 const {db,admin}=await fixture(t);await unpaid(db);
 const route=loadSquareModules({mocks:{'@/lib/authz':{requireStaffContext:async()=>({ok:true,user:{id:actor},admin})}}}).load('src/app/api/admin/admission/help/route.ts');
 const send=body=>route.POST(new Request('https://example.test/api',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(body)}));
 const requestId=uuid(66),body={mode:'create_case',household_id:target,date:day,request_id:requestId,category:'payment',note:'Customer says they paid; receipt search needs review.',created_by:uuid(99)};
 assert.equal((await send(body)).status,200);assert.equal((await send(body)).status,200);
 const notes=(await db.query('select * from staff_admission_cases')).rows;assert.equal(notes.length,1);assert.equal(notes[0].created_by,actor);
 const open=await (await route.GET()).json();assert.equal(open.cases[0].family_name,'Target');
 const before=(await db.query('select * from checkins order by id')).rows;
 assert.equal((await send({mode:'resolve_case',case_id:requestId,note:'Receipt checked with owner and issue resolved.',resolved_by:uuid(99)})).status,200);
 const resolved=(await db.query('select * from staff_admission_cases')).rows[0];assert.equal(resolved.status,'resolved');assert.equal(resolved.resolved_by,actor);
 assert.deepEqual((await db.query('select * from checkins order by id')).rows,before);
 assert.equal((await (await route.GET()).json()).cases.length,0);
});
