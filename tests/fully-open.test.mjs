import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadSquareModules, localSquareAdmin, ids } from './helpers/admission-pos-harness.mjs';
const {load}=loadSquareModules();
const age=load('src/lib/open-play-age-pricing.ts');
const {softOpeningAmount}=load('src/lib/soft-opening-pricing.ts');
const {projectInfantSiblingAdmission}=load('src/lib/infant-sibling-admission.ts');
test('admission switches at six and twelve calendar months, including month ends and leap dates',()=>{
 for(const [birth,visit,months,result]of [['2026-05-16','2026-11-15',6,true],['2026-05-16','2026-11-16',6,false],['2025-11-16','2026-11-15',12,true],['2025-11-16','2026-11-16',12,false],['2026-08-31','2027-02-27',6,true],['2026-08-31','2027-02-28',6,false],['2024-02-29','2025-02-28',12,false]])assert.equal(age.underMonths(birth,visit,months),result);
 for(const birth of [null,'invalid','2026-02-30','2027-01-01'])assert.equal(age.underMonths(birth,'2026-11-16',6),false);
});
test('family quotes charge under six months zero even alone, infants $10, older first child $16 and every additional child $10',()=>{
 const baby={id:'baby',birthdate:'2026-06-01'},infant={id:'infant',birthdate:'2026-02-01'},older={id:'older',birthdate:'2023-01-01'},twin={...infant,id:'twin'};
 for(const [children,total]of [[[baby],0],[[infant],1000],[[older],1600],[[baby,older],1600],[[older,infant,baby],2600],[[infant,twin],2000],[[infant,older],2600],[[baby,{...baby,id:'baby2'}],0],[[older,{...older,id:'sibling'},infant,baby],3600]])assert.equal(softOpeningAmount(children.map(c=>c.id),[],'2026-11-16',children),total);
 assert.equal(softOpeningAmount(['older','infant'],[{child_ids:['older'],status:'pending',start_date:null,paid_through:null}],'2026-11-16',[older,infant]),1000);
});
test('staff pricing matches reservations when the infant is scanned first and never alters paid or frozen receipts',()=>{
 const people=[{id:'baby',birthdate:'2026-06-01'},{id:'infant',birthdate:'2026-02-01'},{id:'older',birthdate:'2023-01-01'}].map(p=>({...p,household_id:'family',role:'child'}));
 const visits=people.map((p,i)=>({id:p.id,person_id:p.id,price_cents:i===0?1600:1000,payment_status:'due',checked_in_at:`2026-11-16T15:00:0${i}Z`}));
 const priced=projectInfantSiblingAdmission(visits,people,'production');assert.deepEqual([...priced].map(v=>v.price_cents),[0,1000,1600]);
 assert.equal(priced[0].payment_status,'covered');
 const paid=visits.map(v=>({...v,payment_status:'paid'}));assert.deepEqual([...projectInfantSiblingAdmission(paid,people,'production')].map(v=>v.price_cents),paid.map(v=>v.price_cents));
 assert.deepEqual([...projectInfantSiblingAdmission(visits,people,'production',new Set(visits.map(v=>v.id)))].map(v=>v.price_cents),visits.map(v=>v.price_cents));
});
test('combined crowd count includes active party children and adults and recalculates the crowd threshold',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create table occupancy_status(current_occupancy int,crowd_level text,effective_date date,last_updated_at timestamptz);insert into occupancy_status values(8,'light','2026-11-16','2026-11-16T15:00Z');create table party_bookings(current_child_count int,current_adult_count int,updated_at timestamptz,status text,start_time timestamptz,end_time timestamptz,attendance_finalized_at timestamptz);
 insert into party_bookings values(10,12,'2026-11-16T16:00Z','confirmed','2026-11-16T15:00Z','2026-11-16T18:00Z',null),(20,20,now(),'cancelled','2026-11-16T15:00Z','2026-11-16T18:00Z',null),(20,20,now(),'confirmed','2026-11-16T12:00Z','2026-11-16T15:00Z',null),(20,20,now(),'confirmed','2026-11-16T15:00Z','2026-11-16T18:00Z',now());`);
 const occupancy=load('src/lib/occupancy.ts');const result=await occupancy.getOccupancyStatus(localSquareAdmin(db),new Date('2026-11-16T16:00Z'));
 assert.equal(result.occupancy,30);assert.equal(result.openPlayOccupancy,8);assert.equal(result.partyOccupancy,22);assert.equal(result.crowdLevel,'busy');assert.equal(result.progress,30/80);
 assert.equal((await occupancy.getOccupancyStatus(localSquareAdmin(db),new Date('2026-11-16T18:00Z'))).occupancy,8);
});
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());await db.exec(fs.readFileSync('tests/fixtures/party-invoice-installed.sql','utf8'));
 await db.query('insert into households(id,email,name)values($1,$2,$3)',[ids.household,'sandbox@example.test','Sandbox']);
 await db.query("insert into square_customers values($1,'sandbox','customer')",[ids.household]);
 const orders=new Map(),invoices=new Map();let orderCalls=0;const notifications=[];
 const fetch=async(url,options={})=>{const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
  if(path.includes('/locations/'))return Response.json({location:{id:'test-location',currency:'USD',status:'ACTIVE',timezone:'America/New_York'}});
  if(path==='/v2/orders'&&options.method==='POST'){orderCalls++;const order={...body.order,id:'order',total_money:{amount:30000,currency:'USD'}};orders.set('order',order);return Response.json({order});}
  if(path==='/v2/invoices'&&options.method==='POST'){const invoice={...body.invoice,id:'invoice',version:0,status:'DRAFT',payment_requests:body.invoice.payment_requests.map(r=>({...r,computed_amount_money:{amount:15000,currency:'USD'},total_completed_amount_money:{amount:0,currency:'USD'}}))};invoices.set('invoice',invoice);return Response.json({invoice});}
  if(path.endsWith('/publish')){const invoice=invoices.get('invoice');invoice.version++;invoice.status='UNPAID';invoice.public_url='https://squareupsandbox.com/pay-invoice/test';return Response.json({invoice});}
  if(path.endsWith('/cancel')){const invoice=invoices.get('invoice');invoice.version++;invoice.status='CANCELED';return Response.json({invoice});}
  if(path.includes('/invoices/'))return Response.json({invoice:invoices.get('invoice')});
  if(path.includes('/orders/'))return Response.json({order:orders.get('order')});
  throw Error('Unexpected provider call '+path);
 };
 const modules=loadSquareModules({fetch,mocks:{'@/lib/party-emails':{sendPartyConfirmationEmail:async()=>({ok:true})},'@/lib/admin-notifications':{sendPartyBookingNotification:async value=>{notifications.push(value);return{ok:true};}}}});
 const flow=modules.load('src/lib/party-deposit.ts'),admin=localSquareAdmin(db);
 const request={start_time:'2099-11-20T15:00:00.000Z',end_time:'2099-11-20T18:00:00.000Z',headcount_expected:30,notes:null,birthday_child_name:'Test',birthday_age:3,occasion_details:null};
 const start=()=>flow.startPartyCheckout(admin,ids.household,ids.user,request);
 const pay=()=>{const invoice=invoices.get('invoice');invoice.version++;invoice.status='PARTIALLY_PAID';invoice.payment_requests[0].total_completed_amount_money.amount=15000;};
 return{db,flow,admin,request,start,pay,orders,invoices,orderCalls:()=>orderCalls,notifications};
}
test('one $300 party invoice collects a $150 deposit now and a $150 balance before the party',async t=>{
 const h=await fixture(t);const a=await h.start();assert.equal(a.status,'open');assert.equal(a.expected_amount_cents,15000);
 const invoice=h.invoices.get('invoice');assert.equal(invoice.payment_requests[0].request_type,'DEPOSIT');assert.equal(invoice.payment_requests[0].fixed_amount_requested_money.amount,15000);assert.equal(invoice.payment_requests[1].request_type,'BALANCE');assert.equal(invoice.delivery_method,'SHARE_MANUALLY');assert(invoice.payment_requests.every(r=>r.automatic_payment_source==='NONE'));
 assert.equal((await h.start()).id,a.id);assert.equal(h.orderCalls(),1);assert.equal((await h.flow.reconcilePartyCheckout(h.admin,a)).status,'open');
 h.pay();const paid=await h.flow.reconcilePartyCheckout(h.admin,a);assert.equal(paid.status,'completed');const row=(await h.db.query('select * from party_bookings')).rows[0];assert.equal(row.status,'confirmed');assert.equal(row.deposit_paid_cents,15000);assert.equal(row.price_quote_cents,30000);assert.equal(row.remaining_balance_cents,15000);assert.equal(h.notifications.length,1);
 invoice.version++;invoice.status='PAID';invoice.payment_requests[1].total_completed_amount_money.amount=15000;await h.flow.reconcilePartyCheckout(h.admin,paid);assert.equal((await h.db.query('select remaining_balance_cents from party_bookings')).rows[0].remaining_balance_cents,0);assert.equal(h.notifications.length,1);
});
test('wrong invoice amount, reference, location, customer, currency and fractional paid amounts cannot confirm a party',async t=>{
 const h=await fixture(t);const a=await h.start();h.pay();const order=h.orders.get('order'),invoice=h.invoices.get('invoice');
 for(const [object,key,value]of [[order,'reference_id','foreign'],[order,'location_id','foreign'],[order,'total_money',{amount:15000,currency:'USD'}],[invoice.primary_recipient,'customer_id','foreign'],[order,'total_money',{amount:30000,currency:'EUR'}],[invoice.payment_requests[0],'total_completed_amount_money',{amount:14999.5,currency:'USD'}]]){const old=object[key];object[key]=value;await assert.rejects(h.flow.reconcilePartyCheckout(h.admin,a));object[key]=old;assert.equal((await h.db.query('select status from party_bookings')).rows[0].status,'pending');}
});
test('closing an unpaid party cancels its payable invoice before releasing the date and preserves a paid deposit',async t=>{
 const h=await fixture(t);const a=await h.start();const closed=await h.flow.closePartyCheckout(h.admin,a);assert.equal(closed.status,'cancelled');assert.equal(h.invoices.get('invoice').status,'CANCELED');assert.equal((await h.db.query('select status from party_bookings')).rows[0].status,'cancelled');
 const b=await h.start();h.pay();assert.equal((await h.flow.closePartyCheckout(h.admin,b)).status,'completed');
});
test('database blocks unpaid confirmation and another family booking the held date; no second Square invoice is created',async t=>{
 const h=await fixture(t);const a=await h.start();await assert.rejects(h.db.query("update party_bookings set status='confirmed' where id=$1",[a.id]),/verified Square deposit/);
 await assert.rejects(h.flow.startPartyCheckout(h.admin,ids.other,ids.user,h.request),/already booked/);assert.equal(h.orderCalls(),1);
});
test('party checkout requires login, same origin and family ownership, and refuses the old no-deposit action',async()=>{
 for(const authenticated of [false,true]){
 const runtime=loadSquareModules({mocks:{'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:ids.user}:null}})}})},'@/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},'@/lib/households':{getLatestHouseholdIdForUser:async()=>ids.household},'@/lib/family-profile':{ensureGuardianProfile:async()=>{},parseGuardianName:()=>({})},'@/lib/party-deposit':{readPartyCheckout:async()=>null}}});
 const route=runtime.load('src/app/api/party-bookings/route.ts');const post=body=>new Request('http://localhost:3000/api/party-bookings',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await route.POST(post({mode:'early_access_hold'}))).status,authenticated?400:401);
 assert.equal((await route.POST(post({mode:'finalize',checkout_id:ids.person}))).status,authenticated?404:401);
 if(authenticated)assert.equal((await route.POST(new Request('http://localhost:3000/api/party-bookings',{method:'POST',body:'{}',headers:{origin:'https://other.test'}}))).status,403);
 }
});
test('future unpaid counter quotes change to current age pricing while provider checkouts and paid receipts keep their amounts',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(`create table open_play_reservations(id text,household_id text,status text,payment_status text,payment_choice text,amount_cents int,square_order_id text);insert into open_play_reservations values('quote','family','reserved','due','counter',1600,null)`);
 const {refreshOpenPlayQuote}=load('src/lib/open-play-quote.ts');const row={id:'quote',household_id:'family',status:'reserved',payment_status:'due',payment_choice:'counter',amount_cents:1600,square_order_id:null,child_ids:['baby'],slot:{starts_at:'2026-11-17T15:00Z'}};const family={memberships:[],children:[{id:'baby',birthdate:'2026-06-01'}]};
 assert.equal((await refreshOpenPlayQuote(localSquareAdmin(db),row,family,new Date('2026-11-16T15:00Z'))).amount_cents,0);
 for(const patch of [{payment_status:'paid'},{payment_choice:'now',square_order_id:'order'},{slot:{starts_at:'2026-11-15T15:00Z'}}])assert.equal((await refreshOpenPlayQuote(localSquareAdmin(db),{...row,...patch},family,new Date('2026-11-16T15:00Z'))).amount_cents,1600);
});
