import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadSquareModules, localSquareAdmin, ids } from './helpers/admission-pos-harness.mjs';
const paidAt='2026-11-27T14:22:26Z';
const baseOrder=()=>({id:'order',location_id:'test-location',customer_id:'customer',state:'COMPLETED',total_money:{amount:6000,currency:'USD'},tenders:[{payment_id:'payment'}],line_items:[{name:'Monthly Membership - 1st Child',quantity:'1',catalog_object_id:'variation',total_money:{amount:6000,currency:'USD'}}]});
const basePayment=()=>({id:'payment',order_id:'order',customer_id:'customer',location_id:'test-location',status:'COMPLETED',amount_money:{amount:6000,currency:'USD'},created_at:paidAt,updated_at:paidAt});
const pure=loadSquareModules().load('src/lib/pos-memberships.ts');
test('only fully settled, itemized one-month memberships qualify; matching amounts and arbitrary product names grant nothing',()=>{
 const order=baseOrder(),payment=basePayment();const purchase=pure.membershipPurchase(order,[payment],'test-location');
 assert.equal(purchase.amount_cents,6000);assert.equal(purchase.start_date,'2026-11-27');assert.equal(purchase.end_date,'2026-12-27');
 assert.equal(pure.membershipPurchase({...order,line_items:[{name:'Admission',total_money:{amount:6000,currency:'USD'}}]},[payment],'test-location'),null);
 for(const patch of [{status:'APPROVED'},{status:'PENDING'},{location_id:'other'},{order_id:'other'},{customer_id:'other'},{amount_money:{amount:1600,currency:'USD'}}])assert.throws(()=>pure.membershipPurchase(order,[{...payment,...patch}],'test-location'));
 for(const patch of [{state:'OPEN'},{location_id:'other'},{tenders:[]},{customer_id:'different'},{total_money:{amount:6000,currency:'CAD'}}])assert.throws(()=>pure.membershipPurchase({...order,...patch},[payment],'test-location'));
 assert.throws(()=>pure.membershipPurchase({...order,line_items:[{...order.line_items[0],catalog_object_id:null}]},[payment],'test-location'));
 assert.throws(()=>pure.membershipPurchase({...order,line_items:[{...order.line_items[0],quantity:'2'}]},[payment],'test-location'));
 assert.equal(pure.membershipPurchase(order,[{...payment,refunded_money:{amount:100,currency:'USD'}}],'test-location').refunded,true);
});
async function fixture(){
 const pg=new PGlite();await pg.exec(`create table staff_family_search_aliases(alias_household_id uuid,canonical_household_id uuid); create table square_customers(household_id uuid,square_customer_id text,environment text); create table people(id uuid primary key,household_id uuid,role text,birthdate text);
 create table membership_events(id uuid primary key,household_id uuid,action text,notes text,created_by_user_id uuid,created_by_role text);
 create table memberships(id uuid primary key,household_id uuid,person_id uuid,square_customer_id text,square_environment text,square_status text,payment_review_required boolean,renews_at timestamptz,covered_person_ids jsonb,updated_at timestamptz default now());
 create table checkins(id uuid primary key,person_id uuid,payment_status text,price_cents integer,notes text,checked_in_at timestamptz,square_environment text,square_order_id text,membership_applied boolean default false);
 insert into square_customers values('${ids.household}','customer','legacy');insert into people values('${ids.person}','${ids.household}','child','2024-11-23');
 insert into checkins values('60000000-0000-4000-8000-000000000001','${ids.person}','due',1600,null,'2026-11-27T14:20:00Z','sandbox',null,false),('60000000-0000-4000-8000-000000000002','${ids.person}','paid',1600,null,'2026-11-28T14:20:00Z','sandbox','old-order',false);`);
 let order=baseOrder(),payment=basePayment(),catalogName='Monthly Membership - 1st Child';const calls=[];
 const modules=loadSquareModules({fetch:async(url,opts)=>{const path=new URL(url).pathname;calls.push([path,opts.method]);let result;
  if(path==='/v2/orders/order')result={order};else if(path==='/v2/payments/payment')result={payment};else if(path==='/v2/customers/customer')result={customer:{id:'customer'}};
  else if(path==='/v2/catalog/object/variation')result={object:{id:'variation',type:'ITEM_VARIATION',item_variation_data:{item_id:'item'}},related_objects:[{id:'item',type:'ITEM',item_data:{name:catalogName}}]};else throw Error('Unexpected provider request '+path);
  return Response.json(result);
 }});
 return {pg,calls,modules,admin:localSquareAdmin(pg),setPayment:p=>payment={...payment,...p},setOrder:p=>order={...order,...p},setCatalog:name=>catalogName=name};
}
test('receipt retries grant one paid term, cover earlier same-day unpaid admission, preserve paid visits, and revoke refunds',async()=>{
 const f=await fixture();try{
 const lib=f.modules.load('src/lib/pos-memberships.ts');
 for(let i=0;i<2;i++){const r=await lib.syncPosMembership(f.admin,'order');assert.equal(r.status,'paid');}
 const memberships=(await f.pg.query('select * from memberships')).rows;assert.equal(memberships.length,1);assert.equal(memberships[0].renews_at.toISOString(),'2026-12-27T05:00:00.000Z');
 assert.equal((await f.pg.query('select * from membership_events')).rows.length,1);
 const visits=(await f.pg.query('select * from checkins order by id')).rows;assert.equal(visits[0].price_cents,0);assert.equal(visits[0].membership_applied,true);assert.equal(visits[0].checked_in_at.toISOString(),'2026-11-27T14:20:00.000Z');assert(visits[0].notes.includes('original unpaid admission $16.00'));assert.equal(visits[1].payment_status,'paid');assert.equal(visits[1].square_order_id,'old-order');
 const terms=lib.posAdmissionTerms(await lib.readPosMembershipReceipts(f.admin,'sandbox',[ids.household]));const {membershipCoversAdmission}=f.modules.load('src/lib/membership-admission-coverage.ts');assert.equal(membershipCoversAdmission(terms[0],'2026-12-26'),true);assert.equal(membershipCoversAdmission(terms[0],'2026-12-27'),false);assert.equal(membershipCoversAdmission(terms[0],'2026-11-26'),false);
 f.setPayment({refunded_money:{amount:6000,currency:'USD'}});await lib.syncPosMembership(f.admin,'order');assert.equal(lib.posAdmissionTerms(await lib.readPosMembershipReceipts(f.admin,'sandbox',[ids.household])).length,0);
 f.setPayment({refunded_money:{amount:0,currency:'USD'}});await lib.syncPosMembership(f.admin,'order');assert.equal(lib.posAdmissionTerms(await lib.readPosMembershipReceipts(f.admin,'sandbox',[ids.household])).length,0);
 assert(f.calls.every(([,method])=>method==='GET'));
 }finally{await f.pg.close();}
});
test('catalog mismatches, missing customer mappings and mismatched child counts cannot create a paid entitlement',async()=>{
 for(const invalid of ['catalog','mapping','children']){const f=await fixture();try{
 if(invalid==='catalog')f.setCatalog('General Admission');if(invalid==='mapping')await f.pg.exec('delete from square_customers');if(invalid==='children')await f.pg.exec(`insert into people values('${ids.otherPerson}','${ids.household}','child','2023-01-01')`);
 await assert.rejects(f.modules.load('src/lib/pos-memberships.ts').syncPosMembership(f.admin,'order'));
 assert.equal((await f.pg.query('select * from memberships')).rows.length,0);assert.equal((await f.pg.query('select * from membership_events')).rows.length,0);
 }finally{await f.pg.close();}}
});

test('payment webhooks synchronize catalog memberships before the duplicate log, and failures remain retryable',async()=>{
 for(const fail of [false,true]){
 const calls=[];
 const modules=loadSquareModules({mocks:{
  'next/server':{},'@supabase/supabase-js':{createClient:()=>({from(){calls.push('log');return {insert:async()=>({error:{code:'23505'}})};}})},
  '@/lib/square-webhook':{verifySquareWebhook:()=>true},'@/lib/square-client':{squareEnvironment:()=> 'sandbox',squareRequest:async()=>({order:baseOrder()})},
  '@/lib/pos-memberships':{isPosMembershipOrder:()=>true,syncPosMembership:async(_db,id)=>{calls.push('membership:'+id);if(fail)throw Error('retry');}},
  '@/lib/gift-card-notifications':{notifyGiftCardOrder:async()=>{}},'@/lib/founding-square':{},
  '@/lib/soft-opening-payments':{},'@/lib/class-series-payments':{},'@/lib/households':{},'@vercel/functions':{},'@/lib/membership-notifications':{},
 }});
 const route=modules.load('src/app/api/webhooks/square/route.ts');
 const response=await route.POST(new Request('https://example.test/api/webhooks/square',{method:'POST',body:JSON.stringify({event_id:'event',type:'payment.updated',data:{object:{payment:basePayment()}}})}));
 assert.equal(response.status,fail?503:200);assert.equal(calls[0],'membership:order');assert.equal(calls.includes('log'),false);
 }
});

test('receipt recovery requires the owner and never invokes subscription activation',async()=>{
 for(const allowed of [false,true]){
 let synchronized=0;
 const m=loadSquareModules({mocks:{'@/lib/authz':{requireOwnerContext:async()=>allowed?{ok:true,admin:{},user:{id:ids.user}}:{ok:false,response:Response.json({ok:false},{status:403})},},
 '@/lib/pos-memberships':{syncPosMembership:async(_db,id)=>{assert.equal(id,'order');synchronized++;return {status:'paid'};}},
 '@/lib/founding-square':{activateFounding:()=>{throw Error('must not start billing');}},
 }});
 const response=await m.load('src/app/api/admin/founding-memberships/route.ts').POST(new Request('https://example.test/api/admin/founding-memberships',{method:'POST',headers:{origin:'https://example.test'},body:JSON.stringify({mode:'sync_pos',order_id:'order'})}));
 assert.equal(response.status,allowed?200:403);assert.equal(synchronized,allowed?1:0);
 }
});

test('a paid in-person month prevents starting a second saved-card subscription',async()=>{
 const f=await fixture();try{
 const library=f.modules.load('src/lib/pos-memberships.ts');await library.syncPosMembership(f.admin,'order');const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 const m=loadSquareModules({mocks:{'@/lib/complimentary-membership':{readComplimentaryMembership:async()=>null}},fetch:async()=>{throw Error('No provider billing requests are allowed');}});
 const version=m.load('src/lib/founding-membership.ts').FOUNDING_TERMS_VERSION;
 await assert.rejects(m.load('src/lib/founding-square.ts').activateFounding(f.admin,{id:ids.other,household_id:ids.household,environment:'sandbox',status:'pending',square_card_id:'saved-card',square_customer_id:'customer',terms_version:version},today,{ownerAuthorized:true}),/already paid in person/);
 }finally{await f.pg.close();}
});

test('the database check-in predicate cannot cover a child added after the purchased month was registered',async()=>{
 const f=await fixture();try{
 await f.modules.load('src/lib/pos-memberships.ts').syncPosMembership(f.admin,'order');
 await f.pg.exec(`insert into people values('${ids.otherPerson}','${ids.household}','child','2023-01-01')`);
 const eligible=async child=>(await f.pg.query('select exists(select 1 from memberships where (household_id=$1 or person_id=$2) and renews_at>now()) covered',[ids.household,child])).rows[0].covered;
 assert.equal(await eligible(ids.person),true);assert.equal(await eligible(ids.otherPerson),false);
 const rows=(await f.pg.query('select household_id,person_id from memberships')).rows;assert.equal(rows[0].household_id,null);assert.equal(rows[0].person_id,ids.person);
 }finally{await f.pg.close();}
});
